// Minimal server-side LLM client using Hugging Face's OpenAI-compatible API.
// Every caller must treat a `null` return as "LLM unavailable" and fall back
// to the rule-based path, so the app keeps working with no key or on errors.

const API_URL =
  process.env.LLM_BASE_URL || "https://router.huggingface.co/v1/chat/completions";

export const DIRECTOR_MODEL = process.env.DIRECTOR_MODEL || "google/gemma-4-E4B-it";
export const REPORT_MODEL = process.env.REPORT_MODEL || "google/gemma-4-E4B-it";

export function isLlmEnabled(): boolean {
  return Boolean(process.env.HF_TOKEN);
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function callClaude(opts: {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  timeoutMs: number;
}): Promise<string | null> {
  const key = process.env.HF_TOKEN;
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        messages: [{ role: "system", content: opts.system }, ...opts.messages],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("LLM error:", res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    console.error("LLM request failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pulls the first JSON object out of a model reply (tolerates ``` fences). */
export function extractJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}