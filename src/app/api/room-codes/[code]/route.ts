import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rooms } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Looks a shared room code up. It only returns what a friend needs to recognise
// the room; the room id itself is never revealed through a code.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalised = decodeURIComponent(code).trim().toUpperCase();
  if (!/^GD-[A-Z0-9]{4}$/.test(normalised)) return Response.json({ error: "That is not a valid room code." }, { status: 400 });

  const rows = await db.select().from(rooms).where(eq(rooms.roomCode, normalised)).limit(1);
  const room = rows[0];
  if (!room) return Response.json({ error: "No room has that code." }, { status: 404 });

  return Response.json({
    code: room.roomCode,
    topic: room.topic,
    phase: room.phase,
    host: room.studentName,
    aiParticipants: room.participantCount,
    discussionSeconds: room.discussionSeconds,
    open: room.phase === "SETUP",
  });
}
