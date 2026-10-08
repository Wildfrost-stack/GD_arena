"use client";

import { useState } from "react";
import type { MetricsDTO, RubricItemDTO, SuggestionDTO, UtteranceRow, ParticipantRow } from "@/lib/clientTypes";

function scoreColor(score: number): string {
  if (score >= 4) return "text-emerald-600";
  if (score >= 3) return "text-amber-600";
  return "text-rose-600";
}

function barColor(kind: string): string {
  if (kind === "student") return "bg-sky-500";
  if (kind === "moderator") return "bg-slate-500";
  return "bg-indigo-500";
}

export default function ReportClient({
  topic,
  studentName,
  overallScore,
  verifiedAllQuotes,
  metrics,
  rubric,
  suggestions,
  utterances,
  participants,
  roomId,
}: {
  topic: string;
  studentName: string;
  overallScore: number;
  verifiedAllQuotes: boolean;
  metrics: MetricsDTO;
  rubric: RubricItemDTO[];
  suggestions: SuggestionDTO[];
  utterances: UtteranceRow[];
  participants: ParticipantRow[];
  roomId: string;
}) {
  const [highlighted, setHighlighted] = useState<string | null>(null);

  function jumpTo(segmentId: string | null) {
    if (!segmentId) return;
    const el = document.getElementById(`seg-${segmentId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlighted(segmentId);
      setTimeout(() => setHighlighted((cur) => (cur === segmentId ? null : cur)), 2600);
    }
  }

  const participantColor = new Map(participants.map((p) => [p.name, p.colorHex]));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Feedback Report</p>
          <h1 className="text-2xl font-bold text-slate-900">{topic}</h1>
          <p className="text-sm text-slate-500">Participant: {studentName}</p>
          {metrics.summary && <p className="mt-2 max-w-2xl text-sm text-slate-700">{metrics.summary}</p>}
          <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400">
            {metrics.source === "llm" ? "Scored by AI coach · every quote server-verified" : "Scored with rule-based heuristics (no AI key configured)"}
          </p>
        </div>
        <a href="/setup" className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          Practice again
        </a>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-6 text-center shadow ring-1 ring-slate-200">
          <p className="text-xs font-semibold uppercase text-slate-400">Overall Score</p>
          <p className="mt-2 text-4xl font-extrabold text-indigo-600">{overallScore}</p>
          <p className="text-xs text-slate-400">out of 100</p>
        </div>
        <div className="rounded-2xl bg-white p-6 text-center shadow ring-1 ring-slate-200">
          <p className="text-xs font-semibold uppercase text-slate-400">Your Speaking Share</p>
          <p className="mt-2 text-4xl font-extrabold text-sky-600">
            {metrics.speakers.find((s) => s.kind === "student")?.sharePct ?? 0}%
          </p>
          <p className="text-xs text-slate-400">of total floor time</p>
        </div>
        <div className="rounded-2xl bg-white p-6 text-center shadow ring-1 ring-slate-200">
          <p className="text-xs font-semibold uppercase text-slate-400">Evidence Verification</p>
          <p className={`mt-2 text-2xl font-extrabold ${verifiedAllQuotes ? "text-emerald-600" : "text-rose-600"}`}>
            {verifiedAllQuotes ? "✓ All quotes verified" : "⚠ Some quotes unverified"}
          </p>
          <p className="text-xs text-slate-400">server-checked against transcript</p>
        </div>
      </div>

      <section className="mb-8 rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
        <h2 className="mb-4 text-lg font-bold text-slate-900">Speaking Share &amp; Turn Counts</h2>
        <div className="space-y-3">
          {metrics.speakers
            .slice()
            .sort((a, b) => b.speakingMs - a.speakingMs)
            .map((s) => (
              <div key={s.name}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-semibold text-slate-800">
                    {s.name} <span className="text-xs font-normal text-slate-400">({s.turns} turns · {s.wpm} wpm · {s.fillerCount} fillers)</span>
                  </span>
                  <span className="text-slate-500">{s.sharePct}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${barColor(s.kind)}`} style={{ width: `${Math.max(2, s.sharePct)}%` }} />
                </div>
              </div>
            ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-600 sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-3 text-center">
            <p className="text-lg font-bold text-slate-900">{metrics.totalTurns}</p>
            <p className="text-xs text-slate-400">total turns</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-center">
            <p className="text-lg font-bold text-slate-900">{metrics.studentTurns}</p>
            <p className="text-xs text-slate-400">your turns</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-center">
            <p className="text-lg font-bold text-slate-900">{metrics.studentInterruptions}</p>
            <p className="text-xs text-slate-400">times you interrupted</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-center">
            <p className="text-lg font-bold text-slate-900">{metrics.studentWasInterrupted}</p>
            <p className="text-xs text-slate-400">times you were interrupted</p>
          </div>
        </div>
      </section>

      <section className="mb-8 rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
        <h2 className="mb-4 text-lg font-bold text-slate-900">Qualitative Evaluation</h2>
        <div className="space-y-4">
          {rubric.map((item) => (
            <div key={item.criterion} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">{item.label}</p>
                <p className={`text-lg font-extrabold ${scoreColor(item.score)}`}>{item.score.toFixed(1)}/5</p>
              </div>
              <p className="mt-1 text-sm text-slate-600">{item.comment}</p>
              {item.quote ? (
                <button
                  onClick={() => jumpTo(item.segmentId)}
                  className="mt-3 w-full rounded-lg bg-slate-50 p-3 text-left text-sm italic text-slate-700 ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:ring-indigo-300"
                >
                  “{item.quote}” {item.verified && <span className="ml-1 not-italic text-emerald-600">✓ verified</span>}
                  <span className="mt-1 block text-[10px] not-italic uppercase tracking-wide text-indigo-500">Click to view in transcript →</span>
                </button>
              ) : (
                <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-400 ring-1 ring-slate-200">No direct evidence found in transcript.</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {suggestions.length > 0 && (
        <section className="mb-8 rounded-2xl bg-indigo-50 p-6 shadow ring-1 ring-indigo-100">
          <h2 className="mb-4 text-lg font-bold text-indigo-900">💡 What You Could Have Said</h2>
          <div className="space-y-3">
            {suggestions.map((s, i) => (
              <div key={`${s.criterion}-${i}`} className="rounded-xl bg-white p-4 shadow-sm">
                <p className="text-sm font-semibold text-indigo-700">
                  {s.kind === "missed" ? "Missed opening" : s.label}
                </p>
                {s.momentQuote && s.momentSegmentId && (
                  <button
                    onClick={() => jumpTo(s.momentSegmentId ?? null)}
                    className="mt-2 w-full rounded-lg bg-slate-50 p-2 text-left text-xs italic text-slate-600 ring-1 ring-slate-200 hover:bg-indigo-50"
                  >
                    At this moment: “{s.momentQuote}” <span className="not-italic text-indigo-500">→ view in transcript</span>
                  </button>
                )}
                <p className="mt-2 text-sm text-slate-700">
                  {s.kind === "missed" ? <span className="font-semibold text-slate-900">You could have said: </span> : null}
                  {s.suggestion}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
        <h2 className="mb-4 text-lg font-bold text-slate-900">Full Transcript</h2>
        <div className="space-y-3">
          {utterances.map((u) => (
            <div
              id={`seg-${u.id}`}
              key={u.id}
              className={`rounded-lg p-3 transition-colors ${highlighted === u.id ? "bg-amber-100 ring-2 ring-amber-400" : "bg-slate-50"}`}
            >
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="rounded-full px-2 py-0.5 font-bold text-white"
                  style={{ backgroundColor: participantColor.get(u.speakerName) ?? "#64748b" }}
                >
                  {u.speakerName}
                </span>
                <span className="uppercase text-slate-400">{u.phase.replace("_", " ")}</span>
                {u.wasInterrupted && <span className="rounded bg-rose-100 px-1.5 py-0.5 font-bold text-rose-600">interrupted</span>}
              </div>
              <p className="mt-1 text-sm text-slate-700">{u.renderedText}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-6 text-center text-xs text-slate-400">Room ID: {roomId}</p>
    </div>
  );
}
