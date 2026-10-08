"use client";

import type { ParticipantRow } from "@/lib/clientTypes";

export function SeatCard({
  participant,
  isSpeaking,
  isNextAddressed,
  compact,
}: {
  participant: ParticipantRow;
  isSpeaking: boolean;
  isNextAddressed?: boolean;
  compact?: boolean;
}) {
  const disclosure = participant.kind === "moderator" ? "AI Moderator" : participant.kind === "ai" ? "AI Participant" : "You (Human)";

  return (
    <div
      className={`relative rounded-2xl border p-4 transition-all duration-200 ${
        isSpeaking ? "scale-[1.03] border-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]" : "border-slate-200"
      } ${participant.kind === "student" ? "bg-sky-50" : "bg-white"}`}
    >
      {isSpeaking && (
        <span className="absolute -top-2 -right-2 flex h-5 w-5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex h-5 w-5 rounded-full bg-emerald-500"></span>
        </span>
      )}
      {isNextAddressed && !isSpeaking && (
        <span className="absolute -top-2 -right-2 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-white">@</span>
      )}
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
          style={{ backgroundColor: `${participant.colorHex}22`, border: `2px solid ${participant.colorHex}` }}
        >
          {participant.avatarEmoji}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{participant.name}</p>
          {!compact && <p className="truncate text-xs text-slate-500">{participant.role}</p>}
        </div>
      </div>
      <span
        className={`mt-3 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          participant.kind === "student" ? "bg-sky-200 text-sky-800" : "bg-slate-900 text-white"
        }`}
      >
        {disclosure}
      </span>
    </div>
  );
}
