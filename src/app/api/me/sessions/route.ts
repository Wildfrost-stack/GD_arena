import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { feedbackReports, rooms } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The signed-in user's past discussions, newest first.
export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return Response.json({ error: "Sign in to see your past discussions." }, { status: 401 });

  const rows = await db
    .select({
      id: rooms.id,
      topic: rooms.topic,
      roomCode: rooms.roomCode,
      phase: rooms.phase,
      createdAt: rooms.createdAt,
      endedAt: rooms.endedAt,
      overallScore: feedbackReports.overallScore,
      hasReport: feedbackReports.id,
    })
    .from(rooms)
    .leftJoin(feedbackReports, eq(feedbackReports.roomId, rooms.id))
    .where(eq(rooms.userId, user.id))
    .orderBy(desc(rooms.createdAt))
    .limit(50);

  return Response.json({
    sessions: rows.map((r) => ({
      id: r.id,
      topic: r.topic,
      roomCode: r.roomCode,
      phase: r.phase,
      createdAt: r.createdAt,
      endedAt: r.endedAt,
      overallScore: r.hasReport ? r.overallScore : null,
    })),
  });
}
