import { randomUUID } from "crypto";
import { db } from "@/db";
import { rooms, participants } from "@/db/schema";
import { MODERATOR_NAME, pickNames, shufflePersonas, assignStances } from "@/lib/personas";
import { getSessionUser } from "@/lib/auth";
import { friendLabelsFor } from "@/lib/friends";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// No 0/O/1/I, so a code read aloud or typed from a screenshot is hard to get wrong.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeRoomCode(): string {
  let c = "";
  for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `GD-${c}`;
}
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const topic: string = typeof body.topic === "string" ? body.topic.trim() : "";
  const topicCategory: string = body.topicCategory === "custom" ? "custom" : "predefined";
  const participantCount: number = Number(body.participantCount);
  // Signed-in hosts are optional: a guest simply has no user, and gets no saved history.
  const user = await getSessionUser(req);
  const typedName: string = typeof body.studentName === "string" ? body.studentName.trim().slice(0, 40) : "";
  const studentName: string = typedName || (user ? user.name.split(" ")[0].slice(0, 40) : "You");
  const discussionSeconds: number = Math.min(900, Math.max(120, Number(body.discussionSeconds) || 300));
  const closingSeconds: number = Math.min(180, Math.max(45, Number(body.closingSeconds) || 90));

  if (!topic || topic.length < 4) {
    return Response.json({ error: "A topic of at least 4 characters is required." }, { status: 400 });
  }
  if (!Number.isInteger(participantCount) || participantCount < 3 || participantCount > 5) {
    return Response.json({ error: "participantCount must be an integer between 3 and 5." }, { status: 400 });
  }

  const roomId = randomUUID();
  const turnCap = Math.random() < 0.5 ? 2 : 3;

  const personas = shufflePersonas(participantCount);
  const stances = assignStances(participantCount);
  const names = pickNames(personas.map((p) => p.voiceGenderHint));

  const invitedFriends = user ? await friendLabelsFor(user.id) : [];

  let roomCode = makeRoomCode();
  for (let attempt = 0; ; attempt++) {
    try {
      await db.insert(rooms).values({
        id: roomId,
        topic,
        topicCategory,
        participantCount,
        studentName,
        phase: "SETUP",
        discussionSeconds,
        closingSeconds,
        turnCap,
        userId: user?.id ?? null,
        roomCode,
        invitedFriends,
      });
      break;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= 5) throw err;
      roomCode = makeRoomCode(); // a code collided; draw another
    }
  }

  const moderatorId = randomUUID();
  const studentId = randomUUID();

  await db.insert(participants).values([
    {
      id: moderatorId,
      roomId,
      kind: "moderator",
      name: MODERATOR_NAME,
      role: "The Moderator",
      stance: "neutral",
      eagerness: 0,
      voiceRate: 0.95,
      voicePitch: 1.05,
      voiceGenderHint: "female",
      colorHex: "#111827",
      avatarEmoji: "🎙️",
      seatIndex: 0,
    },
    ...personas.map((p, i) => ({
      id: randomUUID(),
      roomId,
      kind: "ai",
      name: names[i],
      role: p.role,
      stance: stances[i],
      eagerness: p.eagerness,
      voiceRate: p.voiceRate,
      voicePitch: p.voicePitch,
      voiceGenderHint: p.voiceGenderHint,
      colorHex: p.colorHex,
      avatarEmoji: p.avatarEmoji,
      seatIndex: i + 1,
    })),
    {
      id: studentId,
      roomId,
      kind: "student",
      name: studentName,
      role: "Student",
      stance: "neutral",
      eagerness: 0,
      voiceRate: 1,
      voicePitch: 1,
      voiceGenderHint: "neutral",
      colorHex: "#0ea5e9",
      avatarEmoji: "🧑‍🎓",
      seatIndex: participantCount + 1,
    },
  ]);

  return Response.json({ roomId, roomCode, invitedFriends });
}
