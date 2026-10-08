import {
  pgTable,
  text,
  integer,
  boolean,
  real,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const PHASES = [
  "SETUP",
  "MODERATOR_OPENING",
  "GAP",
  "STUDENT_SPEAKING",
  "AI_SPEAKING",
  "CLOSING_ROUND",
  "ENDED",
] as const;
export type Phase = (typeof PHASES)[number];

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// `id` is the SHA-256 of the random token held in the cookie, so a leaked
// database dump cannot be replayed as a login.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A person the user wants to invite. `label` is what they typed (a name or an
// email); `friendUserId` is filled in when the email matches a registered account.
export const friends = pgTable(
  "friends",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    labelKey: text("label_key").notNull(),
    email: text("email"),
    friendUserId: text("friend_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("friends_user_label_idx").on(t.userId, t.labelKey)]
);

export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  topicCategory: text("topic_category").notNull().default("predefined"),
  participantCount: integer("participant_count").notNull(),
  studentName: text("student_name").notNull().default("You"),
  phase: text("phase").notNull().default("SETUP"),
  discussionSeconds: integer("discussion_seconds").notNull().default(360),
  closingSeconds: integer("closing_seconds").notNull().default(90),
  consecutiveAiTurns: integer("consecutive_ai_turns").notNull().default(0),
  turnCap: integer("turn_cap").notNull().default(2),
  turnIndex: integer("turn_index").notNull().default(0),
  currentSpeakerId: text("current_speaker_id"),
  lastSpeakerId: text("last_speaker_id"),
  pendingAddress: text("pending_address"),
  discussionStartedAt: timestamp("discussion_started_at", { withTimezone: true }),
  closingStartedAt: timestamp("closing_started_at", { withTimezone: true }),
  closingOrder: jsonb("closing_order").$type<string[]>().default([]),
  closingPointer: integer("closing_pointer").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // v3: who hosts the room (null for guests), the shareable code, and the friends invited.
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  roomCode: text("room_code").unique(),
  invitedFriends: jsonb("invited_friends").$type<string[]>().notNull().default([]),
});

export const participants = pgTable("participants", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'moderator' | 'ai' | 'student'
  name: text("name").notNull(),
  role: text("role").notNull(),
  stance: text("stance").notNull().default("neutral"),
  eagerness: real("eagerness").notNull().default(0.5),
  voiceRate: real("voice_rate").notNull().default(1.0),
  voicePitch: real("voice_pitch").notNull().default(1.0),
  voiceGenderHint: text("voice_gender_hint").notNull().default("neutral"),
  colorHex: text("color_hex").notNull().default("#6366f1"),
  avatarEmoji: text("avatar_emoji").notNull().default("🤖"),
  seatIndex: integer("seat_index").notNull().default(0),
  lastSpokeAtMs: integer("last_spoke_at_ms").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const utterances = pgTable("utterances", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  participantId: text("participant_id"),
  speakerName: text("speaker_name").notNull(),
  speakerKind: text("speaker_kind").notNull(),
  turnIndex: integer("turn_index").notNull(),
  phase: text("phase").notNull(),
  fullText: text("full_text").notNull(),
  renderedText: text("rendered_text").notNull(),
  wasInterrupted: boolean("was_interrupted").notNull().default(false),
  addresses: text("addresses"),
  startedAtMs: integer("started_at_ms").notNull(),
  endedAtMs: integer("ended_at_ms").notNull(),
  wordCount: integer("word_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feedbackReports = pgTable("feedback_reports", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" })
    .unique(),
  metricsJson: jsonb("metrics_json").notNull(),
  rubricJson: jsonb("rubric_json").notNull(),
  suggestionsJson: jsonb("suggestions_json").notNull(),
  overallScore: real("overall_score").notNull().default(0),
  verifiedAllQuotes: boolean("verified_all_quotes").notNull().default(false),
  // v3: "You against the table" comparison and the AI meeting notes.
  comparisonJson: jsonb("comparison_json"),
  notesJson: jsonb("notes_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
