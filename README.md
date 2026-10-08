# GD Arena

Voice-first group-discussion practice room: AI participants with distinct personalities, a moderator, timers, a closing round, and a feedback report where every point links to a verified transcript quote.

## Run

```bash
cp .env.example .env        # set DATABASE_URL and ANTHROPIC_API_KEY
npm install
npx drizzle-kit push        # create tables (schema unchanged from v1)
npm run dev
```

Best in Chrome/Edge (Web Speech STT). Other browsers fall back to typed input. Use headphones.

Without `ANTHROPIC_API_KEY` the app still runs: turns come from the template director and the report from heuristics (the report page labels which was used).

## What changed in this revision

| Area | Change |
|---|---|
| **Stall bug** | `RoomClient` never moved the phase to `AI_SPEAKING` after `next-turn`, so no AI spoke after the moderator opening and barge-in could never fire. Fixed. |
| **AI turns** | `lib/directorLlm.ts`: an LLM writes each turn from the last 10 transcript lines (including the student's real words). Rule-based director still decides who/when. Templates are the fallback. |
| **Topic grammar** | Template fallback no longer splices full-sentence topics into noun-phrase slots. |
| **Report** | `lib/reportLlm.ts`: LLM scores all 6 criteria with a segment id + verbatim quote; server verifies, asks once for a correction, falls back per criterion. |
| **Evidence rule** | `ensureEvidence` guarantees a quote for every item; `verifyQuote` no longer fails on the display-only "..." suffix. |
| **Missed openings** | "What you could have said" now shows the real transcript moment plus a concrete suggested line. |
| **End session** | `POST /api/rooms/[id]/end` + "End & get report" button; report is built from what was said so far. |
| **Race condition** | `next-turn` claims the floor atomically (`GAP -> AI_SPEAKING`), so double triggers/two tabs cannot create duplicate turns. |
| **Echo** | `MicVad.setAiSpeaking()` raises threshold and sustain while an AI is talking; pre-room headphone notice. |
| **Voices** | Voice choice rotates by seat so same-gender AIs don't share one system voice. |
| **Extras** | Silent "you haven't spoken" nudge; adjustable "AI patience" (header select, stored in localStorage). |

## Not done

Hindi-English mixed rooms, friends joining the same room, cross-session progress, server-side Silero VAD, non-browser TTS voices.
