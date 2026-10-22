import { callable, routeAgentRequest, type Connection } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { withBasicAuth } from "@dembrane/examples-shared/basic-auth";
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
import { checkPlan, compilePlaybook } from "./compile";
import { generateJson, googleAccessToken } from "./gemini";
import {
  askJev,
  assessmentRequest,
  isAssessable,
  likelihoodOf,
  readAssessment
} from "./jev";
import { VertexLiveSTT } from "@dembrane/voice-google";
import {
  PlanSchema,
  dueItems,
  lintPlan,
  questionFor,
  type Plan,
  type PlanEvent
} from "./plan";
import adminSetup from "./plans/admin-setup.json";
import compileSystem from "./prompts/compile-playbook.md?raw";
import compileRetry from "./prompts/compile-playbook-retry.md?raw";
import {
  EMPTY_USAGE,
  foldLog,
  formatAnswer,
  sameAnswer,
  textOf,
  type AnswerValue,
  type Assessment,
  type LogMessage,
  type LogView,
  type Preview,
  type Question,
  type SessionStatus,
  type Usage
} from "./shared";

/** The portal admin setup, compiled from its playbook. */
const PLAN = PlanSchema.parse(adminSetup);
const planErrors = lintPlan(PLAN).filter((m) => m.severity === "error");
if (planErrors.length) {
  throw new Error(
    `admin-setup plan: ${planErrors.map((m) => m.message).join("; ")}`
  );
}

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
 * How long Jev waits after a question arrives before it runs, so a section's
 * worth of questions arriving together is judged in one run. An utterance
 * doesn't wait.
 */
const ASSESS_AFTER_QUESTION_MS = 100;
/** How much of the transcript Jev sees, from the end. */
const ASSESS_UTTERANCES = 40;
/** How much of the transcript Jev sees in a preview, before what's being said. */
const PREVIEW_UTTERANCES = 10;

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
    const stt = new VertexLiveSTT({
      accessToken: googleAccessToken(this.env),
      project: this.env.GOOGLE_CLOUD_PROJECT,
      location: "global",
      model: this.env.STT_MODEL
    });
    return { createSession: (options) => this.#countUsage(stt, options) };
  }

  // --- Usage ---

  #addUsage(
    add: Partial<Omit<Usage, "sttModel" | "agentModel" | "jevModel">>
  ) {
    const next: Usage = {
      ...this.state,
      sttModel: this.env.STT_MODEL,
      agentModel: this.env.AGENT_MODEL,
      jevModel: this.env.JEV_MODEL
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
      onInterim: (text) => {
        options?.onInterim?.(text);
        this.#previewSoon(text);
      },
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

  /**
   * The plan this session runs: one compiled on /platform-admin, if the page
   * that opened the session passed one, or else the file's.
   */
  #plan?: Plan;

  async #getPlan() {
    this.#plan ??= (await this.ctx.storage.get<Plan>("plan")) ?? PLAN;
    return this.#plan;
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
    // Jev looks at it with what's been said so far, so it can arrive filled.
    this.#assessSoon(ASSESS_AFTER_QUESTION_MS);
    return this.#append({
      id: newId("msg"),
      role: "system",
      metadata: { kind: "question", subjectId: question.id, at: Date.now() },
      parts: [{ type: "data-question", data: question }]
    });
  }

  /** Append a question for each plan item that `event` releases. */
  async #releasePlan(event: PlanEvent) {
    await this.#tail;
    const plan = await this.#getPlan();
    const { questions, consented } = this.#view();
    const released = new Set(questions.map((q) => q.question.id));
    const answered = {
      byKey: new Map<string, AnswerValue>(),
      items: new Set<string>(),
      consented
    };
    for (const item of plan.items) {
      const answer = questions.find((q) => q.question.id === item.id)?.answer;
      if (!answer || answer.skipped) continue;
      answered.items.add(item.id);
      if (item.kind === "prompt") answered.byKey.set(item.payload.key, answer.value);
    }
    for (const item of dueItems(plan, event, answered, released)) {
      const question = questionFor(item);
      if (question) await this.#appendQuestion(question);
    }
  }

  // --- Voice ---

  async onTranscript(text: string, _connection: Connection) {
    if (this.#view().status !== "recording") return;
    // The utterance covers whatever interim text is still waiting.
    this.#interim = undefined;
    await this.#append({
      id: newId("utt"),
      role: "user",
      metadata: { kind: "utterance", subjectId: newId("u"), at: Date.now() },
      parts: [{ type: "text", text }]
    });
    this.#assessSoon(0);
  }

  // --- Jev ---
  //
  // After each utterance, and each question that arrives, Jev judges which
  // options of every open question the speaker has chosen. Only one run is
  // in flight: whatever arrives meanwhile is
  // covered by one more run after it.

  #assessTimer?: ReturnType<typeof setTimeout>;
  #assessing = false;
  #assessAgain = false;

  /** On whenever there's a key, unless JEV_ENABLED is "false". */
  #jevOn() {
    return !!this.env.TYPESAFE_API_KEY && String(this.env.JEV_ENABLED) !== "false";
  }

  #assessSoon(delay: number) {
    if (!this.#jevOn()) return;
    clearTimeout(this.#assessTimer);
    this.#assessTimer = setTimeout(() => void this.#assess(), delay);
  }

  async #assess() {
    if (this.#assessing) {
      this.#assessAgain = true;
      return;
    }
    this.#assessing = true;
    try {
      await this.#tail;
      const view = this.#view();
      const open = view.questions
        .filter((q) => !q.answer)
        .map((q) => q.question)
        .filter(isAssessable);
      const transcript = view.utterances.slice(-ASSESS_UTTERANCES);
      const last = transcript.at(-1);
      if (!open.length || !last) return;
      // Nothing new said, and no new question, since the last run.
      const previous = view.lastAssessment;
      if (
        previous?.seenUpTo === last.id &&
        open.every((q) => q.id in previous.questions)
      ) {
        return;
      }

      const response = await askJev(
        this.env.TYPESAFE_API_KEY,
        assessmentRequest(this.env.JEV_MODEL, open, transcript)
      );
      this.#addUsage({
        jevCalls: 1,
        jevInputTokens: response.usage.input_tokens
      });
      const judged = readAssessment(open, response);
      const assessment: Assessment = {
        model: response.model,
        seenUpTo: last.id,
        onScreen: view.onScreen,
        questions: Object.fromEntries(
          Object.entries(judged).map(([id, judgment]) => [
            id,
            {
              ...judgment,
              heardOnScreen: transcript
                .filter((u) => u.onScreen === id)
                .map((u) => u.id)
            }
          ])
        )
      };
      await this.#append({
        id: newId("assessment"),
        role: "system",
        metadata: { kind: "assessment", subjectId: "jev", at: Date.now() },
        parts: [{ type: "data-assessment", data: assessment }]
      });
    } catch (error) {
      console.error("Jev assessment failed", error);
    } finally {
      this.#assessing = false;
      if (this.#assessAgain) {
        this.#assessAgain = false;
        this.#assessSoon(0);
      }
    }
  }

  // --- Jev, while someone's speaking ---
  //
  // As the transcriber's interim text grows, Jev judges the question on
  // screen against it. One preview is in flight at a time, and the next
  // takes the latest text, so previews follow speech as fast as Jev answers.
  // They're sent to clients but not logged: they move the bars, and fill
  // nothing in, until the utterance arrives and a full run confirms them.

  /** The latest interim text that no preview has seen yet. */
  #interim?: string;
  #previewing = false;

  #previewSoon(text: string) {
    if (!this.#jevOn()) return;
    this.#interim = text;
    if (!this.#previewing) void this.#previewLatest();
  }

  async #previewLatest() {
    this.#previewing = true;
    try {
      while (this.#interim !== undefined) {
        const text = this.#interim;
        this.#interim = undefined;
        await this.#preview(text);
      }
    } finally {
      this.#previewing = false;
    }
  }

  async #preview(text: string) {
    try {
      await this.#tail;
      const view = this.#view();
      if (view.status !== "recording") return;
      const question = view.questions.find(
        (q) => q.question.id === view.onScreen && !q.answer
      )?.question;
      if (!question || !isAssessable(question)) return;
      const said = view.utterances.slice(-PREVIEW_UTTERANCES);
      const after = said.at(-1)?.id ?? null;
      const response = await askJev(
        this.env.TYPESAFE_API_KEY,
        assessmentRequest(this.env.JEV_MODEL, [question], [
          ...said,
          { id: "interim", text, onScreen: question.id }
        ])
      );
      this.#addUsage({
        jevCalls: 1,
        jevInputTokens: response.usage.input_tokens
      });
      // An utterance that arrived meanwhile has a full run of its own coming.
      if ((this.#view().utterances.at(-1)?.id ?? null) !== after) return;
      const judged = readAssessment([question], response)[question.id];
      if (!judged) return;
      const preview: Preview = {
        questionId: question.id,
        after,
        likelihood: likelihoodOf(judged)
      };
      this.broadcast(JSON.stringify({ type: "jev-preview", preview }));
    } catch (error) {
      console.error("Jev preview failed", error);
    }
  }

  // --- Session controls (called from the client) ---

  /**
   * A page opened the session: the plan starts, which puts up the consent
   * card. Opening it again releases nothing new. `plan` is one compiled on
   * /platform-admin; it's taken only before the first question.
   */
  @callable()
  async open(plan?: unknown) {
    await this.#tail;
    if (plan !== undefined && !this.#view().questions.length) {
      const checked = checkPlan(plan);
      if (checked.plan && !checked.messages.some((m) => m.severity === "error")) {
        await this.ctx.storage.put("plan", checked.plan);
        this.#plan = checked.plan;
      }
    }
    await this.#releasePlan({ kind: "start" });
  }

  /** Recording starts only once the consent card allows it. */
  @callable()
  async begin() {
    const { status, consented } = this.#view();
    if (status !== "idle" || !consented) return;
    await this.#appendStatus("recording");
  }

  @callable()
  async setPaused(paused: boolean) {
    const { status, consented } = this.#view();
    if (status !== "recording" && status !== "paused") return;
    if (!paused && !consented) return;
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
    if (entry.question.final && entry.answer && !entry.answer.skipped) return;
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
    await this.#releasePlan({ kind: "answer" });
  }

  /**
   * A device put this question on screen. What's said from now on is heard
   * as an answer to it, which counts for more with Jev.
   */
  @callable()
  async show(questionId: string) {
    const view = this.#view();
    if (view.onScreen === questionId) return;
    if (!view.questions.some((q) => q.question.id === questionId)) return;
    await this.#append({
      id: newId("shown"),
      role: "system",
      metadata: { kind: "shown", subjectId: questionId, at: Date.now() },
      parts: [{ type: "data-shown", data: { questionId } }]
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

  // --- Agent questions ---

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
      model: this.env.AGENT_MODEL,
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

/**
 * /platform-admin's Compile button: compiles a playbook the way
 * `pnpm compile-playbook` does, and answers with what compilePlaybook() gave.
 */
async function compileForAdmin(request: Request, env: Env) {
  const { markdown } = await request.json<{ markdown: string }>();
  const started = Date.now();
  try {
    const compiled = await compilePlaybook(markdown, {
      name: "platform-admin",
      prompts: { system: compileSystem, retry: compileRetry },
      generate: (r) =>
        generateJson(env, {
          ...r,
          model: env.COMPILE_MODEL,
          thinkingLevel: env.COMPILE_THINKING
        })
    });
    return Response.json({ ...compiled, ms: Date.now() - started });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export default withBasicAuth({
  async fetch(request: Request, env: Env) {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/api/compile-playbook") {
      return compileForAdmin(request, env);
    }
    return (await routeAgentRequest(request, env)) || env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>);
