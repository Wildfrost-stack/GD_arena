import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { rooms, participants, utterances, feedbackReports } from "@/db/schema";

export type Participant = typeof participants.$inferSelect;
export type Utterance = typeof utterances.$inferSelect;

export async function getRoom(id: string) {
  const [row] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
  return row;
}

export async function getParticipants(roomId: string): Promise<Participant[]> {
  return db
    .select()
    .from(participants)
    .where(eq(participants.roomId, roomId))
    .orderBy(asc(participants.seatIndex));
}

export async function getUtterances(roomId: string): Promise<Utterance[]> {
  return db
    .select()
    .from(utterances)
    .where(eq(utterances.roomId, roomId))
    .orderBy(asc(utterances.startedAtMs));
}

export async function getReport(roomId: string) {
  const [row] = await db
    .select()
    .from(feedbackReports)
    .where(eq(feedbackReports.roomId, roomId))
    .limit(1);
  return row;
}

/** Checks whether the free-discussion timer has lapsed while the floor is
 * open (GAP) and, if so, authoritatively transitions the room into the
 * closing round. This keeps the state machine server-driven even though the
 * client is the one polling for the next turn. */
export async function maybeTransitionToClosing(room: typeof rooms.$inferSelect) {
  if (room.phase !== "GAP" || !room.discussionStartedAt) return room;
  const elapsed = Date.now() - new Date(room.discussionStartedAt).getTime();
  if (elapsed < room.discussionSeconds * 1000) return room;

  const roster = await getParticipants(room.id);
  const aiIds = roster.filter((p) => p.kind === "ai").map((p) => p.id);
  // Shuffle AI ids, then splice the student into a non-first slot so the
  // closing round doesn't always start cold on the student.
  for (let i = aiIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [aiIds[i], aiIds[j]] = [aiIds[j], aiIds[i]];
  }
  const studentSlot = Math.min(aiIds.length, Math.max(1, Math.floor(Math.random() * aiIds.length) + 1));
  const closingOrder = [...aiIds.slice(0, studentSlot), "student", ...aiIds.slice(studentSlot)];

  const closingStartedAt = new Date();
  await db
    .update(rooms)
    .set({
      phase: "CLOSING_ROUND",
      closingStartedAt,
      closingOrder,
      closingPointer: -1,
      consecutiveAiTurns: 0,
      pendingAddress: null,
    })
    .where(eq(rooms.id, room.id));

  return { ...room, phase: "CLOSING_ROUND", closingStartedAt, closingOrder, closingPointer: -1 };
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t.length === 0 ? 0 : t.split(/\s+/).length;
}
