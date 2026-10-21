import { callable, routeAgentRequest, type Connection } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  withVoiceInput,
  type Transcriber,
  type TranscriberSessionOptions
} from "agents/voice";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage
} from "ai";
import { generateJson } from "./gemini";
import { GeminiLiveSTT } from "./voice-gemini/live";
import {
  AGENT_QUESTION_AT,
  EMPTY_USAGE,
  SCHEDULE,
  foldLog,
  formatAnswer,
  sameAnswer,
  textOf,
  type AnswerValue,
  type LogMessage,
  type LogView,
  type Question,
  type SessionStatus,
  type Usage
} from "./shared";

/** Questions the host can push on demand (the log drawer's "From host" button). */
const HOST_QUESTIONS: Omit<Question, "id" | "source">[] = [
  {
    type: "radio",
    prompt: "Quick check from the host: can everyone hear you clearly?",
    options: ["Yes", "Mostly", "No"],
    required: false
  },
  {
    type: "text",
    prompt: "The host would like your name for the record.",
    required: true
  }
];

/** What the agent's question must look like, as Gemini's response schema. */
const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["radio", "checkbox", "text", "number"] },
    prompt: { type: "string" },
    options: {
      type: "array",
      items: { type: "string" },
      description: "Required for radio and checkbox"
    },
    min: { type: "number" },
    max: { type: "number" }
  },
  required: ["type", "prompt"]
};

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

const VoiceChatAgent = withVoiceInput(AIChatAgent);

/** 16 kHz mono s16le, as the voice client streams it. */
const AUDIO_BYTES_PER_SECOND = 32_000;
/** How often streamed audio is added to the usage tally while recording. */
const USAGE_FLUSH_MS = 5_000;

/**
 * One conversation, one Durable Object.
 *
 * Everything that happens (utterances, questions, answers, status changes,
 * agent triggers) is appended to `this.messages` as a new UIMessage. Nothing
 * is edited in place; `foldLog()` turns the log into current state.
 */
export class ConversationAgent extends VoiceChatAgent<Env, Usage> {
  initialState = EMPTY_USAGE;

  createTranscriber(_connection: Connection): Transcriber {
    for (const name of [
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_ACCESS_TOKEN"
    ] as const) {
      if (!this.env[name]?.trim()) throw new Error(`${name} isn't set`);
    }
    const stt = new GeminiLiveSTT({
      accessToken: this.env.GOOGLE_ACCESS_TOKEN,
      project: this.env.GOOGLE_CLOUD_PROJECT,
      location: "global",
      model: this.env.STT_MODEL
    });
    return { createSession: (options) => this.#countUsage(stt, options) };
  }

  // --- Usage ---

  #addUsage(add: Partial<Omit<Usage, "sttModel" | "agentModel">>) {
    const next: Usage = {
      ...this.state,
      sttModel: this.env.STT_MODEL,
      agentModel: this.env.AGENT_MODEL
    };
    for (const [key, value] of Object.entries(add) as [
      keyof typeof add,
      number
    ][]) {
      next[key] += value;
    }
    this.setState(next);
  }

  /**
   * Every second of audio streamed to Gemini Live counts as audio input,
   * speech or not, so the session's audio is counted as it's fed. It's added to the tally
   * every few seconds rather than on every chunk.
   */
  #countUsage(stt: Transcriber, options?: TranscriberSessionOptions) {
    let bytes = 0;
    let flushedAt = Date.now();
    const flush = () => {
      if (!bytes) return;
      this.#addUsage({ audioSeconds: bytes / AUDIO_BYTES_PER_SECOND });
      bytes = 0;
      flushedAt = Date.now();
    };
    const session = stt.createSession({
      ...options,
      onUtterance: (text) => {
        this.#addUsage({ transcriptChars: text.length });
        options?.onUtterance?.(text);
      }
    });
    const feed = session.feed.bind(session);
    const close = session.close.bind(session);
    session.feed = (chunk) => {
      bytes += chunk.byteLength;
      if (Date.now() - flushedAt > USAGE_FLUSH_MS) flush();
      feed(chunk);
    };
    session.close = () => {
      flush();
      close();
    };
    return session;
  }

  // Appends run one after another so each one sees the previous write.
  #tail: Promise<void> = Promise.resolve();

  #append(...entries: LogMessage[]) {
    const run = this.#tail.then(() =>
      this.persistMessages([...this.messages, ...(entries as UIMessage[])])
    );
    this.#tail = run.catch((error) => console.error("append failed", error));
    return run;
  }

  #view(): LogView {
    return foldLog(this.messages as LogMessage[]);
  }

  #appendStatus(status: SessionStatus) {
    return this.#append({
      id: newId("status"),
      role: "system",
      metadata: { kind: "status", subjectId: "session", at: Date.now() },
      parts: [{ type: "data-status", data: { status } }]
    });
  }

  #appendQuestion(question: Question) {
    return this.#append({
      id: newId("msg"),
      role: "system",
      metadata: { kind: "question", subjectId: question.id, at: Date.now() },
      parts: [{ type: "data-question", data: question }]
    });
  }

  // --- Voice ---

  async onTranscript(text: string, _connection: Connection) {
    if (this.#view().status !== "recording") return;
    await this.#append({
      id: newId("utt"),
      role: "user",
      metadata: { kind: "utterance", subjectId: newId("u"), at: Date.now() },
      parts: [{ type: "text", text }]
    });
  }

  // --- Session controls (called from the client) ---

  @callable()
  async begin() {
    if (this.#view().status !== "idle") return;
    await this.#appendStatus("recording");
    for (const [index, slot] of SCHEDULE.entries()) {
      await this.schedule(slot.at, "askScheduled", { index });
    }
    await this.schedule(AGENT_QUESTION_AT, "askAgentQuestion");
  }

  @callable()
  async setPaused(paused: boolean) {
    const { status } = this.#view();
    if (status !== "recording" && status !== "paused") return;
    await this.#appendStatus(paused ? "paused" : "recording");
  }

  @callable()
  async finish() {
    if (this.#view().status !== "paused") return;
    for (const schedule of this.getSchedules()) {
      await this.cancelSchedule(schedule.id);
    }
    await this.#appendStatus("finished");
  }

  /**
   * Answering again is a revision: a new entry with the same subjectId. An
   * answer that says the same as the current one isn't appended.
   */
  @callable()
  async answer(questionId: string, value: AnswerValue, skipped = false) {
    const entry = this.#view().questions.find(
      (q) => q.question.id === questionId
    );
    if (!entry) throw new Error(`Unknown question ${questionId}`);
    if (sameAnswer(entry.answer, { value, skipped })) return;
    await this.#append({
      id: newId("msg"),
      role: "user",
      metadata: { kind: "answer", subjectId: questionId, at: Date.now() },
      parts: [
        {
          type: "data-answer",
          data: { value: skipped ? null : value, skipped }
        }
      ]
    });
  }

  /** On-demand question from the host, outside the schedule. */
  @callable()
  async pushHostQuestion() {
    if (this.#view().status === "finished") return;
    const count = this.#view().questions.filter(
      (q) => q.question.source === "host"
    ).length;
    const template = HOST_QUESTIONS[count % HOST_QUESTIONS.length];
    await this.#appendQuestion({
      ...template,
      id: newId("q"),
      source: "host"
    });
  }

  /** On-demand agent question (the log drawer's "From agent" button). */
  @callable()
  async askAgentNow() {
    await this.askAgentQuestion();
  }

  // --- Scheduled callbacks ---

  async askScheduled({ index }: { index: number }) {
    if (this.#view().status === "finished") return;
    await this.#appendQuestion({
      ...SCHEDULE[index].question,
      id: newId("q"),
      source: "schedule"
    });
  }

  /**
   * Wake the agent without a human message: append a `trigger` entry and run
   * a turn. The trigger stays in the log, so it's clear why the turn ran.
   */
  async askAgentQuestion() {
    if (this.#view().status === "finished") return;
    await this.#tail;
    const agentQuestions = () =>
      this.#view().questions.filter((q) => q.question.source === "agent")
        .length;
    const asked = agentQuestions();
    await this.saveMessages((messages) => [
      ...messages,
      {
        id: newId("trigger"),
        role: "user",
        metadata: {
          kind: "trigger",
          subjectId: "agent-question",
          at: Date.now()
        },
        parts: [
          {
            type: "text",
            text: "Ask one follow-up question inspired by what the speaker has said."
          }
        ]
      } satisfies LogMessage as UIMessage
    ]);

    // Fall back to a fixed question if the model call failed.
    await this.#tail;
    if (agentQuestions() === asked) {
      await this.#appendQuestion({
        id: newId("q"),
        type: "text",
        prompt: "Is there anything you said that you'd like to expand on?",
        required: false,
        source: "agent"
      });
    }
  }

  // --- The agent turn ---

  async onChatMessage(_onFinish: unknown, _options?: OnChatMessageOptions) {
    const view = this.#view();
    const trigger = [...(this.messages as LogMessage[])]
      .reverse()
      .find((m) => m.metadata?.kind === "trigger");

    // The model sees the folded view, not the raw log: revised answers show
    // only their latest value, and status entries are left out.
    const context = [
      "Transcript so far:",
      view.utterances.map((u) => `- ${u.text}`).join("\n") || "(nothing yet)",
      "",
      "Questions and current answers:",
      view.questions
        .map((q) => `- ${q.question.prompt} → ${formatAnswer(q.answer)}`)
        .join("\n") || "(none)",
      "",
      `Task: ${trigger ? textOf(trigger) : "Ask one question."}`
    ].join("\n");

    const { json, usage } = await generateJson(this.env, {
      system:
        "You help run a spoken interview. Read what the speaker said and ask exactly one " +
        "short, specific follow-up question. Pick the input type that fits the question, " +
        "and give options for radio and checkbox. Refer to something they actually said.",
      prompt: context,
      schema: QUESTION_SCHEMA
    });
    this.#addUsage({
      agentCalls: 1,
      agentInputTokens: usage.inputTokens,
      agentOutputTokens: usage.outputTokens
    });
    const input = json as Pick<
      Question,
      "type" | "prompt" | "options" | "min" | "max"
    >;

    await this.#appendQuestion({
      ...input,
      id: newId("q"),
      required: false,
      source: "agent"
    });

    // The turn's own assistant message records what was asked.
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "text-start", id: "asked" });
        writer.write({
          type: "text-delta",
          id: "asked",
          delta: `Asked: ${input.prompt}`
        });
        writer.write({ type: "text-end", id: "asked" });
      }
    });
    return createUIMessageStreamResponse({ stream });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
