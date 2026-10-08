import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { friends } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req);
  if (!user) return Response.json({ error: "Sign in to manage friends." }, { status: 401 });

  const { id } = await params;
  const removed = await db
    .delete(friends)
    .where(and(eq(friends.id, id), eq(friends.userId, user.id)))
    .returning({ id: friends.id });
  if (removed.length === 0) return Response.json({ error: "Friend not found." }, { status: 404 });
  return Response.json({ ok: true });
}
