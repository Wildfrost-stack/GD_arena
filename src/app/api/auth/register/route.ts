import { randomUUID } from "crypto";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  clientKey, createSession, hashPassword, normaliseEmail, rateLimited, sessionCookie, validateCredentials,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const email = normaliseEmail(body.email);

  if (!name) return Response.json({ error: "Enter your name so the AIs can address you." }, { status: 400 });
  if (name.length > 60) return Response.json({ error: "Use a shorter name (60 characters at most)." }, { status: 400 });
  const invalid = validateCredentials(email, body.password);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

  if (rateLimited(`reg|${clientKey(req, email)}`, 10)) {
    return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return Response.json({ error: "That email already has an account. Switch to Sign in." }, { status: 409 });
  }

  const id = randomUUID();
  try {
    await db.insert(users).values({ id, email, name, passwordHash: await hashPassword(body.password) });
  } catch {
    // Lost a race with another sign-up for the same email.
    return Response.json({ error: "That email already has an account. Switch to Sign in." }, { status: 409 });
  }

  const { token, expiresAt } = await createSession(id);
  const res = Response.json({ user: { id, name, email } }, { status: 201 });
  res.headers.append("Set-Cookie", sessionCookie(token, expiresAt));
  return res;
}
