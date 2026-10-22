import "./styles.css";
import { createRoot } from "react-dom/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useVoiceInput } from "agents/voice/react";
import { CardInput } from "./cards/registry";
import { PlatformAdmin } from "./platform-admin/page";
import { activePlanArgs } from "./platform-admin/plan-storage";
import {
  Badge,
  Button,
  Surface,
  Text
} from "@cloudflare/kumo";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BugIcon,
  CheckIcon,
  CheckCircleIcon,
  FlagCheckeredIcon,
  InfoIcon,
  MicrophoneIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  SunIcon,
  TextAlignLeftIcon,
  WarningIcon,
  XIcon
} from "@phosphor-icons/react";
import {
  AUDIO_TOKENS_PER_SECOND,
  CHARS_PER_TOKEN,
  costOf,
  foldLog,
  formatAnswer,
  isCurrent,
  priceChangesAfter,
  rateOn,
  sameAnswer,
  type AnswerValue,
  type LogMessage,
  type Preview,
  type Question,
  type QuestionView,
  type Usage
} from "./shared";

// --- Session id (one Durable Object per conversation) ---

function getSessionId() {
  const url = new URL(window.location.href);
  let id = url.searchParams.get("session");
  if (!id) {
    id = crypto.randomUUID().slice(0, 8);
    url.searchParams.set("session", id);
    window.history.replaceState(null, "", url);
  }
  return id;
}

// --- Small shared components ---

function ModeToggle() {
  const [mode, setMode] = useState(
    () => localStorage.getItem("theme") || "light"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [mode]);

  return (
    <Button
      variant="ghost"
      shape="square"
      aria-label="Toggle theme"
      onClick={() => setMode((m) => (m === "light" ? "dark" : "light"))}
      icon={mode === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
    />
  );
}

type ConnectionStatus = "connecting" | "connected" | "disconnected";

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const dot =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";
  const label =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting..."
        : "Disconnected";
  return (
    <output className="flex items-center gap-2" aria-label={label}>
      <span className={`size-2 rounded-full ${dot}`} />
      <span className="hidden sm:inline text-xs text-kumo-subtle">{label}</span>
    </output>
  );
}

/** Bottom sheet on phones, side panel from `md` up. */
function Drawer({
  open,
  onClose,
  title,
  children
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-40 ${open ? "" : "pointer-events-none"}`}
      inert={!open}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        aria-label={title}
        className={`absolute inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl md:inset-y-0 md:left-auto md:right-0 md:w-[28rem] md:max-h-none md:rounded-none bg-kumo-base ring ring-kumo-line flex flex-col transition-transform duration-200 ${
          open
            ? "translate-y-0 md:translate-x-0"
            : "translate-y-full md:translate-y-0 md:translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-kumo-line">
          <Text size="sm" bold>
            {title}
          </Text>
          <Button
            variant="ghost"
            shape="square"
            aria-label="Close"
            onClick={onClose}
            icon={<XIcon size={16} />}
          />
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>
  );
}

function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// --- Question input widgets ---

function defaultValue(question: Question): AnswerValue {
  if (question.type === "checkbox") return [];
  if (question.type === "number") return null;
  return "";
}

function isAnswerable(question: Question, value: AnswerValue) {
  switch (question.type) {
    case "radio":
      return typeof value === "string" && value.length > 0;
    case "checkbox":
      // Ticking none is an answer, unless the question needs at least one.
      return Array.isArray(value) && (!question.required || value.length > 0);
    case "text":
      return typeof value === "string" && value.trim().length > 0;
    case "number":
      return (
        typeof value === "number" &&
        !Number.isNaN(value) &&
        (question.min === undefined || value >= question.min) &&
        (question.max === undefined || value <= question.max)
      );
  }
}

const SOURCE_LABEL: Record<Question["source"], string> = {
  plan: "Setup",
  host: "From host",
  agent: "From agent"
};

function AnswerStatusBadge({ entry }: { entry: QuestionView }) {
  const { answer, question } = entry;
  if (!answer) return null;
  if (answer.skipped) {
    return question.required ? (
      <Badge variant="warning">Required · skipped</Badge>
    ) : (
      <Badge variant="secondary">Skipped</Badge>
    );
  }
  return (
    <Badge variant="success">
      {entry.answerCount > 1
        ? `Answered · rev ${entry.answerCount}`
        : "Answered"}
    </Badge>
  );
}

// --- The active question, one at a time ---

function QuestionStage({
  questions,
  activeIndex,
  pendingAhead,
  disabled,
  interim,
  onBack,
  onNext,
  onAnswer,
  onEdited
}: {
  questions: QuestionView[];
  activeIndex: number;
  pendingAhead: number;
  disabled: boolean;
  /**
   * What's being said now, before the transcriber makes it final. Empty
   * while listening to silence, so the field keeps room for it.
   */
  interim?: string;
  onBack: () => void;
  onNext: () => void;
  onAnswer: (value: AnswerValue, skipped: boolean) => Promise<void>;
  /** Whether there's an unsaved edit, whenever that changes. */
  onEdited: (edited: boolean) => void;
}) {
  const entry = questions[activeIndex];
  const question = entry.question;
  const [drafts, setDrafts] = useState<Record<string, AnswerValue>>({});
  const [saving, setSaving] = useState(false);

  // Until the person touches the card, an unanswered question shows the
  // options Jev thinks were said. It's only a draft: they still submit it.
  const filled =
    !(question.id in drafts) && !entry.answer && entry.suggested !== undefined;
  const value =
    question.id in drafts
      ? drafts[question.id]
      : entry.answer && !entry.answer.skipped
        ? entry.answer.value
        : (entry.suggested ?? defaultValue(question));

  // While dictation fills an untouched text question, what's being said now
  // shows greyed after the draft, until it's final and joins it.
  const dictating =
    question.type === "text" &&
    question.dictate !== false &&
    !entry.answer &&
    !(question.id in drafts);

  // A final question's answer stands once given.
  const locked =
    !!question.final && !!entry.answer && !entry.answer.skipped;

  const submit = async (skipped: boolean) => {
    setSaving(true);
    try {
      await onAnswer(skipped ? null : value, skipped);
    } finally {
      setSaving(false);
    }
  };

  const hasNext = activeIndex < questions.length - 1;
  const stackDepth = Math.min(pendingAhead, 2);
  const saved =
    entry.answer && !entry.answer.skipped
      ? entry.answer.value
      : defaultValue(question);
  const edited =
    question.id in drafts &&
    !sameAnswer({ value: saved, skipped: false }, { value, skipped: false });
  useEffect(() => onEdited(edited), [edited, onEdited]);
  // Skip records a skip on an unanswered question, and drops an unsaved edit
  // on an answered one. Otherwise it's just Next. Consent can't be skipped:
  // its only answer is the tick.
  const skips = !question.consent && (!entry.answer || edited);
  const skip = () => {
    if (!entry.answer) return submit(true);
    if (hasNext) return onNext();
    setDrafts(({ [question.id]: _, ...rest }) => rest);
  };

  return (
    <div className="relative">
      {/* Unseen questions stack up behind the active card */}
      {Array.from({ length: stackDepth }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className="absolute inset-x-0 top-0 h-full rounded-xl ring ring-kumo-line bg-kumo-elevated"
          style={{
            transform: `translateY(${(i + 1) * 8}px) scale(${1 - (i + 1) * 0.03})`,
            zIndex: -1 - i,
            opacity: 1 - (i + 1) * 0.3
          }}
        />
      ))}

      <Surface className="relative rounded-xl ring ring-kumo-line p-4 sm:p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-kumo-subtle tabular-nums">
            Question {activeIndex + 1} of {questions.length}
          </span>
          <Badge variant={question.required ? "primary" : "outline"}>
            {question.required ? "Required" : "Optional"}
          </Badge>
          <Badge variant="outline">{SOURCE_LABEL[question.source]}</Badge>
          <AnswerStatusBadge entry={entry} />
          {filled && <Badge variant="info">Filled in from what was said</Badge>}
          {locked && <Badge variant="outline">Can't be changed</Badge>}
        </div>

        <p className="text-lg sm:text-xl font-semibold text-kumo-strong leading-snug">
          {question.prompt}
        </p>

        <CardInput
          question={question}
          value={value}
          likelihood={entry.answer ? undefined : entry.likelihood}
          interim={dictating ? interim : undefined}
          readOnly={locked}
          onChange={(v) => setDrafts((d) => ({ ...d, [question.id]: v }))}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-kumo-line">
          <Button
            variant="ghost"
            onClick={onBack}
            disabled={activeIndex === 0}
            icon={<ArrowLeftIcon size={16} />}
          >
            Back
          </Button>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="primary"
              onClick={() => submit(false)}
              disabled={
                disabled ||
                saving ||
                locked ||
                !isAnswerable(question, value) ||
                sameAnswer(entry.answer, { value, skipped: false })
              }
              icon={<CheckIcon size={16} />}
            >
              {entry.answer && !entry.answer.skipped ? "Update" : "Submit"}
            </Button>
            <Button
              variant="secondary"
              onClick={skips ? skip : onNext}
              disabled={skips ? disabled || saving : !hasNext}
              aria-label={
                (skips ? "Skip" : "Next") +
                (pendingAhead > 0 ? `, ${pendingAhead} new` : "")
              }
            >
              <span className="relative flex items-center gap-1.5">
                {skips ? "Skip" : "Next"}
                <ArrowRightIcon size={16} />
                {pendingAhead > 0 && (
                  <span className="absolute -top-3.5 -right-4 min-w-5 h-5 px-1 rounded-full bg-kumo-danger text-white text-[11px] font-semibold flex items-center justify-center animate-pulse">
                    {pendingAhead}
                  </span>
                )}
              </span>
            </Button>
          </div>
        </div>
      </Surface>
    </div>
  );
}

function Summary({ questions }: { questions: QuestionView[] }) {
  const missing = questions.filter(
    (q) => q.question.required && (!q.answer || q.answer.skipped)
  );
  return (
    <Surface className="rounded-xl ring ring-kumo-line p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <FlagCheckeredIcon size={20} className="text-kumo-brand" />
        <Text size="base" bold>
          Session finished
        </Text>
      </div>
      {missing.length > 0 && (
        <div className="flex gap-2 rounded-lg p-3 bg-kumo-warning-tint">
          <WarningIcon
            size={16}
            className="text-kumo-warning shrink-0 mt-0.5"
          />
          <Text size="xs">
            {missing.length} required question
            {missing.length === 1 ? " was" : "s were"} skipped or left
            unanswered.
          </Text>
        </div>
      )}
      <ol className="flex flex-col divide-y divide-kumo-line">
        {questions.map((entry, i) => (
          <li
            key={entry.question.id}
            className="grid grid-cols-[1.5rem_1fr] gap-x-2 py-3 first:pt-0 last:pb-0"
          >
            <span className="text-sm text-kumo-subtle tabular-nums">
              {i + 1}.
            </span>
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="text-sm font-medium text-kumo-default">
                {entry.question.prompt}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`text-sm ${entry.answer && !entry.answer.skipped ? "text-kumo-default" : "text-kumo-subtle italic"}`}
                >
                  {formatAnswer(entry.answer)}
                </span>
                <AnswerStatusBadge entry={entry} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Surface>
  );
}

// --- Debug view of the raw log ---

function DebugLog({ messages }: { messages: LogMessage[] }) {
  const seen = new Map<string, number>();
  return (
    <ol className="flex flex-col gap-2 font-mono text-[11px]">
      {messages.map((message, i) => {
        const meta = message.metadata;
        const kind = meta?.kind ?? `${message.role} turn`;
        const count = meta
          ? (seen.get(`${kind}:${meta.subjectId}`) ?? 0) + 1
          : 1;
        if (meta) seen.set(`${kind}:${meta.subjectId}`, count);
        return (
          <li key={message.id} className="rounded-lg ring ring-kumo-line">
            <details>
              <summary className="cursor-pointer px-2 py-1.5 flex items-center gap-2 flex-wrap">
                <span className="text-kumo-subtle tabular-nums">#{i}</span>
                <Badge variant={meta ? "secondary" : "info"}>{kind}</Badge>
                <span className="text-kumo-subtle">{message.role}</span>
                {meta && (
                  <span className="text-kumo-default truncate max-w-[12rem]">
                    {meta.subjectId}
                  </span>
                )}
                {count > 1 && <Badge variant="warning">revision {count}</Badge>}
              </summary>
              <pre className="px-2 pb-2 overflow-x-auto whitespace-pre-wrap break-all text-kumo-default">
                {JSON.stringify(message, null, 2)}
              </pre>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

// --- Cost estimate ---

function formatUsd(usd: number | undefined) {
  if (usd === undefined) return "—";
  return usd > 0 && usd < 0.0001 ? "<$0.0001" : `$${usd.toFixed(4)}`;
}

/**
 * What the session has cost so far, at today's prices and at each announced
 * change after today.
 */
function CostEstimate({ usage }: { usage: Usage }) {
  const today = new Date().toISOString().slice(0, 10);
  const dates = [
    today,
    ...priceChangesAfter(today, [
      usage.sttModel,
      usage.agentModel,
      usage.jevModel
    ])
  ];
  const audioTokens = usage.audioSeconds * AUDIO_TOKENS_PER_SECOND;
  const transcriptTokens = usage.transcriptChars / CHARS_PER_TOKEN;
  const rows = [
    {
      label: "Transcription",
      detail: `${formatClock(usage.audioSeconds)} of audio`,
      costs: dates.map((d) =>
        costOf(rateOn(usage.sttModel, d), audioTokens, transcriptTokens)
      )
    },
    {
      label: "Agent",
      detail: `${usage.agentCalls} calls · ${usage.agentInputTokens.toLocaleString()} in / ${usage.agentOutputTokens.toLocaleString()} out`,
      costs: dates.map((d) =>
        costOf(
          rateOn(usage.agentModel, d),
          usage.agentInputTokens,
          usage.agentOutputTokens
        )
      )
    },
    {
      label: "Jev",
      detail: `${usage.jevCalls} calls · ${usage.jevInputTokens.toLocaleString()} in`,
      costs: dates.map((d) =>
        usage.jevCalls
          ? costOf(rateOn(usage.jevModel, d), usage.jevInputTokens, 0)
          : 0
      )
    }
  ];
  const totals = dates.map((_, i) =>
    rows.some((r) => r.costs[i] === undefined)
      ? undefined
      : rows.reduce((sum, r) => sum + (r.costs[i] ?? 0), 0)
  );

  return (
    <section className="pb-3 mb-3 border-b border-kumo-line">
      <table className="w-full text-xs tabular-nums">
        <thead className="text-kumo-subtle">
          <tr>
            <th className="text-left font-normal">Cost estimate</th>
            {dates.map((d, i) => (
              <th key={d} className="text-right font-normal pl-3">
                {i === 0 ? "Now" : `From ${d}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-kumo-default">
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="py-1">
                {row.label}
                <div className="text-[11px] text-kumo-subtle">{row.detail}</div>
              </td>
              {row.costs.map((cost, i) => (
                <td key={dates[i]} className="text-right pl-3 align-top py-1">
                  {formatUsd(cost)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="pt-1">Total</td>
            {totals.map((cost, i) => (
              <td key={dates[i]} className="text-right pl-3 pt-1">
                {formatUsd(cost)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-kumo-subtle">
        From list prices; <code>pnpm update-prices</code> refreshes them.
        Transcription counts every second streamed, silence included.
      </p>
    </section>
  );
}

// --- App ---

function App() {
  const sessionId = useMemo(getSessionId, []);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [preview, setPreview] = useState<Preview | null>(null);

  const agent = useAgent<Usage>({
    agent: "ConversationAgent",
    name: sessionId,
    onOpen: useCallback(() => setConnection("connected"), []),
    onClose: useCallback(() => setConnection("disconnected"), []),
    onMessage: useCallback((event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data);
        if (message?.type === "jev-preview") setPreview(message.preview);
      } catch {
        // Not ours.
      }
    }, [])
  });
  const { messages: rawMessages } = useAgentChat({ agent });
  const messages = rawMessages as LogMessage[];
  const view = useMemo(() => foldLog(messages), [messages]);

  const voice = useVoiceInput({ agent: "ConversationAgent", name: sessionId });

  // Navigation: which question is on screen, and which ones have been seen.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  // A preview's likelihoods stand in for the logged ones until an
  // assessment sees past it. They only move the bars: what's filled in
  // still comes from the log.
  const questions = useMemo(
    () =>
      preview && isCurrent(view, preview)
        ? view.questions.map((q) =>
            q.question.id === preview.questionId
              ? { ...q, likelihood: preview.likelihood }
              : q
          )
        : view.questions,
    [view, preview]
  );
  const activeIndex = Math.max(
    0,
    questions.findIndex((q) => q.question.id === activeId)
  );
  const current = questions[activeIndex]?.question.id;

  useEffect(() => {
    if (activeId === null && questions.length > 0) {
      setActiveId(questions[0].question.id);
    }
  }, [activeId, questions]);

  useEffect(() => {
    if (current && !seen.has(current)) {
      setSeen((s) => new Set(s).add(current));
    }
  }, [current, seen]);

  // Opening the session puts up the consent card. Recording waits for it.
  useEffect(() => {
    if (connection === "connected") {
      agent.call("open", activePlanArgs()).catch(() => {});
    }
  }, [agent, connection]);

  // What's said while a question is on screen is heard as an answer to it.
  useEffect(() => {
    if (current && connection === "connected") {
      agent.call("show", [current]).catch(() => {});
    }
  }, [agent, current, connection]);

  const pendingAhead = questions
    .slice(activeIndex + 1)
    .filter((q) => !seen.has(q.question.id)).length;

  // Set once the last question is answered: the next one to arrive is shown
  // as soon as it does, unless there's an unsaved edit on screen, which holds
  // it until the edit is saved or dropped. Moving anywhere else clears it.
  const [waitingAtEnd, setWaitingAtEnd] = useState(false);
  const [edited, setEdited] = useState(false);

  const goTo = (index: number) => {
    const target = questions[index];
    if (target) setActiveId(target.question.id);
    setWaitingAtEnd(false);
  };

  useEffect(() => {
    const next = questions[activeIndex + 1];
    if (waitingAtEnd && next && !edited) {
      setActiveId(next.question.id);
      setWaitingAtEnd(false);
    }
  }, [waitingAtEnd, edited, questions, activeIndex]);

  const answer = async (value: AnswerValue, skipped: boolean) => {
    if (!current) return;
    await agent.call("answer", [current, value, skipped]);
    // A question that arrived meanwhile is picked up by the effect above.
    if (activeIndex < questions.length - 1) goTo(activeIndex + 1);
    else setWaitingAtEnd(true);
  };

  // Recording controls.
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const begin = () =>
    run(async () => {
      await agent.call("begin");
      await voice.start();
    });
  const pause = () =>
    run(async () => {
      voice.stop();
      await agent.call("setPaused", [true]);
    });
  const resume = () =>
    run(async () => {
      await agent.call("setPaused", [false]);
      await voice.start();
    });
  const finish = () => run(() => agent.call("finish"));

  const finished = view.status === "finished";
  const canFinish = view.status === "paused" && !voice.isListening;

  // Drawers.
  const [drawer, setDrawer] = useState<"transcript" | "debug" | null>(null);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (drawer === "transcript") {
      transcriptEnd.current?.scrollIntoView({ block: "end" });
    }
  }, [drawer, view.utterances.length, voice.interimTranscript]);

  return (
    <div className="min-h-dvh bg-kumo-base flex flex-col">
      <header className="sticky top-0 z-30 bg-kumo-base border-b border-kumo-line px-4 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MicrophoneIcon
            size={20}
            weight="bold"
            className="text-kumo-brand shrink-0"
          />
          <span className="truncate">
            <Text size="sm" bold>
              participant-portal
            </Text>
          </span>
          <ConnectionIndicator status={connection} />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDrawer("transcript")}
            icon={<TextAlignLeftIcon size={16} />}
            aria-label="Open transcript"
          >
            <span className="hidden sm:inline">Transcript</span>
            <span className="tabular-nums text-kumo-subtle">
              {view.utterances.length}
            </span>
          </Button>
          <Button
            variant="ghost"
            shape="square"
            size="sm"
            onClick={() => setDrawer("debug")}
            icon={<BugIcon size={16} />}
            aria-label="Open message log"
          />
          <ModeToggle />
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-4 flex flex-col gap-4">
        <Surface className="p-4 rounded-xl ring ring-kumo-line">
          <div className="flex gap-3">
            <InfoIcon
              size={20}
              weight="bold"
              className="text-kumo-brand shrink-0 mt-0.5"
            />
            <div>
              <Text size="sm" bold>
                One conversation, one append-only log
              </Text>
              <span className="mt-1 block">
                <Text size="xs" variant="secondary">
                  Start talking, and answer the questions as they appear. Every
                  utterance, question, answer and status change is a new
                  UIMessage; changing an answer appends a revision. Open the bug
                  icon to see the raw log.
                </Text>
              </span>
            </div>
          </div>
        </Surface>


        {finished ? (
          <Summary questions={questions} />
        ) : questions.length > 0 ? (
          <QuestionStage
            key={current}
            questions={questions}
            activeIndex={activeIndex}
            pendingAhead={pendingAhead}
            disabled={connection !== "connected"}
            interim={
              view.status === "recording" && view.onScreen === current
                ? (voice.interimTranscript ?? "")
                : undefined
            }
            onBack={() => goTo(activeIndex - 1)}
            onNext={() => goTo(activeIndex + 1)}
            onAnswer={answer}
            onEdited={setEdited}
          />
        ) : (
          <Surface className="rounded-xl ring ring-dashed ring-kumo-line p-8 flex flex-col items-center text-center gap-2">
            <CheckCircleIcon size={28} className="text-kumo-subtle" />
            <Text size="sm" bold>
              {view.status === "idle" ? "Ready when you are" : "Keep talking"}
            </Text>
            <Text size="xs" variant="secondary">
              Questions will appear here as they come up.
            </Text>
          </Surface>
        )}

        {voice.error && (
          <Surface className="p-3 rounded-xl ring ring-kumo-danger bg-kumo-danger-tint">
            <Text size="xs">{voice.error}</Text>
          </Surface>
        )}
      </main>

      {/* Recording controls, pinned to the bottom for thumbs */}
      {!finished && (
        <div className="sticky bottom-0 z-30 bg-kumo-base border-t border-kumo-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <span className="text-xs text-kumo-subtle truncate">
                {voice.isListening
                  ? voice.interimTranscript || "Listening…"
                  : !view.consented
                    ? "Agree to recording to start"
                    : view.status === "idle"
                      ? "Not recording"
                      : "Paused"}
              </span>
              <div className="h-1.5 w-full rounded-full bg-kumo-tint overflow-hidden">
                <div
                  className="h-full rounded-full bg-kumo-brand transition-all duration-75"
                  style={{
                    width: `${voice.isListening ? Math.min(voice.audioLevel * 500, 100) : 0}%`
                  }}
                />
              </div>
            </div>
            {view.status === "idle" ? (
              <Button
                variant="primary"
                onClick={begin}
                disabled={busy || connection !== "connected" || !view.consented}
                icon={<MicrophoneIcon size={16} weight="bold" />}
              >
                Start
              </Button>
            ) : voice.isListening ? (
              <Button
                variant="secondary"
                onClick={pause}
                disabled={busy}
                icon={<PauseIcon size={16} weight="bold" />}
              >
                Pause
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={resume}
                disabled={busy || connection !== "connected" || !view.consented}
                icon={<PlayIcon size={16} weight="bold" />}
              >
                Resume
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={finish}
              disabled={busy || !canFinish}
              title={canFinish ? undefined : "Pause recording to finish"}
              icon={<FlagCheckeredIcon size={16} weight="bold" />}
            >
              Finish
            </Button>
          </div>
        </div>
      )}

      <Drawer
        open={drawer === "transcript"}
        onClose={closeDrawer}
        title="Transcript"
      >
        {view.utterances.length === 0 && !voice.interimTranscript ? (
          <Text size="xs" variant="secondary">
            Nothing transcribed yet.
          </Text>
        ) : (
          <ol className="flex flex-col gap-3">
            {view.utterances.map((u) => (
              <li key={u.id} className="flex gap-3">
                <span className="text-xs tabular-nums text-kumo-subtle w-10 shrink-0 pt-0.5">
                  {view.startedAt
                    ? formatClock((u.at - view.startedAt) / 1000)
                    : ""}
                </span>
                <span className="text-sm text-kumo-default leading-relaxed">
                  {u.text}
                </span>
              </li>
            ))}
            {voice.interimTranscript && (
              <li className="flex gap-3">
                <span className="w-10 shrink-0" />
                <span className="text-sm text-kumo-subtle italic">
                  {voice.interimTranscript}
                </span>
              </li>
            )}
          </ol>
        )}
        <div ref={transcriptEnd} />
      </Drawer>

      <Drawer
        open={drawer === "debug"}
        onClose={closeDrawer}
        title={`Message log · ${messages.length}`}
      >
        <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-kumo-line">
          <span className="text-xs text-kumo-subtle mr-auto">
            Simulate interaction
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => agent.call("pushHostQuestion")}
            disabled={finished || view.status === "idle"}
          >
            From host
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => agent.call("askAgentNow")}
            disabled={finished || view.status === "idle"}
          >
            From agent
          </Button>
        </div>
        {agent.state && <CostEstimate usage={agent.state} />}
        <DebugLog messages={messages} />
      </Drawer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  location.pathname === "/platform-admin" ? <PlatformAdmin /> : <App />
);
