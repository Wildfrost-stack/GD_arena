import { db } from "@/db";
import { rooms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getRoom, getUtterances } from "@/lib/db-helpers";
import { generateAndStoreReport } from "@/lib/reportService";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

// "End session now": lets the student leave early (or recover from a stuck
// room) and still get a report built from whatever was said so far.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await getRoom(id);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });

  const rows = await getUtterances(id);
  if (rows.length === 0) {
    return Response.json({ error: "Nothing has been said yet, so there is nothing to report." }, { status: 400 });
  }

  if (room.phase !== "ENDED") {
    await db
      .update(rooms)
      .set({ phase: "ENDED", endedAt: new Date(), currentSpeakerId: null })
      .where(eq(rooms.id, id));
  }
  await generateAndStoreReport(id);
  return Response.json({ ok: true });
}
