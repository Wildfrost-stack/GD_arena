import type { rooms, participants, utterances, feedbackReports } from "@/db/schema";

export type RoomRow = typeof rooms.$inferSelect;
export type ParticipantRow = typeof participants.$inferSelect;
export type UtteranceRow = typeof utterances.$inferSelect;
export type FeedbackReportRow = typeof feedbackReports.$inferSelect;

export interface RoomStateResponse extends RoomRow {
  serverNowMs: number;
  discussionRemainingMs: number | null;
  closingRemainingMs: number | null;
}

export interface NextTurnResponse {
  speaker: { id: string; name: string; role?: string; kind?: string };
  text: string;
  addresses: string | null;
  isInvite: boolean;
  action: "speak" | "awaitStudent" | "wrap";
  error?: string;
}

export interface RubricItemDTO {
  criterion: string;
  label: string;
  score: number;
  comment: string;
  quote: string | null;
  segmentId: string | null;
  verified: boolean;
}

export interface SuggestionDTO {
  criterion: string;
  label: string;
  suggestion: string;
  kind?: "improve" | "missed";
  momentQuote?: string | null;
  momentSegmentId?: string | null;
}

export interface SpeakerMetricDTO {
  name: string;
  kind: string;
  turns: number;
  words: number;
  speakingMs: number;
  sharePct: number;
  wpm: number;
  fillerCount: number;
  interruptedCount: number;
  interruptingCount: number;
}

export interface MetricsDTO {
  totalSpeakingMs: number;
  speakers: SpeakerMetricDTO[];
  totalTurns: number;
  studentTurns: number;
  studentInterruptions: number;
  studentWasInterrupted: number;
  summary?: string | null;
  source?: "llm" | "heuristic";
}

export type { NotesDTO, NoteItem } from "./notes";
export type { ComparisonDTO } from "./compare";

export interface SessionUserDTO {
  id: string;
  name: string;
  email: string;
}

export interface FriendDTO {
  id: string;
  label: string;
  email: string | null;
  hasAccount: boolean;
}
