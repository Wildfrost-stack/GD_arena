export interface UtteranceLike {
  id: string;
  speakerName: string;
  speakerKind: string;
  renderedText: string;
  wasInterrupted: boolean;
  addresses: string | null;
  startedAtMs: number;
  endedAtMs: number;
  wordCount: number;
  phase: string;
}

const FILLER_WORDS = ["um", "uh", "like", "you know", "basically", "actually", "i mean", "sort of", "kind of"];

export function countFillers(text: string): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const filler of FILLER_WORDS) {
    const re = new RegExp(`\\b${filler.replace(/ /g, "\\s+")}\\b`, "g");
    const matches = lower.match(re);
    if (matches) count += matches.length;
  }
  return count;
}

export function wordsIn(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

export interface SpeakerMetric {
  name: string;
  kind: string;
  turns: number;
  words: number;
  speakingMs: number;
  sharePct: number;
  wpm: number;
  fillerCount: number;
  interruptedCount: number; // times this speaker got interrupted
  interruptingCount: number; // times this speaker interrupted someone else
}

export interface TranscriptMetrics {
  totalSpeakingMs: number;
  speakers: SpeakerMetric[];
  totalTurns: number;
  studentTurns: number;
  studentInterruptions: number;
  studentWasInterrupted: number;
}

export function computeMetrics(utterances: UtteranceLike[]): TranscriptMetrics {
  const bySpeaker = new Map<string, SpeakerMetric>();
  let totalSpeakingMs = 0;

  const ordered = [...utterances].sort((a, b) => a.startedAtMs - b.startedAtMs);

  ordered.forEach((u, idx) => {
    const durationMs = Math.max(0, u.endedAtMs - u.startedAtMs);
    totalSpeakingMs += durationMs;
    const key = u.speakerName;
    const existing = bySpeaker.get(key) ?? {
      name: u.speakerName,
      kind: u.speakerKind,
      turns: 0,
      words: 0,
      speakingMs: 0,
      sharePct: 0,
      wpm: 0,
      fillerCount: 0,
      interruptedCount: 0,
      interruptingCount: 0,
    };
    existing.turns += 1;
    existing.words += u.wordCount;
    existing.speakingMs += durationMs;
    existing.fillerCount += countFillers(u.renderedText);
    if (u.wasInterrupted) existing.interruptedCount += 1;
    bySpeaker.set(key, existing);

    // The previous utterance was cut short by this speaker starting early —
    // approximate "interrupting" as: this utterance is from the student and
    // the previous AI utterance was interrupted, or vice versa.
    const prev = ordered[idx - 1];
    if (prev && prev.wasInterrupted && prev.speakerName !== u.speakerName) {
      const interruptor = bySpeaker.get(u.speakerName);
      if (interruptor) interruptor.interruptingCount += 1;
    }
  });

  const speakers = Array.from(bySpeaker.values()).map((s) => ({
    ...s,
    sharePct: totalSpeakingMs > 0 ? Math.round((s.speakingMs / totalSpeakingMs) * 1000) / 10 : 0,
    wpm: s.speakingMs > 0 ? Math.round((s.words / (s.speakingMs / 60000)) * 10) / 10 : 0,
  }));

  const studentEntries = speakers.filter((s) => s.kind === "student");
  const studentTurns = studentEntries.reduce((acc, s) => acc + s.turns, 0);
  const studentInterruptions = studentEntries.reduce((acc, s) => acc + s.interruptingCount, 0);
  const studentWasInterrupted = studentEntries.reduce((acc, s) => acc + s.interruptedCount, 0);

  return {
    totalSpeakingMs,
    speakers,
    totalTurns: ordered.length,
    studentTurns,
    studentInterruptions,
    studentWasInterrupted,
  };
}
