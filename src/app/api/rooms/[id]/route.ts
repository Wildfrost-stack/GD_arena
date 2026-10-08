import { getRoom, getParticipants, getUtterances } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await getRoom(id);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });
  const [participantRows, utteranceRows] = await Promise.all([getParticipants(id), getUtterances(id)]);

  const now = Date.now();
  let discussionRemainingMs: number | null = null;
  let closingRemainingMs: number | null = null;
  if (room.discussionStartedAt) {
    const elapsed = now - new Date(room.discussionStartedAt).getTime();
    discussionRemainingMs = Math.max(0, room.discussionSeconds * 1000 - elapsed);
  }
  if (room.closingStartedAt) {
    const elapsed = now - new Date(room.closingStartedAt).getTime();
    closingRemainingMs = Math.max(0, room.closingSeconds * 1000 - elapsed);
  }

  return Response.json({
    room: {
      ...room,
      serverNowMs: now,
      discussionRemainingMs,
      closingRemainingMs,
    },
    participants: participantRows,
    utterances: utteranceRows,
  });
}
