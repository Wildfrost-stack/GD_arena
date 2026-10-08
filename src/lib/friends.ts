import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { friends } from "@/db/schema";

export const MAX_FRIENDS = 4;

/** Labels of everyone the user has invited, oldest first. Snapshotted onto a room when it is created. */
export async function friendLabelsFor(userId: string): Promise<string[]> {
  const rows = await db
    .select({ label: friends.label })
    .from(friends)
    .where(eq(friends.userId, userId))
    .orderBy(asc(friends.createdAt));
  return rows.map((r) => r.label);
}
