import "./styles.css";
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useVoiceInput } from "agents/voice/react";
import { PlatformAdmin } from "./platform-admin/page";
import { activePlanArgs } from "./platform-admin/plan-storage";
import { Button, Surface, Text } from "@cloudflare/kumo";
import {
  BugIcon,
  CheckCircleIcon,
  FlagCheckeredIcon,
  InfoIcon,
  MicrophoneIcon,
  PauseIcon,
  PlayIcon,
  TextAlignLeftIcon
} from "@phosphor-icons/react";
import {
  EMPTY_USAGE,
  foldLog,
  isCurrent,
  type AnswerValue,
  type LogMessage,
  type Preview,
  type Usage
} from "../shared";
import { formatClock } from "./format";
import { ModeToggle } from "./components/ModeToggle";
import { ConnectionIndicator, type ConnectionStatus } from "./components/ConnectionIndicator";
import { Drawer } from "./components/Drawer";
import { QuestionStage } from "./components/QuestionStage";
import { Summary } from "./components/Summary";
import { DebugLog } from "./components/DebugLog";
import { CostEstimate } from "./components/CostEstimate";

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

// --- App ---

function App() {
  const sessionId = useMemo(getSessionId, []);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [preview, setPreview] = useState<Preview | null>(null);
  /** Questions the server is writing a draft for now. */
  const [drafting, setDrafting] = useState<string[]>([]);

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
        if (message?.type === "drafting") setDrafting(message.questionIds);
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

  // What's being said now counts for the question on screen when it was
  // started, as the server files it, even if they've moved on since.
  const speaking = !!voice.interimTranscript;
  const [interimFor, setInterimFor] = useState<string | null | undefined>();
  if (speaking && interimFor === undefined) setInterimFor(view.onScreen);
  if (!speaking && interimFor !== undefined) setInterimFor(undefined);
  const interimOn = interimFor !== undefined ? interimFor : view.onScreen;

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

  // Once someone changes a text question's text it's theirs: the server
  // stops drafting it. Told once per question.
  const takenOver = useRef(new Set<string>());
  const takeOver = useCallback(
    (questionId: string) => {
      if (takenOver.current.has(questionId)) return;
      takenOver.current.add(questionId);
      agent.call("takeOver", [questionId]).catch(() => {});
    },
    [agent]
  );

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
              dembrane-theme
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
              view.status === "recording" && speaking && interimOn === current
                ? (voice.interimTranscript ?? undefined)
                : undefined
            }
            drafting={!!current && drafting.includes(current)}
            onBack={() => goTo(activeIndex - 1)}
            onNext={() => goTo(activeIndex + 1)}
            onAnswer={answer}
            onEdited={setEdited}
            onTakeOver={takeOver}
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
        {/* A session from before a tally existed lacks it, so it starts at 0. */}
        {agent.state && <CostEstimate usage={{ ...EMPTY_USAGE, ...agent.state }} />}
        <DebugLog messages={messages} />
      </Drawer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  location.pathname === "/platform-admin" ? <PlatformAdmin /> : <App />
);
