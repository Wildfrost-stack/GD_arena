import { db } from "@/db";
import { rooms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getRoom, getParticipants } from "@/lib/db-helpers";
import { generateModeratorOpening } from "@/lib/director";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await getRoom(id);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });
  if (room.phase !== "SETUP") {
    return Response.json({ error: "Room already started" }, { status: 409 });
  }

  const participantRows = await getParticipants(id);
  const moderator = participantRows.find((p) => p.kind === "moderator");
  const aiNames = participantRows.filter((p) => p.kind === "ai").map((p) => p.name);
  if (!moderator) return Response.json({ error: "Moderator missing" }, { status: 500 });

  const startedAt = new Date();
  await db
    .update(rooms)
    .set({ phase: "MODERATOR_OPENING", startedAt, currentSpeakerId: moderator.id })
    .where(eq(rooms.id, id));

  const text = generateModeratorOpening(room.topic, aiNames);

  return Response.json({
    startedAt: startedAt.toISOString(),
    speaker: moderator,
    text,
    addresses: null,
    isInvite: false,
  });
}
