import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { feedbackReports } from "@/db/schema";
import { getRoom, getUtterances, getParticipants, getReport } from "@/lib/db-helpers";
import {
  computeMetrics,
  buildRubric,
  buildSuggestions,
  ensureEvidence,
  overallScoreFromRubric,
  RubricItem,
  Suggestion,
  UtteranceLike,
} from "@/lib/report";
import { buildReportLLM } from "@/lib/reportLlm";
import { isLlmEnabled } from "@/lib/llm";
import { buildComparison } from "@/lib/compare";
import { buildNotesHeuristic } from "@/lib/notes";
import { buildNotesLLM } from "@/lib/notesLlm";

async function loadTranscript(roomId: string): Promise<UtteranceLike[]> {
  const rows = await getUtterances(roomId);
  return rows.map((r) => ({
    id: r.id,
    speakerName: r.speakerName,
    speakerKind: r.speakerKind,
    renderedText: r.renderedText,
    wasInterrupted: r.wasInterrupted,
    addresses: r.addresses,
    startedAtMs: r.startedAtMs,
    endedAtMs: r.endedAtMs,
    wordCount: r.wordCount,
    phase: r.phase,
  }));
}

/** Builds and stores the feedback report once per room (idempotent). Uses the
 * LLM scorer when a key is configured; any failure falls back to heuristics.
 * The comparison and the meeting notes are produced in the same pass. */
export async function generateAndStoreReport(roomId: string): Promise<void> {
  const room = await getRoom(roomId);
  if (!room) return;

  const ordered = await loadTranscript(roomId);
  const roster = await getParticipants(roomId);
  const invited = room.invitedFriends ?? [];

  const metrics = computeMetrics(ordered);
  const heuristic = ensureEvidence(buildRubric(room.topic, room.studentName, ordered, metrics), ordered, room.studentName);
  const comparison = buildComparison({ ordered, roster, studentName: room.studentName });

  let rubric: RubricItem[] = heuristic;
  let suggestions: Suggestion[] = buildSuggestions(heuristic, room.topic, room.studentName).map((s) => ({ ...s, kind: "improve" as const }));
  let summary: string | null = null;
  let source: "llm" | "heuristic" = "heuristic";
  let notes = buildNotesHeuristic({ ordered, invited });

  if (isLlmEnabled()) {
    // The two model calls are independent, so run them side by side to keep the wait short.
    const [llm, llmNotes] = await Promise.all([
      buildReportLLM({ topic: room.topic, studentName: room.studentName, ordered, metrics, fallback: heuristic }).catch(() => null),
      buildNotesLLM({ topic: room.topic, ordered, invited }).catch(() => null),
    ]);
    if (llm) {
      rubric = llm.rubric;
      if (llm.suggestions.length > 0) suggestions = llm.suggestions;
      summary = llm.summary;
      source = "llm";
    }
    if (llmNotes) notes = llmNotes;
  }

  await db
    .insert(feedbackReports)
    .values({
      id: randomUUID(),
      roomId,
      metricsJson: { ...metrics, summary, source },
      rubricJson: rubric,
      suggestionsJson: suggestions,
      overallScore: overallScoreFromRubric(rubric),
      verifiedAllQuotes: rubric.every((r) => !r.quote || r.verified),
      comparisonJson: comparison,
      notesJson: notes,
    })
    .onConflictDoNothing();
}

/** Reports saved before v3 have no comparison or notes. Fill them in (heuristics only, no model call) on first read. */
export async function ensureExtras(roomId: string): Promise<void> {
  const report = await getReport(roomId);
  if (!report || (report.comparisonJson && report.notesJson)) return;
  const room = await getRoom(roomId);
  if (!room) return;

  const ordered = await loadTranscript(roomId);
  const roster = await getParticipants(roomId);
  await db
    .update(feedbackReports)
    .set({
      comparisonJson: report.comparisonJson ?? buildComparison({ ordered, roster, studentName: room.studentName }),
      notesJson: report.notesJson ?? buildNotesHeuristic({ ordered, invited: room.invitedFriends ?? [] }),
    })
    .where(eq(feedbackReports.roomId, roomId));
}
