import { UtteranceLike, computeMetrics, TranscriptMetrics } from "./metrics";

export interface RubricItem {
  criterion: string;
  label: string;
  score: number; // 1-5
  comment: string;
  quote: string | null;
  segmentId: string | null;
  verified: boolean;
}

export interface Suggestion {
  criterion: string;
  label: string;
  suggestion: string;
  kind?: "improve" | "missed";
  momentQuote?: string | null;
  momentSegmentId?: string | null;
}

const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","be","been","to","of","in","on","for","and","or","but","it","this","that",
  "i","you","we","they","he","she","with","as","at","by","from","its","their","our","your","not","so","if","do",
  "does","did","just","about","than","then","there","here","what","when","where","why","how","can","could","would",
  "should","will","shall","also","very","really","some","any","all","more","most","such","who",
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function overlapScore(a: string, b: string): number {
  const wa = new Set(contentWords(a));
  const wb = new Set(contentWords(b));
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
}

/** Server-side quote verification safeguard: a claim's quote must appear
 * verbatim inside the transcript segment it cites. Quotes are always
 * derived directly from stored segment text, but we still verify
 * defensively, matching the architecture's "reject & regenerate" contract. */
export function verifyQuote(quote: string, segment: UtteranceLike | undefined): boolean {
  if (!segment) return false;
  // trimQuote() appends "..." to long quotes; that suffix is display-only.
  const q = quote.replace(/(\.\.\.|…)$/, "").trim();
  return q.length > 0 && segment.renderedText.includes(q);
}

function clampScore(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n * 10) / 10));
}

export function trimQuote(text: string, maxLen = 220): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trim() + "...";
}

export function buildRubric(
  topic: string,
  studentName: string,
  utterances: UtteranceLike[],
  metrics: TranscriptMetrics
): RubricItem[] {
  const ordered = [...utterances].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const studentUtterances = ordered.filter((u) => u.speakerKind === "student");
  const aiNames = new Set(ordered.filter((u) => u.speakerKind !== "student").map((u) => u.speakerName));

  const rubric: RubricItem[] = [];

  // 1. Starting strong — did the student speak early, substantively?
  {
    const firstIdx = ordered.findIndex((u) => u.speakerKind === "student");
    const totalTurns = ordered.length || 1;
    let score = 2;
    let comment = `${studentName} did not speak early in the discussion.`;
    let quote: string | null = null;
    let segmentId: string | null = null;
    if (firstIdx >= 0) {
      const earlyRatio = firstIdx / totalTurns;
      const seg = studentUtterances[0];
      const substantial = seg.wordCount >= 12;
      score = earlyRatio < 0.3 ? (substantial ? 5 : 3.5) : earlyRatio < 0.6 ? 3 : 2;
      comment = earlyRatio < 0.3
        ? `${studentName} entered the discussion early and set a clear position.`
        : `${studentName} waited a while before speaking up for the first time.`;
      quote = trimQuote(seg.renderedText);
      segmentId = seg.id;
    }
    rubric.push({ criterion: "starting", label: "Starting Strong", score: clampScore(score), comment, quote, segmentId, verified: quote ? verifyQuote(quote, seg(ordered, segmentId)) : false });
  }

  // 2. Idea quality — longest / most substantive student contribution.
  {
    let score = 2;
    let comment = `${studentName} did not contribute a developed idea this session.`;
    let quote: string | null = null;
    let segmentId: string | null = null;
    if (studentUtterances.length > 0) {
      const best = [...studentUtterances].sort((a, b) => b.wordCount - a.wordCount)[0];
      const topicWords = new Set(contentWords(topic));
      const ideaWords = contentWords(best.renderedText);
      const relevance = ideaWords.filter((w) => topicWords.has(w)).length;
      score = Math.min(5, 2 + best.wordCount / 12 + relevance * 0.3);
      comment = best.wordCount >= 20
        ? `${studentName} offered a reasonably developed, topic-relevant point.`
        : `${studentName}'s contributions were brief — developing ideas further would strengthen this.`;
      quote = trimQuote(best.renderedText);
      segmentId = best.id;
    }
    rubric.push({ criterion: "ideaQuality", label: "Idea Quality", score: clampScore(score), comment, quote, segmentId, verified: quote ? verifyQuote(quote, seg(ordered, segmentId)) : false });
  }

  // 3. Building on others — references to other participants' points.
  {
    let score = 2;
    let comment = `${studentName} mostly spoke independently without referencing others' points.`;
    let quote: string | null = null;
    let segmentId: string | null = null;
    const buildPatterns = /(agree|disagree|building on|like .* said|as .* mentioned|good point|that's true|follow(ing)? up|adding to)/i;
    const candidate = studentUtterances.find((u) => {
      const mentionsName = Array.from(aiNames).some((n) => u.renderedText.includes(n));
      return buildPatterns.test(u.renderedText) || mentionsName;
    });
    if (candidate) {
      score = 4.3;
      comment = `${studentName} explicitly engaged with another participant's point, strengthening the group dynamic.`;
      quote = trimQuote(candidate.renderedText);
      segmentId = candidate.id;
    }
    rubric.push({ criterion: "buildingOnOthers", label: "Building on Others", score: clampScore(score), comment, quote, segmentId, verified: quote ? verifyQuote(quote, seg(ordered, segmentId)) : false });
  }

  // 4. Listening — content overlap between a student turn and the prior AI turn.
  {
    let score = 2;
    let comment = `${studentName}'s responses showed limited direct connection to what was just said.`;
    let quote: string | null = null;
    let segmentId: string | null = null;
    let bestOverlap = 0;
    let bestPairIdx = -1;
    ordered.forEach((u, idx) => {
      if (u.speakerKind !== "student" || idx === 0) return;
      const prev = ordered[idx - 1];
      if (prev.speakerKind === "student") return;
      const ov = overlapScore(u.renderedText, prev.renderedText);
      if (ov > bestOverlap) {
        bestOverlap = ov;
        bestPairIdx = idx;
      }
    });
    if (bestPairIdx >= 0) {
      const seg2 = ordered[bestPairIdx];
      score = 2 + bestOverlap * 6;
      comment = bestOverlap > 0.15
        ? `${studentName} directly responded to the point just made, showing active listening.`
        : `${studentName} replied, though the connection to the previous point was loose.`;
      quote = trimQuote(seg2.renderedText);
      segmentId = seg2.id;
    }
    rubric.push({ criterion: "listening", label: "Listening & Responding", score: clampScore(score), comment, quote, segmentId, verified: quote ? verifyQuote(quote, seg(ordered, segmentId)) : false });
  }

  // 5. Interruption handling.
  {
    const interruptedCount = metrics.studentWasInterrupted;
    const interruptingCount = metrics.studentInterruptions;
    let score = 4;
    let comment = `${studentName} managed the floor cleanly with no disruptive interruptions.`;
    let quote: string | null = null;
    let segmentId: string | null = null;
    const afterInterruptIdx = ordered.findIndex(
      (u, idx) => idx > 0 && ordered[idx - 1].wasInterrupted && ordered[idx - 1].speakerKind !== "student" && u.speakerKind === "student"
    );
    if (interruptingCount > 2) {
      score = 2;
      comment = `${studentName} interrupted other participants several times — timing entries more carefully will help.`;
    } else if (interruptedCount > 0 && afterInterruptIdx >= 0) {
      score = 3.5;
      comment = `${studentName} was interrupted at least once but continued participating constructively.`;
      quote = trimQuote(ordered[afterInterruptIdx].renderedText);
      segmentId = ordered[afterInterruptIdx].id;
    } else if (interruptingCount > 0) {
      score = 3;
      comment = `${studentName} jumped in on others occasionally — a brief pause before speaking would read as more polished.`;
    }
    rubric.push({ criterion: "interruptionHandling", label: "Interruption Handling", score: clampScore(score), comment, quote, segmentId, verified: quote ? verifyQuote(quote, seg(ordered, segmentId)) : false });
  }

  // 6. Ending strongly — did the student contribute during the closing round?
  {
    let score = 2;
    let comment = `${studentName} did not contribute a closing statement.`;
    let quote: string | null = null;
    let segmentId: string | null = null;
    const closing = studentUtterances.find((u) => u.phase === "CLOSING_ROUND");
    if (closing) {
      score = closing.wordCount >= 10 ? 4.6 : 3.2;
      comment = closing.wordCount >= 10
        ? `${studentName} delivered a clear, concise closing takeaway.`
        : `${studentName} gave a closing remark, though it could have been more substantive.`;
      quote = trimQuote(closing.renderedText);
      segmentId = closing.id;
    }
    rubric.push({ criterion: "endingStrongly", label: "Ending Strongly", score: clampScore(score), comment, quote, segmentId, verified: quote ? verifyQuote(quote, seg(ordered, segmentId)) : false });
  }

  return rubric;
}

function seg(ordered: UtteranceLike[], id: string | null): UtteranceLike | undefined {
  if (!id) return undefined;
  return ordered.find((u) => u.id === id);
}

const SUGGESTION_TEMPLATES: Record<string, (topic: string, studentName: string) => string> = {
  starting: (topic) =>
    `Try opening within the first minute with a clear stance, e.g. "I think ${topic.replace(/[?.]+$/g, "")} matters because..." — speaking early sets the agenda instead of reacting to it.`,
  ideaQuality: (topic) =>
    `Strengthen your point with a concrete example or data point, e.g. "One reason this matters is [specific example] — which shows ${topic.replace(/[?.]+$/g, "")} isn't just theoretical."`,
  buildingOnOthers: () =>
    `Explicitly reference a teammate before adding your view, e.g. "Building on what [name] said, I'd add that..." — this signals active collaboration to evaluators.`,
  listening: () =>
    `Mirror a key phrase from the previous speaker before countering or agreeing, e.g. "You mentioned [X] — I'd actually extend that by..."`,
  interruptionHandling: () =>
    `Wait for a natural pause (a breath or falling intonation) before jumping in, or use a quick verbal flag like "Can I add to that?" before speaking.`,
  endingStrongly: (topic) =>
    `Prepare a one-line takeaway in advance, e.g. "If I had to leave you with one thing about ${topic.replace(/[?.]+$/g, "")}, it's..." so your closing doesn't get rushed.`,
};

export function buildSuggestions(rubric: RubricItem[], topic: string, studentName: string): Suggestion[] {
  const weakest = [...rubric].sort((a, b) => a.score - b.score).slice(0, 2);
  return weakest.map((item) => ({
    criterion: item.criterion,
    label: item.label,
    suggestion: SUGGESTION_TEMPLATES[item.criterion]?.(topic, studentName) ?? "Keep practicing — consistency will sharpen this skill.",
  }));
}

export function overallScoreFromRubric(rubric: RubricItem[]): number {
  if (rubric.length === 0) return 0;
  const avg = rubric.reduce((acc, r) => acc + r.score, 0) / rubric.length;
  return Math.round(avg * 20); // scale 1-5 -> 20-100
}

export { computeMetrics };
export type { TranscriptMetrics, UtteranceLike };

/** The brief requires every feedback point to link to a quoted moment. The
 * heuristic rubric leaves quote=null when it finds no matching behaviour;
 * this pass always attaches the nearest real transcript moment instead. */
export function ensureEvidence(rubric: RubricItem[], utterances: UtteranceLike[], studentName: string): RubricItem[] {
  const ordered = [...utterances].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const spoken = (u: UtteranceLike) => !u.renderedText.startsWith("(no ");
  const studentTurns = ordered.filter((u) => u.speakerKind === "student" && spoken(u));
  const lastStudent = studentTurns[studentTurns.length - 1];
  const moderatorMoment = ordered.find((u) => u.speakerKind === "moderator");

  return rubric.map((item) => {
    if (item.quote && item.segmentId) return item;
    const ref = lastStudent ?? moderatorMoment ?? ordered[0];
    if (!ref) return item;
    const quote = trimQuote(ref.renderedText);
    const note = lastStudent
      ? " No explicit example of this was found, so the quoted turn is your nearest relevant moment."
      : ` ${studentName} did not speak, so the quoted line is the moment where a contribution was possible.`;
    return { ...item, comment: item.comment + note, quote, segmentId: ref.id, verified: verifyQuote(quote, ref) };
  });
}
