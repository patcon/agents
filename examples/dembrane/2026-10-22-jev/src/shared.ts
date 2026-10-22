import type { UIMessage } from "ai";
import type { CardSpec } from "./cards";
import generatedPrices from "./prices.json";

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
  /** How it's shown, as a json-render spec. `defaultCard()` when absent. */
  card?: CardSpec;
  source: "plan" | "host" | "agent";
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

// --- Usage and cost ---
//
// Kept in the agent's state rather than the log: it's a running tally, not
// an event anyone acts on.

export type Usage = {
  sttModel: string;
  agentModel: string;
  /** Seconds of microphone audio streamed to the transcriber. */
  audioSeconds: number;
  /** Characters of final transcript Gemini sent back. */
  transcriptChars: number;
  agentCalls: number;
  /** As Gemini reported them in `usageMetadata`. */
  agentInputTokens: number;
  /** Response and thinking tokens, which are both billed as output. */
  agentOutputTokens: number;
};

export const EMPTY_USAGE: Usage = {
  sttModel: "",
  agentModel: "",
  audioSeconds: 0,
  transcriptChars: 0,
  agentCalls: 0,
  agentInputTokens: 0,
  agentOutputTokens: 0
};

/** Gemini counts audio at 25 tokens a second. */
export const AUDIO_TOKENS_PER_SECOND = 25;
/** Rough tokens for transcript text we only have as characters. */
export const CHARS_PER_TOKEN = 4;

/** USD per million tokens, from the date given (or always, without one). */
export type Rate = { from?: string; input: number; output: number };

/**
 * List prices for the models in wrangler.jsonc: today's from LiteLLM and
 * announced changes from genai-prices. Refresh with `pnpm update-prices`.
 */
export const PRICES: Record<string, Rate[]> = generatedPrices.models;

/** The rate in effect on `date` (YYYY-MM-DD), if the model is priced. */
export function rateOn(model: string, date: string): Rate | undefined {
  return PRICES[model]?.filter((r) => !r.from || r.from <= date).at(-1);
}

/** Dates after `today` on which any of these models' price changes. */
export function priceChangesAfter(today: string, models: string[]) {
  const dates = models.flatMap((m) =>
    (PRICES[m] ?? []).flatMap((r) => (r.from && r.from > today ? [r.from] : []))
  );
  return [...new Set(dates)].sort();
}

export function costOf(
  rate: Rate | undefined,
  inputTokens: number,
  outputTokens: number
) {
  if (!rate) return undefined;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1e6;
}

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
