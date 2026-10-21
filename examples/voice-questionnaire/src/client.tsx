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
import {
  Badge,
  Button,
  Input,
  InputArea,
  PoweredByCloudflare,
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
  AGENT_QUESTION_AT,
  SCHEDULE,
  foldLog,
  formatAnswer,
  sameAnswer,
  type AnswerValue,
  type LogMessage,
  type Question,
  type QuestionView
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

// --- Schedule timeline ---

function Timeline({ elapsed }: { elapsed: number }) {
  const marks = [...SCHEDULE.map((s) => s.at), AGENT_QUESTION_AT];
  const pct = Math.min(elapsed / AGENT_QUESTION_AT, 1) * 100;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs tabular-nums text-kumo-subtle w-20 shrink-0">
        {formatClock(elapsed)} / {formatClock(AGENT_QUESTION_AT)}
      </span>
      <div className="relative flex-1 h-1.5 rounded-full bg-kumo-tint">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-kumo-brand transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
        {marks.map((at, i) => (
          <span
            key={at}
            title={
              i === marks.length - 1 ? "Agent question" : `Question ${i + 1}`
            }
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-2.5 rounded-full ring-2 ring-kumo-base ${
              elapsed >= at ? "bg-kumo-brand" : "bg-kumo-line"
            } ${i === marks.length - 1 ? "size-3" : ""}`}
            style={{ left: `${(at / AGENT_QUESTION_AT) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
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
      return Array.isArray(value) && value.length > 0;
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

function QuestionInput({
  question,
  value,
  onChange
}: {
  question: Question;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
}) {
  const optionClass = (checked: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-3 ring cursor-pointer transition-colors ${
      checked
        ? "ring-kumo-brand bg-kumo-tint"
        : "ring-kumo-line hover:bg-kumo-tint"
    }`;

  if (question.type === "radio") {
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{question.prompt}</legend>
        {question.options?.map((option) => (
          <label key={option} className={optionClass(value === option)}>
            <input
              type="radio"
              name={question.id}
              className="accent-[var(--color-kumo-brand)] size-4"
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span className="text-sm text-kumo-default">{option}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  if (question.type === "checkbox") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{question.prompt}</legend>
        {question.options?.map((option) => {
          const checked = selected.includes(option);
          return (
            <label key={option} className={optionClass(checked)}>
              <input
                type="checkbox"
                className="accent-[var(--color-kumo-brand)] size-4"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? selected.filter((o) => o !== option)
                      : [...selected, option]
                  )
                }
              />
              <span className="text-sm text-kumo-default">{option}</span>
            </label>
          );
        })}
      </fieldset>
    );
  }

  if (question.type === "number") {
    return (
      <Input
        type="number"
        inputMode="numeric"
        aria-label={question.prompt}
        min={question.min}
        max={question.max}
        placeholder={
          question.min !== undefined && question.max !== undefined
            ? `${question.min}–${question.max}`
            : "Enter a number"
        }
        value={typeof value === "number" ? String(value) : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
      />
    );
  }

  return (
    <InputArea
      aria-label={question.prompt}
      placeholder="Type your answer"
      value={typeof value === "string" ? value : ""}
      onValueChange={(v) => onChange(v)}
    />
  );
}

const SOURCE_LABEL: Record<Question["source"], string> = {
  schedule: "Scheduled",
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
  onBack,
  onNext,
  onAnswer
}: {
  questions: QuestionView[];
  activeIndex: number;
  pendingAhead: number;
  disabled: boolean;
  onBack: () => void;
  onNext: () => void;
  onAnswer: (value: AnswerValue, skipped: boolean) => Promise<void>;
}) {
  const entry = questions[activeIndex];
  const question = entry.question;
  const [drafts, setDrafts] = useState<Record<string, AnswerValue>>({});
  const [saving, setSaving] = useState(false);

  const value =
    question.id in drafts
      ? drafts[question.id]
      : entry.answer && !entry.answer.skipped
        ? entry.answer.value
        : defaultValue(question);

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
  // Skip records a skip on an unanswered question, and drops an unsaved edit
  // on an answered one. Otherwise it's just Next.
  const skips = !entry.answer || edited;
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
        </div>

        <p className="text-lg sm:text-xl font-semibold text-kumo-strong leading-snug">
          {question.prompt}
        </p>

        <QuestionInput
          question={question}
          value={value}
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

// --- App ---

function App() {
  const sessionId = useMemo(getSessionId, []);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");

  const agent = useAgent({
    agent: "ConversationAgent",
    name: sessionId,
    onOpen: useCallback(() => setConnection("connected"), []),
    onClose: useCallback(() => setConnection("disconnected"), [])
  });
  const { messages: rawMessages } = useAgentChat({ agent });
  const messages = rawMessages as LogMessage[];
  const view = useMemo(() => foldLog(messages), [messages]);

  const voice = useVoiceInput({ agent: "ConversationAgent", name: sessionId });

  // Elapsed time on the server's schedule clock (wall time since start).
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (view.status === "idle" || view.status === "finished") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view.status]);
  const elapsed = view.startedAt ? (now - view.startedAt) / 1000 : 0;

  // Navigation: which question is on screen, and which ones have been seen.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const { questions } = view;
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

  const pendingAhead = questions
    .slice(activeIndex + 1)
    .filter((q) => !seen.has(q.question.id)).length;

  const goTo = (index: number) => {
    const target = questions[index];
    if (target) setActiveId(target.question.id);
  };

  const answer = async (value: AnswerValue, skipped: boolean) => {
    if (!current) return;
    await agent.call("answer", [current, value, skipped]);
    goTo(activeIndex + 1);
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
              Voice Questionnaire
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
                  Start talking. Four questions arrive on a schedule over two
                  minutes, then the agent asks one based on what you said. Every
                  utterance, question, answer and status change is a new
                  UIMessage; changing an answer appends a revision. Open the bug
                  icon to see the raw log.
                </Text>
              </span>
            </div>
          </div>
        </Surface>

        {view.status !== "idle" && !finished && <Timeline elapsed={elapsed} />}

        {finished ? (
          <Summary questions={questions} />
        ) : questions.length > 0 ? (
          <QuestionStage
            key={current}
            questions={questions}
            activeIndex={activeIndex}
            pendingAhead={pendingAhead}
            disabled={connection !== "connected"}
            onBack={() => goTo(activeIndex - 1)}
            onNext={() => goTo(activeIndex + 1)}
            onAnswer={answer}
          />
        ) : (
          <Surface className="rounded-xl ring ring-dashed ring-kumo-line p-8 flex flex-col items-center text-center gap-2">
            <CheckCircleIcon size={28} className="text-kumo-subtle" />
            <Text size="sm" bold>
              {view.status === "idle" ? "Ready when you are" : "Keep talking"}
            </Text>
            <Text size="xs" variant="secondary">
              {view.status === "idle"
                ? "Press Start to begin recording. Questions will appear here."
                : `The first question arrives at ${formatClock(SCHEDULE[0].at)}.`}
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
                disabled={busy || connection !== "connected"}
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
                disabled={busy || connection !== "connected"}
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

      <footer className="border-t border-kumo-line px-4 py-3 flex items-center justify-center">
        <PoweredByCloudflare href="https://developers.cloudflare.com/agents/" />
      </footer>

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
        <DebugLog messages={messages} />
      </Drawer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
