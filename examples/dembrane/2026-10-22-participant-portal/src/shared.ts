import type { UIMessage } from "ai";
import type { CardSpec } from "./cards/cards";
import { likelihoodOf, type QuestionAssessment } from "./models/jev";
import generatedPrices from "./models/prices.json";

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
  /** False keeps Jev from judging its options. */
  assess?: boolean;
  /** The platform's consent card: recording waits for every option ticked. */
  consent?: true;
  /** Once answered, it can't be revised. A skip doesn't count. */
  final?: true;
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
  | { kind: "status"; subjectId: "session"; at: number }
  | { kind: "shown"; subjectId: string; at: number }
  | { kind: "assessment"; subjectId: "jev"; at: number };

/**
 * What Jev made of the transcript, for every open question with options.
 * The raw probabilities are kept, and thresholds are applied in the fold.
 */
export type Assessment = {
  model: string;
  /** The last utterance Jev saw. */
  seenUpTo: string;
  /** The question on screen when it ran. */
  onScreen: string | null;
  questions: Record<
    string,
    QuestionAssessment & {
      /** Utterances Jev saw that were said while this question was on screen. */
      heardOnScreen: string[];
    }
  >;
};

/**
 * What Jev makes of the question on screen while it's still being answered,
 * from the transcriber's interim text. Sent to clients, never logged.
 */
export type Preview = {
  questionId: string;
  /** The last utterance before the interim text, if any. */
  after: string | null;
  likelihood: Record<string, number>;
};

/**
 * Whether `preview` still says more than the log does: no assessment has
 * seen past the utterance it came after.
 */
export function isCurrent(view: LogView, preview: Preview) {
  const position = (id: string | null | undefined) =>
    id ? view.utterances.findIndex((u) => u.id === id) : -1;
  return position(view.lastAssessment?.seenUpTo) <= position(preview.after);
}

export type LogDataParts = {
  question: Question;
  answer: Answer;
  status: { status: SessionStatus };
  /** The question a device put on screen. */
  shown: { questionId: string };
  assessment: Assessment;
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
  jevModel: string;
  jevCalls: number;
  /** Jev bills input tokens only. */
  jevInputTokens: number;
};

export const EMPTY_USAGE: Usage = {
  sttModel: "",
  agentModel: "",
  audioSeconds: 0,
  transcriptChars: 0,
  agentCalls: 0,
  agentInputTokens: 0,
  agentOutputTokens: 0,
  jevModel: "",
  jevCalls: 0,
  jevInputTokens: 0
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
export const PRICES: Record<string, Rate[]> = {
  ...generatedPrices.models,
  // TypeSafe's models aren't in LiteLLM. From docs.typesafe.ai/models on
  // 2026-10-22: $0.042 per million input tokens, output free.
  "jev-1.13.0": [{ input: 0.042, output: 0 }],
  "jev-1.14.0": [{ input: 0.042, output: 0 }]
};

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

/**
 * When Jev's likelihood for an option reaches `select`, it's filled into the
 * draft. It stays filled until it drops below `keep`, so a little noise
 * between assessments doesn't flip it.
 */
export const AUTO_SELECT = { select: 0.8, keep: 0.3 };

export type QuestionView = {
  question: Question;
  askedAt: number;
  answer?: Answer;
  /** How many answer entries exist for this question (1 = never revised). */
  answerCount: number;
  /** How likely Jev thinks each option is, from its latest assessment. */
  likelihood?: Record<string, number>;
  /** What Jev's likelihoods fill into the draft, if anything. */
  suggested?: AnswerValue;
};

export type LogView = {
  status: SessionStatus;
  startedAt?: number;
  utterances: {
    id: string;
    text: string;
    at: number;
    /** The question on screen when it was said. */
    onScreen: string | null;
  }[];
  questions: QuestionView[];
  /** The question on screen now, as the last device to move put it. */
  onScreen: string | null;
  lastAssessment?: Assessment;
  /** Whether the consent card's latest answer allows recording. */
  consented: boolean;
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
  const view: LogView = {
    status: "idle",
    utterances: [],
    questions: [],
    onScreen: null,
    consented: false
  };
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
      } else if (part.type === "data-shown") {
        view.onScreen = part.data.questionId;
      } else if (part.type === "data-assessment") {
        view.lastAssessment = part.data;
        for (const [id, assessment] of Object.entries(part.data.questions)) {
          const entry = questions.get(id);
          if (!entry) continue;
          entry.likelihood = likelihoodOf(assessment);
          entry.suggested = suggest(
            entry.question,
            entry.likelihood,
            entry.suggested
          );
        }
      }
    }

    if (meta.kind === "utterance") {
      view.utterances.push({
        id: message.id,
        text: textOf(message),
        at: meta.at,
        onScreen: view.onScreen
      });
    }
  }

  const consent = view.questions.find((q) => q.question.consent);
  const agreed = consent?.answer?.skipped ? null : consent?.answer?.value;
  view.consented =
    Array.isArray(agreed) &&
    (consent?.question.options ?? []).every((option) => agreed.includes(option));

  return view;
}

/** The options to fill in, keeping what was filled before while it holds. */
function suggest(
  question: Question,
  likelihood: Record<string, number>,
  previous: AnswerValue | undefined
): AnswerValue | undefined {
  const p = (option: string) => likelihood[option] ?? 0;
  if (question.type === "checkbox") {
    const kept = Array.isArray(previous) ? previous : [];
    const picked = (question.options ?? []).filter(
      (option) =>
        p(option) >= AUTO_SELECT.select ||
        (kept.includes(option) && p(option) >= AUTO_SELECT.keep)
    );
    return picked.length ? picked : undefined;
  }
  const [top] = Object.keys(likelihood).sort((a, b) => p(b) - p(a));
  if (top !== undefined && p(top) >= AUTO_SELECT.select) return top;
  if (typeof previous === "string" && p(previous) >= AUTO_SELECT.keep) {
    return previous;
  }
  return undefined;
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
