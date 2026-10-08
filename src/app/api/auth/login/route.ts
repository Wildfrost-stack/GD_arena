import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { clientKey, createSession, normaliseEmail, rateLimited, sessionCookie, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = normaliseEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) return Response.json({ error: "Enter your email and password." }, { status: 400 });
  if (rateLimited(`login|${clientKey(req, email)}`, 10)) {
    return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0] ?? null;
  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  // One message for both cases, so the form cannot be used to find out which emails have accounts.
  if (!user || !ok) return Response.json({ error: "Email or password is incorrect." }, { status: 401 });

  const { token, expiresAt } = await createSession(user.id);
  const res = Response.json({ user: { id: user.id, name: user.name, email: user.email } });
  res.headers.append("Set-Cookie", sessionCookie(token, expiresAt));
  return res;
}
