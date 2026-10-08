// Thin wrappers around browser Web Speech APIs (SpeechSynthesis for TTS,
// SpeechRecognition for STT) and a lightweight amplitude-based Voice
// Activity Detector used for barge-in. A true Silero/ONNX AudioWorklet VAD
// needs a bundled ML model and worklet build pipeline; this RMS-threshold
// detector preserves the same architectural contract (continuous client-
// side detection -> instant local stop -> server cancellation signal)
// while staying dependency-free for this environment.

export interface VoiceProfile {
  rate: number;
  pitch: number;
  genderHint: "male" | "female" | "neutral";
}

let cachedVoices: SpeechSynthesisVoice[] = [];

export function primeVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) cachedVoices = voices;
  return cachedVoices;
}

export function pickVoiceForProfile(profile: VoiceProfile, seed = 0): SpeechSynthesisVoice | undefined {
  const voices = primeVoices();
  if (voices.length === 0) return undefined;
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = english.length > 0 ? english : voices;

  const femaleHints = ["female", "zira", "samantha", "victoria", "susan", "karen", "google uk english female", "fiona"];
  const maleHints = ["male", "david", "daniel", "alex", "fred", "google uk english male", "mark"];

  // Collect ALL voices matching the gender hint and rotate by seat, so two
  // same-gender participants do not end up sharing the same system voice.
  const matches = (hints: string[]) => pool.filter((v) => hints.some((h) => v.name.toLowerCase().includes(h)));
  const choose = (list: SpeechSynthesisVoice[]) => (list.length > 0 ? list : pool)[Math.abs(seed) % (list.length > 0 ? list.length : pool.length)];

  if (profile.genderHint === "female") return choose(matches(femaleHints));
  if (profile.genderHint === "male") return choose(matches(maleHints));
  return pool[Math.abs(seed) % pool.length];
}

export function estimateSpeechMs(text: string, rate: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const baseWpm = 155 * rate;
  return Math.max(600, (words / baseWpm) * 60000);
}

type SpeechRecognitionCtor = new () => SpeechRecognition;

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class MicVad {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private rafId: number | null = null;
  private aboveSince: number | null = null;
  private readonly baseThreshold: number;
  private readonly baseSustainMs: number;

  constructor(
    private stream: MediaStream,
    private onTrigger: () => void,
    private threshold = 0.055,
    private sustainMs = 150
  ) {
    this.baseThreshold = threshold;
    this.baseSustainMs = sustainMs;
  }

  /** Browser SpeechSynthesis output is usually NOT covered by echo
   * cancellation, so the mic hears the AI voice. While an AI is speaking we
   * demand a much louder and longer sound before treating it as the student
   * interrupting; otherwise normal sensitivity. */
  setAiSpeaking(speaking: boolean) {
    this.threshold = speaking ? this.baseThreshold * 2.4 : this.baseThreshold;
    this.sustainMs = speaking ? 380 : this.baseSustainMs;
    this.aboveSince = null;
  }

  start() {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioCtx();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    this.source = this.audioCtx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
    this.data = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    this.loop();
  }

  setEnabled(_enabled: boolean) {
    // Kept for API symmetry; detection always runs, trigger callback
    // decides whether the current app state cares about it.
    void _enabled;
  }

  private loop = () => {
    if (!this.analyser || !this.data) return;
    this.analyser.getByteTimeDomainData(this.data);
    let sumSquares = 0;
    for (let i = 0; i < this.data.length; i++) {
      const norm = (this.data[i] - 128) / 128;
      sumSquares += norm * norm;
    }
    const rms = Math.sqrt(sumSquares / this.data.length);

    if (rms > this.threshold) {
      if (this.aboveSince === null) this.aboveSince = performance.now();
      else if (performance.now() - this.aboveSince > this.sustainMs) {
        this.aboveSince = null;
        this.onTrigger();
      }
    } else {
      this.aboveSince = null;
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }
}
