import { db } from "@/db";
import { rooms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getRoom } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

// Called the instant client-side VAD detects the student speaking over an
// AI turn. This is the server-authoritative floor flip; the client has
// already stopped local audio playback for perceived instant response.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await getRoom(id);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });

  if (room.phase === "AI_SPEAKING" || room.phase === "MODERATOR_OPENING") {
    await db
      .update(rooms)
      .set({ phase: "STUDENT_SPEAKING", consecutiveAiTurns: 0 })
      .where(eq(rooms.id, id));
    return Response.json({ phase: "STUDENT_SPEAKING", interruptedSpeakerId: room.currentSpeakerId });
  }

  return Response.json({ phase: room.phase, interruptedSpeakerId: null });
}
