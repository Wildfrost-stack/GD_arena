// AI meeting notes: summary, key points, questions raised, action ideas, mood
// and recurring words. Every line points at the transcript moment it came
// from. `buildNotesHeuristic` is deterministic and free, so it serves the live
// panel during the discussion and is the fallback when the LLM is unavailable.

import type { UtteranceLike } from "./metrics";

export interface NoteItem {
  speaker: string; // "You" for the student
  isYou: boolean;
  atSec: number;
  text: string;
  segmentId: string; // utterance id
  seq: number; // 1-based position in the full transcript, shown as S<seq>
}

export interface NotesDTO {
  ready: boolean; // false until at least two people-contributions exist
  summary: string;
  keyPoints: NoteItem[];
  questions: NoteItem[];
  actions: NoteItem[];
  mood: { agreeing: number; pushback: number };
  keywords: string[];
  contributions: number;
  participants: number;
  topSpeaker: string | null;
  invited: string[];
  source: "llm" | "heuristic";
  generatedAt: string;
}

const STOP = new Set(
  "the a an and or but of to in on for is are was it that this with as at be by we you they not so if from have has will can do just more than then there their what who how why about which would should could our your its been were also into very much like really".split(" ")
);

const KEY_RE = /\d|data|study|survey|research|because|reports?|evidence|learn|trust|cost|skills?/i;
const ACTION_RE = /\b(should|must|need to|let us|we can|design)\b/i;
const AGREE_RE = /\b(agree|good point|fair point|building on)\b/i;
const PUSH_RE = /\b(but|however|push back|not true|really true|other side)\b/i;

export const isPlaceholder = (t: string) => t.startsWith("(no ");

export function peopleLines(ordered: UtteranceLike[]) {
  return ordered
    .map((u, i) => ({ u, seq: i + 1 }))
    .filter(({ u }) => u.speakerKind !== "moderator" && !isPlaceholder(u.renderedText));
}

export function itemFor(u: UtteranceLike, seq: number, text: string): NoteItem {
  return {
    speaker: u.speakerKind === "student" ? "You" : u.speakerName,
    isYou: u.speakerKind === "student",
    atSec: Math.round((u.startedAtMs || 0) / 1000),
    text,
    segmentId: u.id,
    seq,
  };
}

/** Counts, mood and keywords. Deterministic, so the LLM notes reuse it. */
export function noteFacts(ordered: UtteranceLike[]) {
  const L = peopleLines(ordered);
  const words: Record<string, number> = {};
  const spoken: Record<string, number> = {};
  let agreeing = 0;
  let pushback = 0;
  for (const { u } of L) {
    const who = u.speakerKind === "student" ? "You" : u.speakerName;
    spoken[who] = (spoken[who] ?? 0) + u.renderedText.split(/\s+/).length;
    if (AGREE_RE.test(u.renderedText)) agreeing++;
    if (PUSH_RE.test(u.renderedText)) pushback++;
    for (const w of u.renderedText.toLowerCase().match(/[a-z]{4,}/g) ?? []) if (!STOP.has(w)) words[w] = (words[w] ?? 0) + 1;
  }
  const keywords = Object.keys(words).sort((a, b) => words[b] - words[a]).slice(0, 7);
  const topSpeaker = Object.keys(spoken).sort((a, b) => spoken[b] - spoken[a])[0] ?? null;
  const participants = new Set(L.map(({ u }) => (u.speakerKind === "student" ? "student" : u.speakerName))).size;
  return { L, keywords, topSpeaker, participants, mood: { agreeing, pushback } };
}

export function summaryLine(contributions: number, participants: number, topSpeaker: string | null, invited: string[]): string {
  let s = `${contributions} contributions from ${participants} ${participants === 1 ? "person" : "people"}.`;
  if (topSpeaker) s += topSpeaker === "You" ? " You have spoken the most." : ` ${topSpeaker} has spoken the most.`;
  if (invited.length) s += ` Invited: ${invited.join(", ")}.`;
  return s;
}

export function buildNotesHeuristic(args: { ordered: UtteranceLike[]; invited: string[] }): NotesDTO {
  const f = noteFacts(args.ordered);
  const base = {
    mood: f.mood,
    keywords: f.keywords,
    contributions: f.L.length,
    participants: f.participants,
    topSpeaker: f.topSpeaker,
    invited: args.invited,
    source: "heuristic" as const,
    generatedAt: new Date().toISOString(),
  };
  if (f.L.length < 2) {
    return { ...base, ready: false, summary: "Notes start filling in once people begin speaking.", keyPoints: [], questions: [], actions: [] };
  }

  const sentences = f.L.flatMap(({ u, seq }) =>
    (u.renderedText.match(/[^.?!]+[.?!]?/g) ?? []).map((t) => ({ t: t.trim(), u, seq })).filter((x) => x.t.length > 12)
  );
  const pick = (re: RegExp, n: number) => sentences.filter((x) => re.test(x.t)).slice(-n).map((x) => itemFor(x.u, x.seq, x.t));

  return {
    ...base,
    ready: true,
    summary: summaryLine(f.L.length, f.participants, f.topSpeaker, args.invited),
    keyPoints: pick(KEY_RE, 4),
    questions: sentences.filter((x) => /\?$/.test(x.t)).slice(-3).map((x) => itemFor(x.u, x.seq, x.t)),
    actions: pick(ACTION_RE, 3),
  };
}
