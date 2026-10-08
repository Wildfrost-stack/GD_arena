import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Always 200: `user` is null for guests, so the page can decide whether to show the sign-in form.
export async function GET(req: Request) {
  const user = await getSessionUser(req);
  return Response.json({ user });
}
