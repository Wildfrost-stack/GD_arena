import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { friends, users } from "@/db/schema";
import { EMAIL_RE, getSessionUser } from "@/lib/auth";
import { MAX_FRIENDS } from "@/lib/friends";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const unauthorised = () => Response.json({ error: "Sign in to manage friends." }, { status: 401 });

export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return unauthorised();

  const rows = await db.select().from(friends).where(eq(friends.userId, user.id)).orderBy(asc(friends.createdAt));
  return Response.json({
    max: MAX_FRIENDS,
    friends: rows.map((f) => ({ id: f.id, label: f.label, email: f.email, hasAccount: f.friendUserId !== null })),
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return unauthorised();

  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label.trim().replace(/\s+/g, " ") : "";
  if (!label) return Response.json({ error: "Type a name or email to add." }, { status: 400 });
  if (label.length > 60) return Response.json({ error: "Use a shorter name or email (60 characters at most)." }, { status: 400 });

  const labelKey = label.toLowerCase();
  const email = EMAIL_RE.test(label) ? labelKey : null;
  if (email && email === user.email) return Response.json({ error: "That is your own email." }, { status: 400 });

  // Look the email up so the friend is linked to their account when they have one.
  let friendUserId: string | null = null;
  if (email) {
    const found = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    friendUserId = found[0]?.id ?? null;
  }

  // Lock the user's row so two simultaneous adds cannot both slip under the limit.
  const result = await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
    const mine = await tx.select({ labelKey: friends.labelKey }).from(friends).where(eq(friends.userId, user.id));
    if (mine.some((f) => f.labelKey === labelKey)) return { error: `${label} is already invited.`, status: 409 };
    if (mine.length >= MAX_FRIENDS) {
      return { error: `You can invite up to ${MAX_FRIENDS} friends. Remove one to add another.`, status: 400 };
    }
    const id = randomUUID();
    await tx.insert(friends).values({ id, userId: user.id, label, labelKey, email, friendUserId });
    return { friend: { id, label, email, hasAccount: friendUserId !== null } };
  });

  if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ friend: result.friend }, { status: 201 });
}
