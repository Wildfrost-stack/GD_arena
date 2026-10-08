// Accounts and sessions. No extra dependencies: scrypt and SHA-256 come from
// Node's crypto. A session is a random token in an HttpOnly cookie; only its
// SHA-256 is stored in the database.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";

export const SESSION_COOKIE = "gda_session";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

// ---------- passwords ----------

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

const DUMMY_SALT = Buffer.alloc(16, 7);

/** Always does one scrypt, even for an unknown account, so response time does not reveal which emails exist. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = stored ? stored.split("$") : [];
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    await scryptAsync(password, DUMMY_SALT, 64);
    return false;
  }
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = await scryptAsync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------- input rules (match the sign-up form) ----------

export const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function normaliseEmail(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

export function validateCredentials(email: string, password: unknown): string | null {
  if (!EMAIL_RE.test(email) || email.length > 254) return "Enter a valid email, like you@example.com.";
  if (typeof password !== "string" || password.length < 6) return "Use a password with at least 6 characters.";
  if (password.length > 200) return "That password is too long.";
  return null;
}

// ---------- sessions ----------

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

function tokenFromRequest(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** The signed-in user, or null for guests. Never throws on a bad or expired cookie. */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function destroySession(req: Request): Promise<void> {
  const token = tokenFromRequest(req);
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

const secure = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");

export function sessionCookie(token: string, expiresAt: Date): string {
  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure()}`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;
}

// ---------- brute-force guard (per server process) ----------

const attempts = new Map<string, { count: number; resetAt: number }>();

/** Returns true when the caller is over the limit. */
export function rateLimited(key: string, max = 10, windowMs = 15 * 60 * 1000): boolean {
  const now = Date.now();
  const hit = attempts.get(key);
  if (!hit || hit.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  hit.count += 1;
  return hit.count > max;
}

export function clientKey(req: Request, email: string): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  return `${ip}|${email}`;
}
