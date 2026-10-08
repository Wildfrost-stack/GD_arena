# GD Arena 🎙️🤖

> **A voice-first Group Discussion practice platform powered by TypeScript, multi-persona AI participants, natural real-time turn-taking, and verifiable evidence-linked feedback reports.**

![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue)
![Framework](https://img.shields.io/badge/Framework-Next.js_14-black)
![Database](https://img.shields.io/badge/Database-PostgreSQL_%2B_Drizzle-blue)
![Cache](https://img.shields.io/badge/Cache-Redis-red)
![License](https://img.shields.io/badge/License-MIT-green)

---

## 🌟 Table of Contents
- [Overview](#-overview)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Environment Variables](#environment-variables)
  - [Installation & Setup](#installation--setup)
- [Core Workflows](#-core-workflows)
  - [Turn-Taking & Director Pattern](#1-turn-taking--director-pattern)
  - [Real-time Interruption (Barge-In)](#2-real-time-interruption-barge-in)
  - [Evidence-Linked Feedback Pipeline](#3-evidence-linked-feedback-pipeline)
- [Resilience & Fallbacks](#-resilience--fallbacks)
- [License](#-license)

---

## 🌟 Overview

**GD Arena** solves the challenge of practicing group discussions (GD) for placement interviews, admissions, and public speaking. Unlike traditional single-prompt chatbots, GD Arena orchestrates 3 to 5 AI participants with distinct behavioral personas alongside an automated AI Moderator. 

Built end-to-end with **TypeScript**, the platform combines in-browser Voice Activity Detection (VAD), a server-side floor control state machine, streaming STT/TTS, and server-verified evaluation pipelines to deliver a realistic practice environment.

---

## ✨ Key Features

* 🗣️ **Multi-Persona AI Participants**: Practice against distinct personalities (e.g., Aggressive Dominator, Data-driven Analyst, Quiet Contributor) and an AI Moderator.
* 🚦 **Floor Control State Machine**: Server-managed turn-taking prevents AI crosstalk, eliminates awkward silences, and maintains structured discussion phases.
* ⚡ **Instant Barge-In (Interruption Handling)**: In-browser Silero VAD halts AI audio playback immediately when the user speaks, capturing only what was actually uttered.
* 📑 **Verifiable Evidence-Linked Reports**: Post-session analytics deliver metric scores (e.g., listening skills, handling interruptions) with clickable, verbatim transcript quotes verified on the backend.
* 👥 **Social & Room Management**: User authentication, friend management, and instant room invitations.
* 💡 **Real-time AI Notes**: Live synthesis of session transcripts into structured takeaways and action items.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Next.js 14 Frontend (Client)                        │
│                                                                         │
│  ┌───────────────────────────┐         ┌─────────────────────────────┐  │
│  │ AudioWorklet + Silero VAD │         │ Interactive Seat & Notes UI │  │
│  └─────────────┬─────────────┘         └──────────────▲──────────────┘  │
└────────────────┼──────────────────────────────────────┼─────────────────┘
                 │ Opus Chunks / Audio Events           │ Events / State
                 ▼                                      │
┌───────────────────────────────────────────────────────┴─────────────────┐
│                    TypeScript Next.js API Routes                        │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    Floor-Control State Machine                    │  │
│  └─────────────────────────────────┬─────────────────────────────────┘  │
│                                    │                                    │
│  ┌─────────────────────────────────▼─────────────────────────────────┐  │
│  │                       Director LLM Step                           │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└──────────────┬─────────────────────┬─────────────────────┬──────────────┘
               │                     │                     │
               ▼                     ▼                     ▼
     Deepgram Streaming STT    Multi-Voice TTS      Post-Session Pipeline
      (Web Speech Fallback)    (Hosted Audio)       (Quote Verification)
```

---

## 🛠️ Tech Stack

| Category | Technology | Purpose |
| :--- | :--- | :--- |
| **Language** | TypeScript | End-to-end type safety across client, backend API routes, and state machine |
| **Frontend Framework** | Next.js 14 (App Router) | Responsive UI, seat cards, real-time timer, and streaming updates |
| **Styling** | Tailwind CSS | UI styling and responsive layouts |
| **Database & ORM** | PostgreSQL + Drizzle ORM | Schema management for users, friendships, room invites, utterances, and AI notes |
| **Caching / Session** | Redis | Room state storage and session persistence |
| **Audio Processing** | AudioWorklet, ONNX Runtime (Silero VAD) | In-browser client-side voice detection for instant interruption handling |
| **Speech-to-Text** | Deepgram Streaming API | Real-time audio transcription with Web Speech API fallback |
| **Text-to-Speech** | Streaming Multi-Voice TTS | Expressive voice generation for up to 6 distinct speakers |
| **LLM Engine** | Low-Latency LLM (GPT-4o / Claude) | Single Director LLM call per turn and report generation |

---

## 📁 Project Structure

```text
gd-arena/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/          # Authentication API endpoints
│   │   │   ├── friends/       # Friend requests & status APIs
│   │   │   └── rooms/         # Room orchestration, invitations, & AI notes
│   │   ├── room/              # GD Room interactive interface
│   │   └── page.tsx           # Home & Dashboard page
│   ├── components/            # Reusable UI components
│   ├── db/
│   │   ├── index.ts           # Drizzle ORM connection client
│   │   └── schema.ts          # Postgres database schema definitions
│   ├── lib/
│   │   ├── vad/               # Voice Activity Detection worklet handlers
│   │   ├── state-machine.ts   # Floor control & turn-taking engine
│   │   └── llm.ts             # LLM client abstractions
├── drizzle.config.ts          # Drizzle kit configuration
├── package.json
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed locally:
- **Node.js**: `v18.0.0` or higher
- **npm** / **pnpm** / **yarn**
- **PostgreSQL**: Running instance
- **Redis**: Running instance

### Environment Variables

Create a `.env.local` file in the root directory:

```env
# Database & Redis
DATABASE_URL="postgresql://postgres:password@localhost:5432/gd_arena"
REDIS_URL="redis://localhost:6379"

# AI Provider Credentials
STT_API_KEY="your_deepgram_api_key"
TTS_API_KEY="your_tts_provider_api_key"
LLM_API_KEY="your_openai_or_anthropic_api_key"

# App Options
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### Installation & Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/gd-arena.git
   cd gd-arena
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Database Migration**
   Push the Drizzle ORM schema to your PostgreSQL database:
   ```bash
   npx drizzle-kit push
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open the Application**  
   Navigate to `http://localhost:3000` in your browser.

---

## 💡 Core Workflows

### 1. Turn-Taking & Director Pattern
Rather than initializing 5 uncoordinated AI agents that speak over each other, GD Arena utilizes a single **Director LLM pattern**:
- A server-side state machine computes speaker eagerness based on persona profiles, recency of speech, and direct name call-outs.
- A single LLM call evaluates the conversation context and returns a structured JSON payload determining the next speaker and utterance.

### 2. Real-time Interruption (Barge-In)
- Silero VAD runs client-side in an `AudioWorklet`.
- When user speech is detected while an AI is speaking, audio playback immediately stops on the client.
- A cancellation signal is emitted to the server, ensuring only spoken words are recorded in the transcript.

### 3. Evidence-Linked Feedback Pipeline
1. **Segmentation**: Every spoken utterance is tagged with an ID, speaker name, and timestamp.
2. **Metrics Computation**: Calculates metrics such as talk-time distribution, turn frequency, WPM, and interruption stats.
3. **Structured Scoring**: Evaluates criteria (e.g., Opening, Idea Quality, Listening, Closing).
4. **Server-Side Quote Verification**: Checks generated LLM quotes against actual transcript segment IDs to ensure quotes are $100\%$ authentic and hallucination-free.

---

## 🛡️ Resilience & Fallbacks

| Failure Edge Case | Automatic Mitigation |
| :--- | :--- |
| **Microphone Permission Denied** | Prompts user and seamlessly enables text input mode |
| **Network Disconnect** | Auto-reconnects and restores state from server-side Redis |
| **STT Service Degradation** | Falls back to native browser Web Speech API |
| **TTS Service Failure** | Continues session by displaying AI turns as live text captions |
| **LLM Schema Mismatch** | Schema validation retries once, then defaults to moderator fallback |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).