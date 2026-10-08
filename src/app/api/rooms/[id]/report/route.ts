import { getRoom, getReport, getUtterances, getParticipants } from "@/lib/db-helpers";
import { ensureExtras } from "@/lib/reportService";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await getRoom(id);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });

  await ensureExtras(id); // reports saved before v3 get their comparison and notes on first read
  const report = await getReport(id);
  const [utteranceRows, participantRows] = await Promise.all([getUtterances(id), getParticipants(id)]);

  return Response.json({
    room,
    report,
    utterances: utteranceRows,
    participants: participantRows,
  });
}
