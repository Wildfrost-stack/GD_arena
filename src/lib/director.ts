// The "AI Director" — a deterministic, rule-based speaker-selection and
// speech-generation engine. It plays the role the spec assigns to an LLM
// call ("single call per turn returning structured JSON: speaker, text,
// addresses") but is implemented without any third-party model so the app
// runs fully offline/self-hosted. Floor allocation itself never lives here —
// callers (the room state machine in the API layer) decide *when* a turn is
// requested; this module only decides *who* speaks and *what* they say.

export type Stance = "for" | "against" | "neutral";

export interface DirectorParticipant {
  id: string;
  name: string;
  role: string;
  stance: string;
  eagerness: number;
  lastSpokeAtMs: number;
}

export interface TurnContext {
  topic: string;
  nowMs: number;
  studentName: string;
  prevSpeakerName: string | null;
  prevSpeakerIsStudent: boolean;
  pendingAddress: string | null; // someone directly addressed on the previous turn
  forceInviteStudent: boolean;
}

export interface DirectorOutput {
  speakerId: string;
  text: string;
  addresses: string | null;
  isInvite: boolean;
}

const MAX_WORDS = 62; // keeps spoken turns inside the 15-25s cap at natural pace

function cleanTopic(topic: string): string {
  return topic.replace(/[?.]+$/g, "").trim();
}

export function capWords(text: string): string {
  const words = text.split(/\s+/);
  if (words.length <= MAX_WORDS) return text;
  return words.slice(0, MAX_WORDS).join(" ") + "...";
}

const OPENERS = [
  "Honestly,",
  "Look,",
  "If you ask me,",
  "From where I stand,",
  "Here's the thing —",
  "I'll be direct:",
  "Let's be real,",
  "To be fair,",
];

const BUILD_OPENERS = (prev: string) => [
  `Building on what ${prev} just said,`,
  `Picking up on ${prev}'s point,`,
  `I actually agree with ${prev} that`,
  `${prev} raises something important, and`,
];

const COUNTER_OPENERS = (prev: string) => [
  `I see it differently from ${prev}.`,
  `I have to push back on ${prev} a little.`,
  `Respectfully, I don't fully buy ${prev}'s take.`,
  `${prev} makes a fair point, but`,
];

const STANCE_CLAUSE: Record<Stance, string[]> = {
  for: [
    "we really need to embrace {topic}",
    "{topic} is, on balance, a good thing",
    "the benefits of {topic} clearly outweigh the costs",
    "we should be actively pushing for {topic}",
  ],
  against: [
    "we should be cautious about {topic}",
    "{topic} causes more problems than it solves",
    "the risks of {topic} are being seriously underestimated",
    "we shouldn't rush into {topic} without safeguards",
  ],
  neutral: [
    "there's more nuance to {topic} than people admit",
    "{topic} depends a lot on how it's implemented",
    "both sides of {topic} have a point worth hearing",
    "we need to weigh the trade-offs of {topic} case by case",
  ],
};

const STYLE_SUPPORT: Record<string, string[]> = {
  analyst: [
    "The numbers I've seen generally back this up.",
    "If you look at the data trends, this pattern holds.",
    "Statistically speaking, this isn't just a one-off case.",
  ],
  contrarian: [
    "But nobody wants to say the uncomfortable part out loud.",
    "Everyone agreeing too fast usually means we're missing something.",
    "I'll play devil's advocate here just to stress-test this.",
  ],
  optimist: [
    "And honestly, I think things will work out better than we fear.",
    "There's a silver lining here that we shouldn't ignore.",
    "I'm genuinely hopeful this pushes things in a good direction.",
  ],
  pragmatist: [
    "Practically speaking, this is what actually works on the ground.",
    "At the end of the day, implementation matters more than theory.",
    "We need a plan that survives contact with reality.",
  ],
  storyteller: [
    "I've personally seen this play out, and it wasn't pretty.",
    "This reminds me of a real example that proves the point.",
    "A friend of mine went through exactly this situation.",
  ],
  skeptic: [
    "But I'm not fully convinced the evidence is strong enough.",
    "I'd want to see this tested before fully buying in.",
    "Call me doubtful, but that claim needs more proof.",
  ],
  enthusiast: [
    "And honestly, that's exactly why this excites me so much!",
    "This is the kind of change we should be running toward!",
    "I genuinely can't wait to see where this goes next.",
  ],
  diplomat: [
    "Maybe there's a middle ground we can all agree on here.",
    "I think both sides are closer than they realize.",
    "Let's find the part of this we can actually agree on.",
  ],
  visionary: [
    "Zoom out for a second — this could reshape things long-term.",
    "Ten years from now, this decision will look very different.",
    "We should be designing for where this is all heading.",
  ],
  realist: [
    "Let's not get carried away — the constraints here are real.",
    "In practice, resources and politics will limit how far this goes.",
    "We have to be honest about what's actually achievable.",
  ],
};

const MODERATOR_OPENING_TEMPLATES = (topic: string, names: string[]) => [
  `Welcome everyone. Today's discussion topic is: "${topic}". I'll be moderating. Let's keep this focused, respectful, and evidence-based. ${names.join(
    ", "
  )}, and you — feel free to jump in naturally. Let's begin: what's everyone's initial take on this?`,
  `Good to have you all here. Our topic for today is "${topic}". As moderator, I'll keep time and bring in quieter voices. I'd love to hear a range of views — including yours. Who wants to open us up?`,
];

const MODERATOR_INVITE_TEMPLATES = (student: string) => [
  `Let's pause there for a second. ${student}, we haven't heard from you in a bit — what's your take on this?`,
  `Before we continue, I want to bring ${student} in. What do you think about the point just made?`,
  `${student}, jump in whenever — what's your honest reaction to that?`,
];

const AI_INVITE_TEMPLATES = (student: string, _topic: string) => [
  `Actually, I'm curious what ${student} thinks about this — what's your take?`,
  `${student}, you've been listening closely — what would you add here?`,
  `I'd genuinely like to hear ${student}'s view before I go further.`,
];

const MODERATOR_CLOSING_PROMPT_TEMPLATES = (topic: string) => [
  `We're almost out of time on "${topic}". Let's move to closing statements — one crisp takeaway from each of you.`,
  `Time's nearly up, so let's wrap with closing thoughts. Keep it short and sharp.`,
];

const MODERATOR_CLOSING_WRAP = (topic: string) => [
  `That's a wrap on "${topic}". Thanks everyone for a sharp, respectful discussion — some genuinely different perspectives came through today.`,
  `Great discussion on "${topic}". I appreciated the range of views and how everyone engaged with each other's points. Session closed.`,
];

const CLOSING_LINE_TEMPLATES: Record<string, string[]> = {
  analyst: ["My closing point: the evidence leans toward {stanceShort}, and that should guide us."],
  contrarian: ["I'll leave you with this: don't settle on an answer just because it's comfortable."],
  optimist: ["My takeaway: I remain hopeful that {stanceShort} is the right direction if we stay thoughtful."],
  pragmatist: ["Bottom line for me: whatever we decide has to actually work in practice."],
  storyteller: ["To close, remember the real people behind this — that's what should guide the decision."],
  skeptic: ["My final word: let's keep questioning this until the evidence is airtight."],
  enthusiast: ["Closing thought: I'm excited about where this could go if we commit to it!"],
  diplomat: ["To wrap up, I think we found more common ground today than we expected."],
  visionary: ["Last thought: think long-term — today's choice shapes tomorrow's reality."],
  realist: ["Finally: let's stay grounded in what's achievable, not just what's ideal."],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fillTopic(template: string, topic: string): string {
  return template.replace(/\{topic\}/g, topic);
}

export function generateModeratorOpening(topic: string, aiNames: string[]): string {
  return capWords(pick(MODERATOR_OPENING_TEMPLATES(cleanTopic(topic), aiNames)));
}

export function generateModeratorInvite(studentName: string): string {
  return capWords(pick(MODERATOR_INVITE_TEMPLATES(studentName)));
}

export function generateModeratorClosingPrompt(topic: string): string {
  return capWords(pick(MODERATOR_CLOSING_PROMPT_TEMPLATES(cleanTopic(topic))));
}

export function generateModeratorClosingWrap(topic: string): string {
  return capWords(pick(MODERATOR_CLOSING_WRAP(cleanTopic(topic))));
}

export function generateAiClosingLine(style: string, stance: Stance): string {
  const stanceShort =
    stance === "for" ? "moving forward with it" : stance === "against" ? "staying cautious" : "a balanced approach";
  const templates = CLOSING_LINE_TEMPLATES[style] ?? CLOSING_LINE_TEMPLATES.realist;
  return capWords(pick(templates).replace("{stanceShort}", stanceShort));
}

export function generateAiInvite(studentName: string, topic: string): string {
  return capWords(pick(AI_INVITE_TEMPLATES(studentName, cleanTopic(topic))));
}

export interface GenerateArgs {
  style: string;
  stance: Stance;
  topic: string;
  prevSpeakerName: string | null;
  prevSpeakerIsStudent: boolean;
  wasAddressedDirectly: boolean;
}

export function generateAiTurnText(args: GenerateArgs): { text: string; addresses: string | null } {
  // Topics are usually full sentences ("Should X do Y?"), so they cannot be
  // spliced into noun-phrase slots; refer to the issue generically instead.
  const stanceClause = fillTopic(pick(STANCE_CLAUSE[args.stance]), "this issue");
  const support = pick(STYLE_SUPPORT[args.style] ?? STYLE_SUPPORT.realist);

  let opener: string;
  if (args.prevSpeakerName && Math.random() < 0.7) {
    opener = args.wasAddressedDirectly || Math.random() < 0.5
      ? pick(BUILD_OPENERS(args.prevSpeakerName))
      : pick(COUNTER_OPENERS(args.prevSpeakerName));
  } else {
    opener = pick(OPENERS);
  }

  const clause = /[.!?]$/.test(opener) ? stanceClause.charAt(0).toUpperCase() + stanceClause.slice(1) : stanceClause;
  const text = capWords(`${opener} ${clause}. ${support}`);
  return { text, addresses: null };
}

export function generateStudentInviteFromAi(
  style: string,
  stance: Stance,
  studentName: string,
  topic: string
): { text: string; addresses: string } {
  const base = generateAiTurnText({
    style,
    stance,
    topic,
    prevSpeakerName: null,
    prevSpeakerIsStudent: false,
    wasAddressedDirectly: false,
  });
  const invite = pick(AI_INVITE_TEMPLATES(studentName, cleanTopic(topic)));
  return { text: capWords(`${base.text} ${invite}`), addresses: studentName };
}

// ---- Speaker scoring (floor-allocation input, NOT floor-allocation itself) ----

export function scoreParticipant(
  p: DirectorParticipant,
  ctx: TurnContext,
  excludeId: string | null
): number {
  if (p.id === excludeId) return -Infinity;
  const secondsSinceLast = p.lastSpokeAtMs === 0 ? 999 : (ctx.nowMs - p.lastSpokeAtMs) / 1000;
  const recencyBonus = Math.min(secondsSinceLast / 30, 1) * 0.4;
  const addressedBonus = ctx.pendingAddress && ctx.pendingAddress === p.name ? 0.6 : 0;
  const jitter = Math.random() * 0.1;
  return p.eagerness * 0.5 + recencyBonus + addressedBonus + jitter;
}

export function pickNextSpeaker(
  pool: DirectorParticipant[],
  ctx: TurnContext,
  excludeId: string | null
): DirectorParticipant {
  let best = pool[0];
  let bestScore = -Infinity;
  for (const p of pool) {
    const s = scoreParticipant(p, ctx, excludeId);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

// Stock fallback line used when generation/validation fails (single-retry
// fallback per spec 3.2).
export function stockFallbackLine(_topic: string): string {
  return `That's an interesting point. Let's keep exploring this a bit further — what else matters here?`;
}
