"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { SeatCard } from "./SeatCard";
import { MicVad, getSpeechRecognitionCtor, pickVoiceForProfile, primeVoices, estimateSpeechMs } from "@/lib/voice";
import type { ParticipantRow, RoomStateResponse, UtteranceRow } from "@/lib/clientTypes";

interface SpeakerLike {
  id: string | null;
  name: string;
  kind?: string;
  voiceRate?: number;
  voicePitch?: number;
  voiceGenderHint?: string;
  seatIndex?: number;
}

interface SpeakResult {
  renderedText: string;
  wasInterrupted: boolean;
  startedAtMs: number;
  endedAtMs: number;
}

function fmtClock(ms: number | null): string {
  if (ms === null) return "--:--";
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const PATIENCE_FACTOR: Record<string, number> = { quick: 0.6, normal: 1, patient: 1.8 };

// "AI patience": scales how long the room waits before an AI speaks, and how
// long a pause is tolerated before the student's turn is considered over.
function getPatienceFactor(): number {
  try {
    return PATIENCE_FACTOR[window.localStorage.getItem("gd-patience") ?? "normal"] ?? 1;
  } catch {
    return 1;
  }
}

const PHASE_LABEL: Record<string, string> = {
  SETUP: "Setting up",
  MODERATOR_OPENING: "Moderator opening",
  GAP: "Open floor",
  STUDENT_SPEAKING: "You have the floor",
  AI_SPEAKING: "AI speaking",
  CLOSING_ROUND: "Closing round",
  ENDED: "Session ended",
};

export default function RoomClient({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [room, setRoom] = useState<RoomStateResponse | null>(null);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [transcript, setTranscript] = useState<UtteranceRow[]>([]);
  const [stage, setStage] = useState<"preroom" | "resume" | "live">("preroom");
  const [entering, setEntering] = useState(false);
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [sttSupported, setSttSupported] = useState(true);
  const [textMode, setTextMode] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [caption, setCaption] = useState<{ name: string; text: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [typedValue, setTypedValue] = useState("");
  const [discussionRemainingMs, setDiscussionRemainingMs] = useState<number | null>(null);
  const [closingRemainingMs, setClosingRemainingMs] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);
  const [patience, setPatience] = useState("normal");

  const phaseRef = useRef<string>("SETUP");
  const roomRef = useRef<RoomStateResponse | null>(null);
  const participantsRef = useRef<ParticipantRow[]>([]);
  const sessionStartEpochRef = useRef<number | null>(null);
  const discussionStartEpochRef = useRef<number | null>(null);
  const closingStartEpochRef = useRef<number | null>(null);
  const discussionSecondsRef = useRef<number>(300);
  const closingSecondsRef = useRef<number>(90);
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bargeInResolverRef = useRef<((interrupted: boolean) => void) | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const vadRef = useRef<MicVad | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const listeningRef = useRef(false);
  const studentBufferRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardListenCapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFinalizeRef = useRef<{ turnPhase: string; startedAtMs: number } | null>(null);
  const mountedRef = useRef(true);
  const lastStudentSpokeRef = useRef<number>(0);

  const relMs = useCallback(() => {
    if (sessionStartEpochRef.current === null) return 0;
    return Date.now() - sessionStartEpochRef.current;
  }, []);

  // Indirection avoids TypeScript narrowing phaseRef.current to a literal
  // across `await` boundaries, where the value can legitimately change
  // concurrently (e.g. a barge-in flips the phase mid-request).
  function getPhase(): string {
    return phaseRef.current;
  }

  // ---------- Networking helpers ----------
  const logUtterance = useCallback(
    async (payload: {
      participantId: string | null;
      speakerKind: string;
      fullText: string;
      renderedText: string;
      wasInterrupted: boolean;
      addresses: string | null;
      startedAtMs: number;
      endedAtMs: number;
      turnPhase: string;
      isInvite?: boolean;
      isWrap?: boolean;
    }) => {
      const res = await fetch(`/api/rooms/${roomId}/utterances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.room) {
        setRoom(data.room);
        roomRef.current = data.room;
        phaseRef.current = data.room.phase;
      }
      setTranscript((prev) => [
        ...prev,
        {
          id: data.utteranceId,
          roomId,
          participantId: payload.participantId,
          speakerName: payload.participantId
            ? participantsRef.current.find((p) => p.id === payload.participantId)?.name ?? "Unknown"
            : roomRef.current?.studentName ?? "You",
          speakerKind: payload.speakerKind,
          turnIndex: 0,
          phase: payload.turnPhase,
          fullText: payload.fullText,
          renderedText: payload.renderedText,
          wasInterrupted: payload.wasInterrupted,
          addresses: payload.addresses,
          startedAtMs: payload.startedAtMs,
          endedAtMs: payload.endedAtMs,
          wordCount: payload.renderedText.trim().split(/\s+/).filter(Boolean).length,
          createdAt: new Date(),
        } as UtteranceRow,
      ]);
      return data;
    },
    [roomId]
  );

  // ---------- TTS ----------
  const speak = useCallback((speaker: SpeakerLike, text: string): Promise<SpeakResult> => {
    return new Promise((resolve) => {
      const startedAtMs = relMs();
      let renderedSoFar = "";
      let settled = false;
      setSpeakingId(speaker.id);
      vadRef.current?.setAiSpeaking(true);
      setCaption({ name: speaker.name, text: "" });

      const finish = (interrupted: boolean) => {
        if (settled) return;
        settled = true;
        bargeInResolverRef.current = null;
        if (hardCapTimer) clearTimeout(hardCapTimer);
        try {
          window.speechSynthesis?.cancel();
        } catch {
          /* ignore */
        }
        setSpeakingId(null);
        vadRef.current?.setAiSpeaking(false);
        const endedAtMs = relMs();
        resolve({
          renderedText: (interrupted ? renderedSoFar : text).trim(),
          wasInterrupted: interrupted,
          startedAtMs,
          endedAtMs,
        });
      };

      bargeInResolverRef.current = (interrupted: boolean) => finish(interrupted);

      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      let hardCapTimer: ReturnType<typeof setTimeout> | null = null;

      if (!synth || typeof window.SpeechSynthesisUtterance === "undefined") {
        // TTS unsupported/unavailable fallback: show full caption, hold the
        // floor for an estimated duration, then continue the room flow.
        setCaption({ name: speaker.name, text });
        hardCapTimer = setTimeout(() => finish(false), estimateSpeechMs(text, speaker.voiceRate ?? 1));
        return;
      }

      try {
        const utter = new SpeechSynthesisUtterance(text);
        const voice = pickVoiceForProfile(
          {
            rate: speaker.voiceRate ?? 1,
            pitch: speaker.voicePitch ?? 1,
            genderHint: (speaker.voiceGenderHint as "male" | "female" | "neutral") ?? "neutral",
          },
          speaker.seatIndex ?? 0
        );
        if (voice) utter.voice = voice;
        utter.rate = speaker.voiceRate ?? 1;
        utter.pitch = speaker.voicePitch ?? 1;
        utter.onboundary = (e) => {
          const charIndex = (e as unknown as { charIndex?: number }).charIndex ?? 0;
          renderedSoFar = text.slice(0, charIndex);
          setCaption({ name: speaker.name, text: text.slice(0, Math.max(charIndex, renderedSoFar.length)) });
        };
        utter.onend = () => finish(false);
        utter.onerror = () => finish(false);
        synth.speak(utter);
        hardCapTimer = setTimeout(() => finish(false), 27000);
      } catch {
        setCaption({ name: speaker.name, text });
        hardCapTimer = setTimeout(() => finish(false), estimateSpeechMs(text, 1));
      }
    });
  }, [relMs]);

  // ---------- Floor continuation ----------
  const continueAfter = useCallback(
    (freshRoom: RoomStateResponse) => {
      if (!mountedRef.current) return;
      setRoom(freshRoom);
      roomRef.current = freshRoom;
      phaseRef.current = freshRoom.phase;
      if (freshRoom.discussionStartedAt && !discussionStartEpochRef.current) {
        discussionStartEpochRef.current = new Date(freshRoom.discussionStartedAt).getTime();
      }
      if (freshRoom.closingStartedAt) {
        closingStartEpochRef.current = new Date(freshRoom.closingStartedAt).getTime();
      }
      if (freshRoom.phase === "ENDED") {
        router.push(`/room/${roomId}/report`);
        return;
      }
      if (freshRoom.phase === "GAP") scheduleGapThenNextTurn();
      else if (freshRoom.phase === "CLOSING_ROUND") scheduleClosingThenNextTurn();
      else if (freshRoom.phase === "STUDENT_SPEAKING") startListening();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [roomId, router]
  );

  const playTurn = useCallback(
    async (
      speaker: SpeakerLike,
      text: string,
      opts: { turnPhase: string; addresses: string | null; isInvite?: boolean; isWrap?: boolean }
    ) => {
      const result = await speak(speaker, text);
      const data = await logUtterance({
        participantId: speaker.id,
        speakerKind: speaker.kind ?? "ai",
        fullText: text,
        renderedText: result.renderedText,
        wasInterrupted: result.wasInterrupted,
        addresses: opts.addresses,
        startedAtMs: result.startedAtMs,
        endedAtMs: result.endedAtMs,
        turnPhase: opts.turnPhase,
        isInvite: opts.isInvite,
        isWrap: opts.isWrap,
      });
      if (data.room) continueAfter(data.room);
    },
    [speak, logUtterance, continueAfter]
  );

  const clearGapTimer = () => {
    if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
    gapTimerRef.current = null;
  };
  const clearClosingTimer = () => {
    if (closingTimerRef.current) clearTimeout(closingTimerRef.current);
    closingTimerRef.current = null;
  };

  function scheduleGapThenNextTurn() {
    clearGapTimer();
    const delay = (900 + Math.random() * 1600) * getPatienceFactor();
    gapTimerRef.current = setTimeout(async () => {
      if (getPhase() !== "GAP") return;
      try {
        const res = await fetch(`/api/rooms/${roomId}/next-turn`, { method: "POST" });
        if (res.status === 409) return; // floor not open on the server
        if (!res.ok) throw new Error("next-turn failed");
        const data = await res.json();
        // The student may have claimed the floor while the turn was generated.
        if (getPhase() !== "GAP") return;
        phaseRef.current = "AI_SPEAKING";
        setRoom((r) => (r ? { ...r, phase: "AI_SPEAKING" } : r));
        if (data.action === "speak") {
          await playTurn(data.speaker, data.text, { turnPhase: "AI_SPEAKING", addresses: data.addresses, isInvite: data.isInvite });
        }
      } catch {
        setBanner("Network hiccup — retrying shortly.");
        setTimeout(() => getPhase() === "GAP" && scheduleGapThenNextTurn(), 2000);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, delay);
  }

  function scheduleClosingThenNextTurn() {
    clearClosingTimer();
    const delay = 700 + Math.random() * 900;
    closingTimerRef.current = setTimeout(async () => {
      if (getPhase() !== "CLOSING_ROUND") return;
      try {
        const res = await fetch(`/api/rooms/${roomId}/next-turn`, { method: "POST" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.action === "awaitStudent") {
          await speak(data.speaker, data.text); // ephemeral prompt, not logged
          if (mountedRef.current) startListening();
        } else if (data.action === "wrap") {
          await playTurn(data.speaker, data.text, { turnPhase: "CLOSING_ROUND", addresses: null, isWrap: true });
        } else {
          await playTurn(data.speaker, data.text, { turnPhase: "CLOSING_ROUND", addresses: data.addresses, isInvite: data.isInvite });
        }
      } catch {
        setBanner("Network hiccup — retrying shortly.");
        setTimeout(() => getPhase() === "CLOSING_ROUND" && scheduleClosingThenNextTurn(), 2000);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, delay);
  }

  // ---------- Barge-in (interruption) ----------
  const triggerBargeIn = useCallback(() => {
    if (getPhase() !== "AI_SPEAKING" && getPhase() !== "MODERATOR_OPENING") return;
    if (!bargeInResolverRef.current) return;
    phaseRef.current = "STUDENT_SPEAKING";
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    const resolver = bargeInResolverRef.current;
    bargeInResolverRef.current = null;
    resolver(true);
    fetch(`/api/rooms/${roomId}/barge-in`, { method: "POST" }).catch(() => {});
  }, [roomId]);

  const claimFloorFromGap = useCallback(async () => {
    if (getPhase() !== "GAP") return;
    clearGapTimer();
    phaseRef.current = "STUDENT_SPEAKING";
    setRoom((r) => (r ? { ...r, phase: "STUDENT_SPEAKING" } : r));
    try {
      await fetch(`/api/rooms/${roomId}/barge-in`, { method: "POST" });
    } catch {
      /* best effort */
    }
    startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const jumpIn = useCallback(() => {
    if (getPhase() === "AI_SPEAKING" || getPhase() === "MODERATOR_OPENING") triggerBargeIn();
    else if (getPhase() === "GAP") claimFloorFromGap();
  }, [triggerBargeIn, claimFloorFromGap]);

  // ---------- STT / student turn ----------
  function detectAddress(text: string): string | null {
    const names = participantsRef.current.filter((p) => p.kind !== "student").map((p) => p.name);
    for (const n of names) {
      if (text.toLowerCase().includes(n.toLowerCase())) return n;
    }
    return null;
  }

  const finalizeStudentTurn = useCallback(
    async (explicitText?: string) => {
      if (!listeningRef.current) return;
      listeningRef.current = false;
      setListening(false);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (hardListenCapRef.current) clearTimeout(hardListenCapRef.current);
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
      const pending = pendingFinalizeRef.current;
      pendingFinalizeRef.current = null;
      const text = (explicitText ?? studentBufferRef.current ?? "").trim();
      if (text) {
        lastStudentSpokeRef.current = Date.now();
        setNudge(null);
      }
      setInterim("");
      setTypedValue("");
      const startedAtMs = pending?.startedAtMs ?? relMs();
      const endedAtMs = relMs();
      const student = participantsRef.current.find((p) => p.kind === "student");
      const turnPhase = pending?.turnPhase === "CLOSING_ROUND" ? "CLOSING_ROUND" : "GAP";
      const data = await logUtterance({
        participantId: student?.id ?? null,
        speakerKind: "student",
        fullText: text || "(no speech captured)",
        renderedText: text || "(no speech captured)",
        wasInterrupted: false,
        addresses: text ? detectAddress(text) : null,
        startedAtMs,
        endedAtMs,
        turnPhase,
      });
      if (data.room) continueAfter(data.room);
    },
    [logUtterance, continueAfter, relMs]
  );

  function resetSilenceTimer() {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => finalizeStudentTurn(), Math.max(2000, 2800 * getPatienceFactor()));
  }

  function startListening() {
    if (listeningRef.current) return;
    listeningRef.current = true;
    setListening(true);
    studentBufferRef.current = "";
    setInterim("");
    const startedAtMs = relMs();
    pendingFinalizeRef.current = { turnPhase: phaseRef.current, startedAtMs };

    hardListenCapRef.current = setTimeout(() => finalizeStudentTurn(), 45000);

    if (textMode || !sttSupported) return; // waits for manual submit via textarea

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setSttSupported(false);
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = "en-IN";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        resetSilenceTimer();
        let finalChunk = "";
        let interimChunk = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          if (result.isFinal) finalChunk += result[0].transcript;
          else interimChunk += result[0].transcript;
        }
        if (finalChunk.trim()) {
          studentBufferRef.current = `${studentBufferRef.current} ${finalChunk.trim()}`.trim();
        }
        setInterim(interimChunk);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setMicPermission("denied");
          setSttSupported(false);
        }
      };
      rec.onend = () => {
        if (listeningRef.current) finalizeStudentTurn();
      };
      recognitionRef.current = rec;
      resetSilenceTimer();
      rec.start();
    } catch {
      setSttSupported(false);
    }
  }

  // ---------- Setup / resume ----------
  async function enterRoom() {
    setEntering(true);
    setBanner(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = stream;
      setMicPermission("granted");
      const vad = new MicVad(stream, triggerBargeIn);
      vad.start();
      vadRef.current = vad;
    } catch {
      setMicPermission("denied");
      setTextMode(true);
      setBanner("Microphone access was denied — switched to text-input mode so you can still practice.");
    }
    setSttSupported(!!getSpeechRecognitionCtor());
    primeVoices();

    try {
      const res = await fetch(`/api/rooms/${roomId}/start`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start");
      sessionStartEpochRef.current = new Date(data.startedAt).getTime();
      phaseRef.current = "MODERATOR_OPENING";
      lastStudentSpokeRef.current = Date.now();
      setStage("live");
      setRoom((r) => (r ? { ...r, phase: "MODERATOR_OPENING", startedAt: data.startedAt } : r));
      setEntering(false);
      await playTurn(data.speaker, data.text, { turnPhase: "MODERATOR_OPENING", addresses: null });
    } catch {
      setEntering(false);
      setBanner("Couldn't start the session. Please refresh and try again.");
    }
  }

  async function resumeRoom() {
    setEntering(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = stream;
      setMicPermission("granted");
      const vad = new MicVad(stream, triggerBargeIn);
      vad.start();
      vadRef.current = vad;
    } catch {
      setMicPermission("denied");
      setTextMode(true);
    }
    setSttSupported(!!getSpeechRecognitionCtor());
    primeVoices();
    try {
      const res = await fetch(`/api/rooms/${roomId}/resync`, { method: "POST" });
      const data = await res.json();
      const r: RoomStateResponse = data.room;
      lastStudentSpokeRef.current = Date.now();
      if (r.startedAt) sessionStartEpochRef.current = new Date(r.startedAt).getTime();
      setStage("live");
      setEntering(false);
      if (r.phase === "SETUP") {
        setStage("preroom");
      } else {
        continueAfter(r);
      }
    } catch {
      setEntering(false);
      setBanner("Couldn't reconnect. Please refresh.");
    }
  }

  // ---------- End session early ----------
  async function endSession() {
    if (ending) return;
    if (!window.confirm("End the discussion now and generate your report?")) return;
    setEnding(true);
    clearGapTimer();
    clearClosingTimer();
    listeningRef.current = false;
    setListening(false);
    try {
      window.speechSynthesis?.cancel();
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    try {
      const res = await fetch(`/api/rooms/${roomId}/end`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to end session");
      }
      router.push(`/room/${roomId}/report`);
    } catch (e) {
      setEnding(false);
      setBanner(e instanceof Error ? e.message : "Couldn't end the session. Please try again.");
    }
  }

  // ---------- Initial load ----------
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}`);
        if (res.status === 404) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const data = await res.json();
        try {
          setPatience(window.localStorage.getItem("gd-patience") ?? "normal");
        } catch {
          /* ignore */
        }
        setRoom(data.room);
        roomRef.current = data.room;
        setParticipants(data.participants);
        participantsRef.current = data.participants;
        setTranscript(data.utterances);
        phaseRef.current = data.room.phase;
        discussionSecondsRef.current = data.room.discussionSeconds;
        closingSecondsRef.current = data.room.closingSeconds;
        if (data.room.startedAt) sessionStartEpochRef.current = new Date(data.room.startedAt).getTime();
        if (data.room.discussionStartedAt) discussionStartEpochRef.current = new Date(data.room.discussionStartedAt).getTime();
        if (data.room.closingStartedAt) closingStartEpochRef.current = new Date(data.room.closingStartedAt).getTime();

        if (data.room.phase === "ENDED") {
          router.replace(`/room/${roomId}/report`);
          return;
        }
        setStage(data.room.phase === "SETUP" ? "preroom" : "resume");
      } catch {
        setBanner("Couldn't load the room. Check your connection and refresh.");
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      mountedRef.current = false;
      clearGapTimer();
      clearClosingTimer();
      vadRef.current?.stop();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  // ---------- Countdown ticking ----------
  useEffect(() => {
    const id = setInterval(() => {
      if (discussionStartEpochRef.current && getPhase() !== "CLOSING_ROUND" && getPhase() !== "ENDED") {
        const elapsed = Date.now() - discussionStartEpochRef.current;
        setDiscussionRemainingMs(Math.max(0, discussionSecondsRef.current * 1000 - elapsed));
      }
      if (closingStartEpochRef.current) {
        const elapsed = Date.now() - closingStartEpochRef.current;
        setClosingRemainingMs(Math.max(0, closingSecondsRef.current * 1000 - elapsed));
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Silent nudge when the student has been quiet for too long.
  useEffect(() => {
    if (stage !== "live") return;
    const id = setInterval(() => {
      const p = getPhase();
      if (p !== "GAP" && p !== "AI_SPEAKING") {
        setNudge(null);
        return;
      }
      const limit = Math.min(180000, Math.max(45000, discussionSecondsRef.current * 1000 * 0.3));
      if (lastStudentSpokeRef.current === 0) return;
      const idle = Date.now() - lastStudentSpokeRef.current;
      setNudge(idle > limit ? `You haven't spoken for ${fmtClock(idle)} — jump in when there's a pause.` : null);
    }, 4000);
    return () => clearInterval(id);
  }, [stage]);

  useEffect(() => {
    const onOnline = () => setBanner(null);
    const onOffline = () => setBanner("You're offline — the session will resume once your connection returns.");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (loading) {
    return <div className="grid min-h-screen place-items-center text-slate-500">Loading room…</div>;
  }
  if (notFound || !room) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-slate-800">Room not found</p>
          <a href="/setup" className="mt-3 inline-block text-indigo-600 underline">
            Start a new discussion
          </a>
        </div>
      </div>
    );
  }

  const phase = room.phase;
  const studentParticipant = participants.find((p) => p.kind === "student");

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">GD Arena</p>
          <h1 className="text-xl font-bold text-slate-900">{room.topic}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{PHASE_LABEL[phase] ?? phase}</span>
          {phase !== "CLOSING_ROUND" && phase !== "ENDED" && (
            <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">⏱ {fmtClock(discussionRemainingMs)}</span>
          )}
          {phase === "CLOSING_ROUND" && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">⏱ {fmtClock(closingRemainingMs)}</span>
          )}
          {stage === "live" && (
            <>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                AI patience
                <select
                  aria-label="How long AI participants wait before speaking"
                  value={patience}
                  onChange={(e) => {
                    setPatience(e.target.value);
                    try {
                      window.localStorage.setItem("gd-patience", e.target.value);
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700"
                >
                  <option value="quick">Quick</option>
                  <option value="normal">Normal</option>
                  <option value="patient">Patient</option>
                </select>
              </label>
              {phase !== "ENDED" && (
                <button
                  onClick={endSession}
                  disabled={ending}
                  className="rounded-full border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                >
                  {ending ? "Ending…" : "End & get report"}
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {banner && <div className="mb-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800 ring-1 ring-amber-200">{banner}</div>}
      {nudge && stage === "live" && (
        <div role="status" className="mb-4 rounded-lg bg-sky-50 px-4 py-2 text-sm text-sky-800 ring-1 ring-sky-200">
          💬 {nudge}
        </div>
      )}

      {stage === "preroom" && (
        <PreRoomOverlay participants={participants} entering={entering} onEnter={enterRoom} studentName={room.studentName} topic={room.topic} />
      )}

      {stage === "resume" && (
        <div className="mb-6 rounded-2xl bg-white p-6 text-center shadow ring-1 ring-slate-200">
          <p className="text-slate-700">This session is already in progress. Reconnect to resume with your microphone.</p>
          <button
            onClick={resumeRoom}
            disabled={entering}
            className="mt-4 rounded-full bg-indigo-600 px-6 py-2 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {entering ? "Reconnecting…" : "🔄 Resume Discussion"}
          </button>
        </div>
      )}

      {stage === "live" && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {participants.map((p) => (
              <SeatCard
                key={p.id}
                participant={p}
                isSpeaking={speakingId === p.id || (p.kind === "student" && listening)}
                isNextAddressed={room.pendingAddress === p.name}
              />
            ))}
          </div>

          <div className="mb-6 min-h-[110px] rounded-2xl bg-slate-900 p-5 text-white shadow-lg">
            {caption ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-300">{caption.name}</p>
                <p className="mt-1 text-lg leading-snug">{caption.text || "…"}</p>
              </>
            ) : listening ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">{room.studentName} (listening)</p>
                <p className="mt-1 text-lg leading-snug text-slate-200">{interim || "Go ahead, we're listening…"}</p>
              </>
            ) : (
              <p className="text-slate-400">Waiting for the next speaker…</p>
            )}
          </div>

          <StudentControls
            phase={phase}
            listening={listening}
            textMode={textMode}
            sttSupported={sttSupported}
            micPermission={micPermission}
            typedValue={typedValue}
            setTypedValue={setTypedValue}
            onJumpIn={jumpIn}
            onToggleTextMode={() => setTextMode((v) => !v)}
            onSubmitTyped={() => finalizeStudentTurn(typedValue)}
            studentName={studentParticipant?.name ?? room.studentName}
          />

          <TranscriptPanel transcript={transcript} />
        </>
      )}
    </div>
  );
}

function PreRoomOverlay({
  participants,
  entering,
  onEnter,
  studentName,
  topic,
}: {
  participants: ParticipantRow[];
  entering: boolean;
  onEnter: () => void;
  studentName: string;
  topic: string;
}) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-slate-200 sm:p-10">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Pre-room disclosure</p>
      <h2 className="mt-2 text-2xl font-bold text-slate-900">You&apos;re about to join an AI-simulated group discussion</h2>
      <p className="mt-2 max-w-2xl text-slate-600">
        Topic: <span className="font-semibold text-slate-900">{topic}</span>. Every seat below except yours is an AI-generated voice
        persona — clearly labelled. Participants wait for natural pauses and will stop instantly if you start speaking.
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {participants.map((p) => (
          <SeatCard key={p.id} participant={p} isSpeaking={false} compact />
        ))}
      </div>
      <div className="mt-8 flex flex-col items-start gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
        <p>🎙️ We&apos;ll ask for microphone access so you can speak naturally — if you decline, you can still type your turns.</p>
        <p>🎧 Headphones recommended: browser voices can leak into your mic and cause false interruptions.</p>
        <p>🗣️ You are <span className="font-semibold">{studentName}</span> in this room.</p>
      </div>
      <button
        onClick={onEnter}
        disabled={entering}
        className="mt-6 w-full rounded-full bg-indigo-600 px-6 py-3 text-center font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-60 sm:w-auto"
      >
        {entering ? "Joining…" : "Enter Discussion"}
      </button>
    </div>
  );
}

function StudentControls({
  phase,
  listening,
  textMode,
  sttSupported,
  micPermission,
  typedValue,
  setTypedValue,
  onJumpIn,
  onToggleTextMode,
  onSubmitTyped,
  studentName,
}: {
  phase: string;
  listening: boolean;
  textMode: boolean;
  sttSupported: boolean;
  micPermission: string;
  typedValue: string;
  setTypedValue: (v: string) => void;
  onJumpIn: () => void;
  onToggleTextMode: () => void;
  onSubmitTyped: () => void;
  studentName: string;
}) {
  const canJumpIn = phase === "AI_SPEAKING" || phase === "MODERATOR_OPENING" || phase === "GAP";
  const showTextArea = textMode || !sttSupported || micPermission === "denied";

  return (
    <div className="mb-6 rounded-2xl bg-white p-4 shadow ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-600">
          {listening ? (
            <span className="font-semibold text-emerald-600">🟢 {studentName}, you have the floor — speak naturally.</span>
          ) : canJumpIn ? (
            <span>Want to speak? Jump in — AI playback stops instantly.</span>
          ) : (
            <span>Hold tight — closing round in progress.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!listening && canJumpIn && (
            <button onClick={onJumpIn} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              🎤 Jump In
            </button>
          )}
          {sttSupported && micPermission !== "denied" && (
            <button onClick={onToggleTextMode} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
              {textMode ? "🎙️ Use voice" : "⌨️ Type instead"}
            </button>
          )}
        </div>
      </div>
      {listening && showTextArea && (
        <div className="mt-3 flex gap-2">
          <textarea
            value={typedValue}
            onChange={(e) => setTypedValue(e.target.value)}
            placeholder="Type what you'd like to say…"
            className="h-20 flex-1 resize-none rounded-lg border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <button onClick={onSubmitTyped} className="self-end rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            Send
          </button>
        </div>
      )}
      {!sttSupported && <p className="mt-2 text-xs text-amber-700">Speech recognition isn&apos;t supported in this browser — using text input.</p>}
    </div>
  );
}

function TranscriptPanel({ transcript }: { transcript: UtteranceRow[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript.length]);

  return (
    <div className="rounded-2xl bg-white p-4 shadow ring-1 ring-slate-200">
      <p className="mb-3 text-sm font-semibold text-slate-700">Live Transcript</p>
      <div className="max-h-72 space-y-3 overflow-y-auto pr-2">
        {transcript.length === 0 && <p className="text-sm text-slate-400">The discussion hasn&apos;t started yet.</p>}
        {transcript.map((u) => (
          <div key={u.id} className="text-sm">
            <span className="font-semibold text-slate-900">{u.speakerName}</span>{" "}
            <span className="text-[10px] uppercase text-slate-400">{u.phase.replace("_", " ")}</span>
            {u.wasInterrupted && <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">interrupted</span>}
            <p className="text-slate-600">{u.renderedText}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
