import { db } from "@/db";
import { rooms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getRoom } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

// Resilience: called once when a client (re)mounts the room page. If the
// room was left mid-turn (e.g. tab refresh or dropped connection while an
// utterance was in flight), nobody will ever finalize that turn, so the
// floor-control state machine would deadlock. We recover deterministically
// by returning the affected phase to a safe, resumable state.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await getRoom(id);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });

  if (room.phase === "MODERATOR_OPENING") {
    await db.update(rooms).set({ phase: "SETUP", currentSpeakerId: null }).where(eq(rooms.id, id));
  } else if (room.phase === "AI_SPEAKING" || room.phase === "STUDENT_SPEAKING") {
    await db
      .update(rooms)
      .set({ phase: "GAP", currentSpeakerId: null, consecutiveAiTurns: 0, pendingAddress: null })
      .where(eq(rooms.id, id));
  }

  const fresh = await getRoom(id);
  return Response.json({ room: fresh });
}
