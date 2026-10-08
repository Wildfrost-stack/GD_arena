import { randomUUID } from "crypto";
import { db } from "@/db";
import { rooms, utterances, participants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getRoom, getParticipants, wordCount } from "@/lib/db-helpers";
import { generateAndStoreReport } from "@/lib/reportService";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

interface Body {
  participantId: string | null;
  speakerKind: "moderator" | "ai" | "student";
  fullText: string;
  renderedText: string;
  wasInterrupted: boolean;
  addresses: string | null;
  startedAtMs: number;
  endedAtMs: number;
  turnPhase: string;
  isInvite?: boolean;
  isWrap?: boolean;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await getRoom(id);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body.renderedText !== "string") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const roster = await getParticipants(id);
  const participant = body.participantId ? roster.find((p) => p.id === body.participantId) ?? null : null;
  const speakerName = participant?.name ?? room.studentName;

  const renderedText = body.renderedText.trim().length > 0 ? body.renderedText.trim() : "(no audible speech captured)";
  const utteranceId = randomUUID();

  await db.insert(utterances).values({
    id: utteranceId,
    roomId: id,
    participantId: body.participantId,
    speakerName,
    speakerKind: body.speakerKind,
    turnIndex: room.turnIndex,
    phase: body.turnPhase,
    fullText: body.fullText || renderedText,
    renderedText,
    wasInterrupted: Boolean(body.wasInterrupted),
    addresses: body.addresses ?? null,
    startedAtMs: Math.max(0, Math.round(body.startedAtMs) || 0),
    endedAtMs: Math.max(0, Math.round(body.endedAtMs) || 0),
    wordCount: wordCount(renderedText),
  });

  const patch: Partial<typeof rooms.$inferInsert> = {
    turnIndex: room.turnIndex + 1,
    lastSpeakerId: body.participantId,
  };

  const wasInterrupted = Boolean(body.wasInterrupted);
  let shouldFinish = false;

  if (wasInterrupted) {
    patch.phase = "STUDENT_SPEAKING";
    patch.consecutiveAiTurns = 0;
    patch.pendingAddress = null;
  } else if (body.speakerKind === "student") {
    patch.pendingAddress = null;
    patch.consecutiveAiTurns = 0;
    if (body.turnPhase === "CLOSING_ROUND") {
      patch.phase = "CLOSING_ROUND";
      patch.closingPointer = (room.closingPointer ?? 0) + 1;
    } else {
      patch.phase = "GAP";
    }
  } else {
    // moderator or ai, completed normally
    if (body.turnPhase === "MODERATOR_OPENING") {
      patch.phase = "GAP";
      patch.discussionStartedAt = new Date();
      patch.consecutiveAiTurns = 0;
      patch.pendingAddress = body.addresses ?? null;
    } else if (body.turnPhase === "AI_SPEAKING") {
      patch.phase = "GAP";
      patch.pendingAddress = body.addresses ?? null;
      if (body.isInvite) {
        patch.consecutiveAiTurns = 0;
      } else {
        patch.consecutiveAiTurns = body.speakerKind === "ai" ? room.consecutiveAiTurns + 1 : 0;
      }
    } else if (body.turnPhase === "CLOSING_ROUND") {
      patch.phase = "CLOSING_ROUND";
      if (room.closingPointer === -1) {
        patch.closingPointer = 0;
      } else if (body.isWrap) {
        patch.phase = "ENDED";
        patch.endedAt = new Date();
        shouldFinish = true;
      } else {
        patch.closingPointer = (room.closingPointer ?? 0) + 1;
      }
    }
  }

  await db.update(rooms).set(patch).where(eq(rooms.id, id));

  if (participant) {
    await db
      .update(participants)
      .set({ lastSpokeAtMs: Math.max(0, Math.round(body.endedAtMs) || 0) })
      .where(eq(participants.id, participant.id));
  }

  if (shouldFinish) {
    await generateAndStoreReport(id);
  }

  const freshRoom = await getRoom(id);
  return Response.json({ ok: true, utteranceId, room: freshRoom });
}
