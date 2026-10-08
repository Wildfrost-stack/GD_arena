import { getRoom, getReport, getUtterances, getParticipants } from "@/lib/db-helpers";
import ReportClient from "@/components/ReportClient";
import type { MetricsDTO, RubricItemDTO, SuggestionDTO } from "@/lib/clientTypes";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await getRoom(id);
  if (!room) {
    return (
      <main className="grid min-h-screen place-items-center">
        <p className="text-slate-600">Room not found.</p>
      </main>
    );
  }

  const [report, utterances, participants] = await Promise.all([getReport(id), getUtterances(id), getParticipants(id)]);

  if (!report) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <p className="text-lg font-semibold text-slate-800">Your report is still being generated…</p>
          <p className="mt-2 text-slate-500">This usually only takes a moment after the closing round ends. Refresh to check again.</p>
          <a href={`/room/${id}`} className="mt-4 inline-block text-indigo-600 underline">
            Back to room
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <ReportClient
        topic={room.topic}
        studentName={room.studentName}
        overallScore={report.overallScore}
        verifiedAllQuotes={report.verifiedAllQuotes}
        metrics={report.metricsJson as MetricsDTO}
        rubric={report.rubricJson as RubricItemDTO[]}
        suggestions={report.suggestionsJson as SuggestionDTO[]}
        utterances={utterances}
        participants={participants}
        roomId={id}
      />
    </main>
  );
}
