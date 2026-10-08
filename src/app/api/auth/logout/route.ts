import { clearedCookie, destroySession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  await destroySession(req);
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", clearedCookie());
  return res;
}
