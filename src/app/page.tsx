import Link from "next/link";
import { db } from "@/db";
import { rooms } from "@/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rooms);

  return (
    <main className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-white">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">GD Arena</p>
        <h1 className="mt-4 text-[clamp(2.2rem,5vw,3.5rem)] font-extrabold leading-[1.05] text-slate-950">
          Practice group discussions with AI voices that talk back — and interrupt-proof your confidence.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-600">
          Join a simulated discussion with 3–5 distinct AI participants and an AI moderator. Speak naturally, get interrupted
          realistically, and receive an evidence-grounded feedback report where every claim links to a verbatim transcript quote.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/setup" className="rounded-full bg-indigo-600 px-7 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700">
            Start a Mock GD →
          </Link>
          <p className="text-sm text-slate-500">{count} session{count === 1 ? "" : "s"} run so far</p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <FeatureCard
            emoji="🎙️"
            title="AI Transparency"
            body='Every AI seat is clearly labelled "AI Participant" or "AI Moderator" — before and during the session.'
          />
          <FeatureCard
            emoji="⚡"
            title="Real Barge-In"
            body="Continuous voice-activity detection stops AI playback instantly the moment you start speaking."
          />
          <FeatureCard
            emoji="📊"
            title="Evidence-Grounded Report"
            body="Rubric scores are backed by verbatim quotes, server-verified against your actual transcript."
          />
        </div>

        <div className="mt-14 rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
          <h2 className="text-lg font-bold text-slate-900">How a session flows</h2>
          <ol className="mt-4 grid grid-cols-1 gap-4 text-sm text-slate-600 sm:grid-cols-4">
            <li><span className="font-semibold text-indigo-600">1. Setup —</span> pick a topic, 3–5 AI participants + a moderator.</li>
            <li><span className="font-semibold text-indigo-600">2. Opening —</span> the AI moderator frames the discussion.</li>
            <li><span className="font-semibold text-indigo-600">3. Free discussion —</span> speak, interrupt, and build on others in real time.</li>
            <li><span className="font-semibold text-indigo-600">4. Closing + report —</span> everyone closes out, then you get your feedback.</li>
          </ol>
        </div>
      </div>
    </main>
  );
}

function FeatureCard({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow ring-1 ring-slate-200">
      <div className="text-2xl">{emoji}</div>
      <h3 className="mt-2 font-bold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
    </div>
  );
}
