// "You against the table": the same five scores for every member (you and each
// AI), a ranking, and a personality archetype. Port of the v3 page's rules, so
// numbers match what the page used to compute in the browser. Words and
// patterns only; it cannot see tone or body language.

import type { UtteranceLike } from "./metrics";

export type DimKey = "part" | "clar" | "evid" | "listen" | "init";
export type Archetype = "Driver" | "Analyst" | "Diplomat" | "Explorer" | "Observer";

const DIMENSIONS: { key: DimKey; label: string; tip: string }[] = [
  { key: "part", label: "Participation", tip: "Take a fair share: two or three short turns every minute." },
  { key: "clar", label: "Clarity", tip: 'Aim for about 20 words a turn and drop fillers such as "basically".' },
  { key: "evid", label: "Evidence", tip: 'Back each claim with one number, example or reason that starts with "because".' },
  { key: "listen", label: "Listening", tip: 'Name the person you build on, for example "Priya, adding to your point".' },
  { key: "init", label: "Initiative", tip: "Open a thread or ask a question instead of waiting to be asked." },
];

const ARCHETYPE_TEXT: Record<Archetype, string> = {
  Driver: "You move the room. You speak early and often, and others follow. Watch for crowding out quieter voices.",
  Analyst: "You argue with proof. Your points are clear and reasoned. Link your facts back to what others just said.",
  Diplomat: "You connect people. You listen, name others and keep the tone steady. Do not hide your own position behind agreement.",
  Explorer: "You ask the question nobody asked and open new angles. Finish each thread before starting the next.",
  Observer: "You hold back and take it in. Speak earlier next time, since a report can only score what was said.",
};

const FILL = /\b(um+|uh+|like|basically|actually|you know|kind of|sort of)\b/gi;
const EVIDENCE = /\d|\b(data|study|studies|survey|research|example|for instance|because|evidence)\b/gi;
const BUILDS = /\b(agree|good point|fair point|building on|to add)\b/gi;

const clamp = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const isPlaceholder = (t: string) => t.startsWith("(no ");

export interface RosterMember {
  id: string;
  kind: string; // 'moderator' | 'ai' | 'student'
  name: string;
}

interface Member {
  key: string; // 'student' or the participant id
  name: string;
  isYou: boolean;
}

interface Scores {
  turns: number;
  words: number;
  part: number;
  clar: number;
  evid: number;
  listen: number;
  init: number;
  q: number;
  all: number;
}

export interface ComparisonDTO {
  me: {
    name: string;
    spoke: boolean;
    archetype: Archetype;
    archetypeText: string;
    overall: number;
    rank: number;
    of: number;
    turns: number;
    words: number;
    scores: Record<DimKey, number>;
    improveNext: { key: DimKey; label: string; score: number; tip: string }[];
    keepDoing: { key: DimKey; label: string; score: number };
    longestLine: { text: string; segmentId: string; seq: number } | null;
  };
  averages: Record<DimKey, number>; // mean of the AI members
  table: { name: string; isYou: boolean; words: number; turns: number; score: number }[];
  note: string;
}

const nameToken = (name: string) => name.trim().split(/\s+/).pop()!.replace(/[^\w]/g, "");

function score(texts: string[], others: string[], totalWords: number, n: number): Scores {
  const t = texts.length;
  const x = texts.join(" ");
  const w = (x.match(/\S+/g) ?? []).length;
  if (!t || !w) return { turns: t, words: w, part: 0, clar: 0, evid: 0, listen: 0, init: 0, q: 0, all: 0 };

  const names = others.filter(Boolean);
  const nameHits = names.length ? (x.match(new RegExp(`\\b(${names.join("|")})\\b`, "gi")) ?? []).length : 0;
  const refs = nameHits + (x.match(BUILDS) ?? []).length;
  const qn = (x.match(/\?/g) ?? []).length;
  const fl = (x.match(FILL) ?? []).length;
  const ev = (x.match(EVIDENCE) ?? []).length;

  const part = clamp((w / totalWords) * n * 70);
  const clar = clamp(100 - (fl / w) * 600 - Math.abs(w / t - 22) * 1.5);
  const evid = clamp((ev / t) * 60);
  const listen = clamp((refs / t) * 70);
  const init = clamp(t * 12 + qn * 18);
  const q = clamp((qn / t) * 140);
  return { turns: t, words: w, part, clar, evid, listen, init, q, all: Math.round((part + clar + evid + listen + init) / 5) };
}

export function buildComparison(args: {
  ordered: UtteranceLike[]; // every utterance, in transcript order (this order defines "seq")
  roster: RosterMember[];
  studentName: string;
}): ComparisonDTO {
  const { ordered, roster } = args;
  const ais = roster.filter((p) => p.kind === "ai");
  const moderator = roster.find((p) => p.kind === "moderator");

  const members: Member[] = [
    { key: "student", name: args.studentName || "You", isYou: true },
    ...ais.map((a) => ({ key: a.id, name: a.name, isYou: false })),
  ];

  // Utterance text per member. AI utterances are matched by speaker name (names are unique within a room).
  const aiByName = new Map(ais.map((a) => [a.name, a.id]));
  const texts = new Map<string, string[]>(members.map((m) => [m.key, []]));
  let totalWords = 0;
  ordered.forEach((u) => {
    if (u.speakerKind === "moderator" || isPlaceholder(u.renderedText)) return;
    totalWords += (u.renderedText.match(/\S+/g) ?? []).length;
    const key = u.speakerKind === "student" ? "student" : aiByName.get(u.speakerName);
    if (key && texts.has(key)) texts.get(key)!.push(u.renderedText);
  });
  totalWords = Math.max(1, totalWords);

  const scored = members.map((m) => {
    const others = [...members.filter((o) => o.key !== m.key).map((o) => nameToken(o.name)), moderator ? nameToken(moderator.name) : ""];
    return { m, s: score(texts.get(m.key)!, others, totalWords, members.length) };
  });

  const me = scored[0].s;
  const oth = scored.slice(1);
  const avg = (k: DimKey) => (oth.length ? oth.reduce((a, r) => a + r.s[k], 0) / oth.length : 0);

  const ranked = scored.slice().sort((a, b) => b.s.all - a.s.all); // stable: ties keep "you" first
  const weakestFirst = DIMENSIONS.slice().sort((a, b) => me[a.key] - me[b.key]);

  const c: Record<string, number> = {
    Driver: me.part * 0.5 + me.init * 0.5,
    Analyst: me.evid * 0.6 + me.clar * 0.4,
    Diplomat: me.listen * 0.7 + me.clar * 0.3,
    Explorer: me.q * 0.6 + me.init * 0.4,
  };
  let archetype = Object.keys(c).sort((a, b) => c[b] - c[a])[0] as Archetype;
  if (me.turns < 2) archetype = "Observer";

  let longest: { text: string; segmentId: string; seq: number } | null = null;
  ordered.forEach((u, i) => {
    if (u.speakerKind !== "student" || isPlaceholder(u.renderedText)) return;
    if (!longest || u.renderedText.length > longest.text.length) longest = { text: u.renderedText, segmentId: u.id, seq: i + 1 };
  });

  const strongest = weakestFirst[weakestFirst.length - 1];
  const round = (n: number) => Math.round(n);
  return {
    me: {
      name: members[0].name,
      spoke: me.turns > 0,
      archetype,
      archetypeText: ARCHETYPE_TEXT[archetype],
      overall: me.all,
      rank: ranked.findIndex((r) => r.m.isYou) + 1,
      of: members.length,
      turns: me.turns,
      words: me.words,
      scores: { part: round(me.part), clar: round(me.clar), evid: round(me.evid), listen: round(me.listen), init: round(me.init) },
      improveNext: weakestFirst.slice(0, 2).map((d) => ({ key: d.key, label: d.label, score: round(me[d.key]), tip: d.tip })),
      keepDoing: { key: strongest.key, label: strongest.label, score: round(me[strongest.key]) },
      longestLine: longest,
    },
    averages: { part: round(avg("part")), clar: round(avg("clar")), evid: round(avg("evid")), listen: round(avg("listen")), init: round(avg("init")) },
    table: ranked.map((r) => ({ name: r.m.name, isYou: r.m.isYou, words: r.s.words, turns: r.s.turns, score: r.s.all })),
    note: "Scores come from words and patterns only, with the same rules for every member. They cannot see tone or body language.",
  };
}
