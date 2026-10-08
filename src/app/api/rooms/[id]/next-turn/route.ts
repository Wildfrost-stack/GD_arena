import { db } from "@/db";
import { rooms } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getRoom, getParticipants, getUtterances, maybeTransitionToClosing } from "@/lib/db-helpers";
import {
  pickNextSpeaker,
  generateAiTurnText,
  generateStudentInviteFromAi,
  generateModeratorInvite,
  generateModeratorClosingPrompt,
  generateModeratorClosingWrap,
  generateAiClosingLine,
  stockFallbackLine,
  Stance,
} from "@/lib/director";
import { generateTurnLLM, styleForRole, TranscriptLine } from "@/lib/directorLlm";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function recentTranscript(roomId: string): Promise<TranscriptLine[]> {
  const rows = await getUtterances(roomId);
  return rows
    .filter((r) => !r.renderedText.startsWith("(no "))
    .slice(-10)
    .map((r) => ({ speaker: r.speakerName, text: r.renderedText }));
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let room = await getRoom(id);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });
  if (room.phase === "ENDED") return Response.json({ error: "Room already ended" }, { status: 410 });

  room = await maybeTransitionToClosing(room);

  const roster = await getParticipants(id);
  const moderator = roster.find((p) => p.kind === "moderator")!;
  const aiRoster = roster.filter((p) => p.kind === "ai");
  const allNames = roster.map((p) => p.name);

  // ---------------- Closing round ----------------
  if (room.phase === "CLOSING_ROUND") {
    const order = (room.closingOrder as string[] | null) ?? [];

    if (room.closingPointer === -1) {
      const text = generateModeratorClosingPrompt(room.topic);
      await db.update(rooms).set({ currentSpeakerId: moderator.id }).where(eq(rooms.id, id));
      return Response.json({ speaker: moderator, text, addresses: null, isInvite: false, action: "speak" });
    }

    if (room.closingPointer >= order.length) {
      const text = generateModeratorClosingWrap(room.topic);
      await db.update(rooms).set({ currentSpeakerId: moderator.id }).where(eq(rooms.id, id));
      return Response.json({ speaker: moderator, text, addresses: null, isInvite: false, action: "wrap" });
    }

    const nextId = order[room.closingPointer];
    if (nextId === "student") {
      const text = `Over to you, ${room.studentName} — what's your closing thought?`;
      await db.update(rooms).set({ currentSpeakerId: null, pendingAddress: room.studentName }).where(eq(rooms.id, id));
      return Response.json({
        speaker: { kind: "moderator", name: moderator.name, id: moderator.id },
        text,
        addresses: room.studentName,
        isInvite: true,
        action: "awaitStudent",
      });
    }

    const speaker = aiRoster.find((p) => p.id === nextId) ?? aiRoster[0];
    const llm = await generateTurnLLM({
      mode: "closing",
      topic: room.topic,
      speakerName: speaker.name,
      role: speaker.role,
      stance: speaker.stance as Stance,
      studentName: room.studentName,
      allNames,
      transcript: await recentTranscript(id),
      addressedDirectly: false,
    });
    const text = llm?.text ?? generateAiClosingLine(styleForRole(speaker.role), speaker.stance as Stance);
    await db.update(rooms).set({ currentSpeakerId: speaker.id }).where(eq(rooms.id, id));
    return Response.json({ speaker, text, addresses: null, isInvite: false, action: "speak" });
  }

  // ---------------- Open floor ----------------
  // Atomically claim the floor (GAP -> AI_SPEAKING). With LLM latency in the
  // loop, two overlapping requests (double trigger, second tab) must not both
  // produce a turn.
  const claimed = await db
    .update(rooms)
    .set({ phase: "AI_SPEAKING" })
    .where(and(eq(rooms.id, id), eq(rooms.phase, "GAP")))
    .returning({ id: rooms.id });
  if (claimed.length === 0) {
    return Response.json({ error: `Floor not open (phase ${room.phase})` }, { status: 409 });
  }

  if (aiRoster.length === 0) {
    await db.update(rooms).set({ phase: "GAP" }).where(eq(rooms.id, id));
    return Response.json({ error: "No AI participants configured" }, { status: 500 });
  }

  const forceInvite = room.consecutiveAiTurns >= room.turnCap;
  const nowMs = Date.now();
  const transcript = await recentTranscript(id);
  const prevName = room.lastSpeakerId ? roster.find((p) => p.id === room.lastSpeakerId)?.name ?? null : null;
  const pool = aiRoster.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    stance: p.stance,
    eagerness: p.eagerness,
    lastSpokeAtMs: p.lastSpokeAtMs,
  }));

  if (forceInvite) {
    const useModerator = Math.random() < 0.5;
    if (useModerator) {
      const llm = await generateTurnLLM({
        mode: "invite",
        topic: room.topic,
        speakerName: moderator.name,
        role: moderator.role,
        stance: "neutral",
        studentName: room.studentName,
        allNames,
        transcript,
        addressedDirectly: false,
      });
      const text = llm?.text ?? generateModeratorInvite(room.studentName);
      await db
        .update(rooms)
        .set({ currentSpeakerId: moderator.id, pendingAddress: room.studentName })
        .where(eq(rooms.id, id));
      return Response.json({ speaker: moderator, text, addresses: room.studentName, isInvite: true, action: "speak" });
    }

    const picked = pickNextSpeaker(
      pool,
      { topic: room.topic, nowMs, studentName: room.studentName, prevSpeakerName: prevName, prevSpeakerIsStudent: false, pendingAddress: room.pendingAddress, forceInviteStudent: true },
      room.lastSpeakerId
    );
    const llm = await generateTurnLLM({
      mode: "invite",
      topic: room.topic,
      speakerName: picked.name,
      role: picked.role,
      stance: picked.stance as Stance,
      studentName: room.studentName,
      allNames,
      transcript,
      addressedDirectly: false,
    });
    const fallback = llm ? null : generateStudentInviteFromAi(styleForRole(picked.role), picked.stance as Stance, room.studentName, room.topic);
    const text = llm?.text ?? fallback!.text;
    const addresses = llm?.addresses ?? fallback!.addresses;
    await db.update(rooms).set({ currentSpeakerId: picked.id, pendingAddress: addresses }).where(eq(rooms.id, id));
    const full = roster.find((p) => p.id === picked.id)!;
    return Response.json({ speaker: full, text, addresses, isInvite: true, action: "speak" });
  }

  const picked = pickNextSpeaker(
    pool,
    { topic: room.topic, nowMs, studentName: room.studentName, prevSpeakerName: prevName, prevSpeakerIsStudent: false, pendingAddress: room.pendingAddress, forceInviteStudent: false },
    room.lastSpeakerId
  );
  const full = roster.find((p) => p.id === picked.id)!;
  const wasAddressedDirectly = room.pendingAddress === picked.name;
  const style = styleForRole(picked.role);

  let generated: { text: string; addresses: string | null } | null = await generateTurnLLM({
    mode: "turn",
    topic: room.topic,
    speakerName: picked.name,
    role: picked.role,
    stance: picked.stance as Stance,
    studentName: room.studentName,
    allNames,
    transcript,
    addressedDirectly: wasAddressedDirectly,
  });

  // Template fallback (no API key, timeout, invalid JSON, repeated line).
  if (!generated) {
    generated = generateAiTurnText({
      style,
      stance: picked.stance as Stance,
      topic: room.topic,
      prevSpeakerName: prevName,
      prevSpeakerIsStudent: roster.find((p) => p.id === room.lastSpeakerId)?.kind === "student",
      wasAddressedDirectly,
    });
    if (!generated.text || generated.text.trim().length < 8) {
      generated = { text: stockFallbackLine(room.topic), addresses: null };
    }
  }

  await db.update(rooms).set({ currentSpeakerId: picked.id, pendingAddress: generated.addresses }).where(eq(rooms.id, id));
  return Response.json({ speaker: full, text: generated.text, addresses: generated.addresses, isInvite: false, action: "speak" });
}
