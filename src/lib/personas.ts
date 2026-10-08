export type Stance = "for" | "against" | "neutral";

export interface PersonaTemplate {
  role: string;
  style: string; // used to pick supporting-clause bank
  eagerness: number;
  voiceRate: number;
  voicePitch: number;
  voiceGenderHint: "male" | "female";
  colorHex: string;
  avatarEmoji: string;
}

export const PERSONA_TEMPLATES: PersonaTemplate[] = [
  {
    role: "The Data-Driven Analyst",
    style: "analyst",
    eagerness: 0.55,
    voiceRate: 0.95,
    voicePitch: 0.85,
    voiceGenderHint: "male",
    colorHex: "#2563eb",
    avatarEmoji: "📊",
  },
  {
    role: "The Devil's Advocate",
    style: "contrarian",
    eagerness: 0.78,
    voiceRate: 1.05,
    voicePitch: 1.12,
    voiceGenderHint: "female",
    colorHex: "#dc2626",
    avatarEmoji: "😈",
  },
  {
    role: "The Optimist",
    style: "optimist",
    eagerness: 0.6,
    voiceRate: 1.02,
    voicePitch: 1.3,
    voiceGenderHint: "female",
    colorHex: "#f59e0b",
    avatarEmoji: "🌞",
  },
  {
    role: "The Pragmatist",
    style: "pragmatist",
    eagerness: 0.5,
    voiceRate: 0.9,
    voicePitch: 0.8,
    voiceGenderHint: "male",
    colorHex: "#16a34a",
    avatarEmoji: "🧭",
  },
  {
    role: "The Storyteller",
    style: "storyteller",
    eagerness: 0.65,
    voiceRate: 1.0,
    voicePitch: 1.15,
    voiceGenderHint: "female",
    colorHex: "#9333ea",
    avatarEmoji: "📖",
  },
  {
    role: "The Skeptic",
    style: "skeptic",
    eagerness: 0.7,
    voiceRate: 0.95,
    voicePitch: 0.75,
    voiceGenderHint: "male",
    colorHex: "#64748b",
    avatarEmoji: "🤨",
  },
  {
    role: "The Enthusiast",
    style: "enthusiast",
    eagerness: 0.82,
    voiceRate: 1.12,
    voicePitch: 1.25,
    voiceGenderHint: "female",
    colorHex: "#ec4899",
    avatarEmoji: "⚡",
  },
  {
    role: "The Diplomat",
    style: "diplomat",
    eagerness: 0.45,
    voiceRate: 0.92,
    voicePitch: 1.0,
    voiceGenderHint: "male",
    colorHex: "#0d9488",
    avatarEmoji: "🤝",
  },
  {
    role: "The Visionary",
    style: "visionary",
    eagerness: 0.6,
    voiceRate: 1.0,
    voicePitch: 1.2,
    voiceGenderHint: "female",
    colorHex: "#7c3aed",
    avatarEmoji: "🔭",
  },
  {
    role: "The Realist",
    style: "realist",
    eagerness: 0.55,
    voiceRate: 0.95,
    voicePitch: 0.82,
    voiceGenderHint: "male",
    colorHex: "#334155",
    avatarEmoji: "⚖️",
  },
];

const MALE_NAMES = ["Aarav", "Kabir", "Rohan", "Vikram", "Dev", "Ishaan", "Arjun", "Nikhil"];
const FEMALE_NAMES = ["Priya", "Meera", "Zara", "Anya", "Sana", "Tara", "Diya", "Naina"];

export const MODERATOR_NAME = "Meera";

export function pickNames(genderHints: ("male" | "female")[]): string[] {
  const used = new Set<string>();
  const result: string[] = [];
  for (const hint of genderHints) {
    const pool = hint === "male" ? MALE_NAMES : FEMALE_NAMES;
    const available = pool.filter((n) => !used.has(n));
    const name = available[Math.floor(Math.random() * available.length)] ?? pool[0];
    used.add(name);
    result.push(name);
  }
  return result;
}

export function shufflePersonas(count: number): PersonaTemplate[] {
  const pool = [...PERSONA_TEMPLATES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function assignStances(count: number): Stance[] {
  // Roughly balance for/against/neutral so the discussion has real tension.
  const stances: Stance[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 3 === 0) stances.push("for");
    else if (i % 3 === 1) stances.push("against");
    else stances.push("neutral");
  }
  for (let i = stances.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [stances[i], stances[j]] = [stances[j], stances[i]];
  }
  return stances;
}
