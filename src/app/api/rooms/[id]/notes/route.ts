import { eq } from "drizzle-orm";
import { db } from "@/db";
import { feedbackReports } from "@/db/schema";
import { getRoom, getReport, getUtterances } from "@/lib/db-helpers";
import { buildNotesHeuristic } from "@/lib/notes";
import { buildNotesLLM } from "@/lib/notesLlm";
import { isLlmEnabled } from "@/lib/llm";
import type { UtteranceLike } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 40;

async function transcript(roomId: string): Promise<UtteranceLike[]> {
  const rows = await getUtterances(roomId);
  return rows.map((r) => ({
    id: r.id, speakerName: r.speakerName, speakerKind: r.speakerKind, renderedText: r.renderedText,
    wasInterrupted: r.wasInterrupted, addresses: r.addresses, startedAtMs: r.startedAtMs, endedAtMs: r.endedAtMs,
    wordCount: r.wordCount, phase: r.phase,
  }));
}

// GET: the final notes once the report exists, otherwise live notes built from
// what has been said so far. Live notes use the free rules only (no model call),
// so the page can ask for them after every turn.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await getRoom(id);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });

  const report = await getReport(id);
  if (report?.notesJson) return Response.json({ notes: report.notesJson, final: true });

  const notes = buildNotesHeuristic({ ordered: await transcript(id), invited: room.invitedFriends ?? [] });
  return Response.json({ notes, final: false });
}

const inflight = new Set<string>();

// POST: rewrite the final notes with the language model, for a finished discussion.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await getRoom(id);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });
  if (room.phase !== "ENDED" || !(await getReport(id))) {
    return Response.json({ error: "The discussion has to finish before the notes can be rewritten." }, { status: 409 });
  }
  if (inflight.has(id)) return Response.json({ error: "Notes are already being rewritten." }, { status: 429 });

  inflight.add(id);
  try {
    const ordered = await transcript(id);
    const invited = room.invitedFriends ?? [];
    const llm = isLlmEnabled() ? await buildNotesLLM({ topic: room.topic, ordered, invited }).catch(() => null) : null;
    const notes = llm ?? buildNotesHeuristic({ ordered, invited });
    await db.update(feedbackReports).set({ notesJson: notes }).where(eq(feedbackReports.roomId, id));
    return Response.json({ notes, final: true });
  } finally {
    inflight.delete(id);
  }
}
