"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TOPIC_CATEGORIES } from "@/lib/topics";

const DURATIONS = [
  { label: "3 min", seconds: 180 },
  { label: "5 min", seconds: 300 },
  { label: "8 min", seconds: 480 },
];

export default function SetupPage() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState(TOPIC_CATEGORIES[0].category);
  const [topic, setTopic] = useState(TOPIC_CATEGORIES[0].topics[0]);
  const [customTopic, setCustomTopic] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [participantCount, setParticipantCount] = useState(4);
  const [discussionSeconds, setDiscussionSeconds] = useState(300);
  const [studentName, setStudentName] = useState("You");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const finalTopic = useCustom ? customTopic.trim() : topic;
    if (!finalTopic || finalTopic.length < 4) {
      setError("Please choose or write a topic with at least 4 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: finalTopic,
          topicCategory: useCustom ? "custom" : "predefined",
          participantCount,
          discussionSeconds,
          closingSeconds: 90,
          studentName: studentName.trim() || "You",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create room");
      router.push(`/room/${data.roomId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Room Setup</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Configure your mock group discussion</h1>

        <section className="mt-8">
          <h2 className="font-semibold text-slate-800">1. Choose a topic</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => setUseCustom(false)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${!useCustom ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Predefined
            </button>
            <button
              onClick={() => setUseCustom(true)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${useCustom ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Custom topic
            </button>
          </div>

          {!useCustom ? (
            <div className="mt-4">
              <div className="flex flex-wrap gap-2">
                {TOPIC_CATEGORIES.map((c) => (
                  <button
                    key={c.category}
                    onClick={() => {
                      setActiveCategory(c.category);
                      setTopic(c.topics[0]);
                    }}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      activeCategory === c.category ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {c.category}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {TOPIC_CATEGORIES.find((c) => c.category === activeCategory)?.topics.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTopic(t)}
                    className={`rounded-xl border p-3 text-left text-sm ${
                      topic === t ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-200 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <textarea
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder='e.g. "Should college attendance be optional?"'
              className="mt-4 h-20 w-full resize-none rounded-xl border border-slate-300 p-3 text-sm focus:border-indigo-500 focus:outline-none"
            />
          )}
        </section>

        <section className="mt-8">
          <h2 className="font-semibold text-slate-800">2. AI participants</h2>
          <div className="mt-3 flex gap-2">
            {[3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setParticipantCount(n)}
                className={`flex-1 rounded-xl border py-3 text-center font-semibold ${
                  participantCount === n ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-200 text-slate-600"
                }`}
              >
                {n} AI participants
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">Plus 1 AI Moderator and you — up to 6 distinct voices in the room.</p>
        </section>

        <section className="mt-8">
          <h2 className="font-semibold text-slate-800">3. Discussion length</h2>
          <div className="mt-3 flex gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d.seconds}
                onClick={() => setDiscussionSeconds(d.seconds)}
                className={`flex-1 rounded-xl border py-3 text-center font-semibold ${
                  discussionSeconds === d.seconds ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-200 text-slate-600"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="font-semibold text-slate-800">4. Your display name</h2>
          <input
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            maxLength={40}
            className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </section>

        {error && <p className="mt-6 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="mt-8 w-full rounded-full bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-60"
        >
          {submitting ? "Creating room…" : "Review Room & Continue →"}
        </button>
      </div>
    </main>
  );
}
