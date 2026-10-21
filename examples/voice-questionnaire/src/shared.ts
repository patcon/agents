import type { UIMessage } from "ai";

// --- Questions and answers ---

export type QuestionType = "radio" | "checkbox" | "text" | "number";

export type Question = {
  id: string;
  type: QuestionType;
  prompt: string;
  options?: string[];
  min?: number;
  max?: number;
  required: boolean;
  source: "schedule" | "host" | "agent";
};

export type AnswerValue = string | string[] | number | null;

export type Answer = { value: AnswerValue; skipped: boolean };

export type SessionStatus = "idle" | "recording" | "paused" | "finished";

// --- The log ---
//
// Every entry is a UIMessage with its own id, and nothing is ever updated in
// place. `subjectId` names the logical thing an entry is about: answering a
// question twice appends two `answer` entries with the same subjectId, and
// the last one wins when the log is folded.

export type LogMeta =
  | { kind: "utterance"; subjectId: string; at: number }
  | { kind: "question"; subjectId: string; at: number }
  | { kind: "answer"; subjectId: string; at: number }
  | { kind: "trigger"; subjectId: string; at: number }
  | { kind: "status"; subjectId: "session"; at: number };

export type LogDataParts = {
  question: Question;
  answer: Answer;
  status: { status: SessionStatus };
};

export type LogMessage = UIMessage<LogMeta, LogDataParts>;

// --- The fake schedule ---

/** Seconds after the session starts that each scheduled question appears. */
export const SCHEDULE: {
  at: number;
  question: Omit<Question, "id" | "source">;
}[] = [
  {
    at: 15,
    question: {
      type: "radio",
      prompt: "How are you feeling about the topic so far?",
      options: ["Optimistic", "Neutral", "Concerned", "Not sure yet"],
      required: true
    }
  },
  {
    at: 45,
    question: {
      type: "checkbox",
      prompt: "Which of these have come up in what you've said?",
      options: ["Cost", "Time", "People", "Risk", "Something else"],
      required: false
    }
  },
  {
    at: 75,
    question: {
      type: "number",
      prompt: "On a scale of 1–10, how important is this to you?",
      min: 1,
      max: 10,
      required: true
    }
  },
  {
    at: 105,
    question: {
      type: "text",
      prompt: "In one sentence, what would a good outcome look like?",
      required: false
    }
  }
];

/** When the agent asks its question, based on the transcript so far. */
export const AGENT_QUESTION_AT = 120;

// --- The fold ---

export type QuestionView = {
  question: Question;
  askedAt: number;
  answer?: Answer;
  /** How many answer entries exist for this question (1 = never revised). */
  answerCount: number;
};

export type LogView = {
  status: SessionStatus;
  startedAt?: number;
  utterances: { id: string; text: string; at: number }[];
  questions: QuestionView[];
};

export function textOf(message: LogMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

/**
 * Fold the append-only log into current state. Run on both sides: the client
 * renders it, and the server feeds it to the model.
 */
export function foldLog(messages: readonly LogMessage[]): LogView {
  const view: LogView = { status: "idle", utterances: [], questions: [] };
  const questions = new Map<string, QuestionView>();

  for (const message of messages) {
    const meta = message.metadata;
    if (!meta) continue; // e.g. the agent's own assistant turns

    for (const part of message.parts) {
      if (part.type === "data-status") {
        view.status = part.data.status;
        if (part.data.status === "recording" && view.startedAt === undefined) {
          view.startedAt = meta.at;
        }
      } else if (part.type === "data-question") {
        if (questions.has(meta.subjectId)) continue;
        const entry = { question: part.data, askedAt: meta.at, answerCount: 0 };
        questions.set(meta.subjectId, entry);
        view.questions.push(entry);
      } else if (part.type === "data-answer") {
        const entry = questions.get(meta.subjectId);
        if (!entry) continue;
        entry.answer = part.data;
        entry.answerCount++;
      }
    }

    if (meta.kind === "utterance") {
      view.utterances.push({
        id: message.id,
        text: textOf(message),
        at: meta.at
      });
    }
  }

  return view;
}

/**
 * Whether `next` would say the same as the current answer. Checkbox order and
 * surrounding whitespace don't count as a change.
 */
export function sameAnswer(current: Answer | undefined, next: Answer) {
  if (!current) return false;
  if (current.skipped || next.skipped) return current.skipped === next.skipped;
  const normalize = (value: AnswerValue) =>
    JSON.stringify(
      Array.isArray(value)
        ? [...value].sort()
        : typeof value === "string"
          ? value.trim()
          : value
    );
  return normalize(current.value) === normalize(next.value);
}

export function formatAnswer(answer: Answer | undefined): string {
  if (!answer) return "(unanswered)";
  if (answer.skipped) return "(skipped)";
  const { value } = answer;
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(none)";
  return value === null || value === "" ? "(empty)" : String(value);
}
