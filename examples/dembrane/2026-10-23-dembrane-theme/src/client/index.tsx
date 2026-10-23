// styles.css first: its @layer order has to come before Mantine's layer.
import "./styles.css";
import "@mantine/core/styles.layer.css";
import { createRoot } from "react-dom/client";
import { ActionIcon, Button, MantineProvider, Paper, Text } from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useVoiceInput } from "agents/voice/react";
import { PlatformAdmin } from "./platform-admin/page";
import { activePlanArgs } from "./platform-admin/plan-storage";
import {
  BugIcon,
  CheckCircleIcon,
  CheckIcon,
  MicrophoneIcon,
  PauseIcon,
  PlayIcon
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
import { cssVariablesResolver, theme } from "./theme/theme";
import logo from "./assets/dembrane-logo-new.svg";
import { ConnectionIndicator, type ConnectionStatus } from "./components/ConnectionIndicator";
import { Drawer } from "./components/Drawer";
import { ConsentForm } from "./components/ConsentForm";
import { LiveDot, RecordingSheet, type Snap } from "./components/RecordingSheet";
import { useLevels, Waveform } from "./components/Waveform";
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
  const all = useMemo(
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
  // The consent card lives in the recording sheet; the stage shows the rest.
  const consent = all.find((q) => q.question.consent);
  const questions = useMemo(
    () => all.filter((q) => !q.question.consent),
    [all]
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

  const agree = async (value: AnswerValue) => {
    if (consent) await agent.call("answer", [consent.question.id, value, false]);
  };

  const finished = view.status === "finished";
  const canFinish = view.status === "paused" && !voice.isListening;

  // The recording sheet opens on arrival. Once listening, it stays open a
  // moment so they see it took, then tucks away; trouble opens it again.
  const [snap, setSnap] = useState<Snap>("open");
  useEffect(() => {
    if (!voice.isListening) return;
    const id = setTimeout(() => setSnap("tucked"), 1800);
    return () => clearTimeout(id);
  }, [voice.isListening]);
  useEffect(() => {
    if (voice.error) setSnap("open");
  }, [voice.error]);
  // The meter's samples, shared by its large and small forms. A microphone
  // gone flat is trouble too.
  const { levels, silent } = useLevels(voice.audioLevel, voice.isListening, () =>
    setSnap("open")
  );
  // Time listened on this page, across pauses.
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!voice.isListening) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [voice.isListening]);

  const sheetTitle = voice.error
    ? "We can't hear you."
    : silent
      ? "We haven't heard anything for a while."
      : voice.isListening
        ? "Listening"
        : view.status === "paused"
          ? "Paused"
          : "Ready when you are";

  // Drawers.
  const [drawer, setDrawer] = useState<"debug" | null>(null);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "end" });
  }, [view.utterances.length, voice.interimTranscript]);

  return (
    <div className="min-h-dvh bg-app-bg flex flex-col">
      {/* h-14 and above the sheet: the sheet tucks in under it. */}
      <header className="sticky top-0 z-20 h-14 bg-app-bg border-b border-app-quiet px-4 flex items-center justify-between gap-2">
        <img src={logo} alt="dembrane" className="h-9" />
        <div className="flex items-center gap-1">
          <ConnectionIndicator status={connection} />
          <ActionIcon
            onClick={() => setDrawer("debug")}
            aria-label="Open message log"
          >
            <BugIcon size={16} />
          </ActionIcon>
        </div>
      </header>

      {/* pt-20 clears the tucked sheet's strip and grab band. */}
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 pt-20 pb-4 flex flex-col gap-4">
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
          <Paper className="p-8 flex flex-col items-center text-center gap-2">
            <CheckCircleIcon size={28} className="text-app-muted" />
            <Text size="sm">
              {view.status === "idle" ? "Ready when you are" : "Keep talking"}
            </Text>
            <Text size="xs" c="dimmed">
              Questions will appear here as they come up.
            </Text>
          </Paper>
        )}

      </main>

      {!finished && (
        <RecordingSheet
          snap={snap}
          onSnapChange={setSnap}
          strip={
            <>
              <span className="flex items-center gap-2 tabular-nums">
                <LiveDot live={voice.isListening} />
                {formatClock(seconds)}
              </span>
              {snap === "tucked" ? (
                <Waveform
                  levels={levels}
                  silent={silent}
                  size="sm"
                  className="flex-1 min-w-0"
                />
              ) : (
                <span className="flex-1" />
              )}
              {view.status === "idle" ? (
                <Button
                  variant="filled"
                  onClick={begin}
                  disabled={busy || connection !== "connected" || !view.consented}
                  leftSection={<MicrophoneIcon size={16} />}
                >
                  Start
                </Button>
              ) : voice.isListening ? (
                <Button
                  onClick={pause}
                  disabled={busy}
                  leftSection={<PauseIcon size={16} />}
                >
                  Pause
                </Button>
              ) : (
                <Button
                  variant="filled"
                  onClick={resume}
                  disabled={busy || connection !== "connected" || !view.consented}
                  leftSection={<PlayIcon size={16} />}
                >
                  Resume
                </Button>
              )}
              {/* Only once there's audio, and usable only while paused. */}
              {view.status !== "idle" && (
                <Button
                  onClick={finish}
                  disabled={busy || !canFinish}
                  title={canFinish ? undefined : "Pause recording to finish"}
                  leftSection={<CheckIcon size={16} />}
                >
                  Finish
                </Button>
              )}
            </>
          }
        >
          {/* Consent first; once given, the transcript takes its place. */}
          {!view.consented && consent ? (
            <ConsentForm
              key={consent.question.id}
              entry={consent}
              disabled={connection !== "connected"}
              onAgree={agree}
            />
          ) : (
            <>
              <p className="m-0 text-lg">{sheetTitle}</p>
              {(voice.error || silent) && (
                <Text c={voice.error ? "red" : "dimmed"}>
                  {voice.error ??
                    "Is the microphone muted, or is another one selected?"}
                </Text>
              )}
              <div className="flex-1 min-h-0 overflow-y-auto mt-4 pb-2">
                {view.utterances.length === 0 && !voice.interimTranscript ? (
                  <Text size="sm" c="dimmed">
                    What you say shows up here.
                  </Text>
                ) : (
                  <ol className="m-0 p-0 list-none flex flex-col gap-3">
                    {view.utterances.map((u) => (
                      <li key={u.id} className="flex gap-3">
                        <span className="text-xs tabular-nums text-app-muted w-10 shrink-0 pt-0.5">
                          {view.startedAt
                            ? formatClock((u.at - view.startedAt) / 1000)
                            : ""}
                        </span>
                        <span className="text-sm text-app-text">{u.text}</span>
                      </li>
                    ))}
                    {voice.interimTranscript && (
                      <li className="flex gap-3">
                        <span className="w-10 shrink-0" />
                        <span className="text-sm text-app-muted italic">
                          {voice.interimTranscript}
                        </span>
                      </li>
                    )}
                  </ol>
                )}
                <div ref={transcriptEnd} />
              </div>
              {/* Open, the meter is large and sits just above the controls. */}
              <div className="pt-4 shrink-0">
                <Waveform levels={levels} silent={silent} />
              </div>
            </>
          )}
        </RecordingSheet>
      )}

      <Drawer
        open={drawer === "debug"}
        onClose={closeDrawer}
        title={`Message log · ${messages.length}`}
      >
        <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-app-quiet">
          <span className="text-xs text-app-muted mr-auto">
            Simulate interaction
          </span>
          <Button
            size="xs"
            onClick={() => agent.call("pushHostQuestion")}
            disabled={finished || view.status === "idle"}
          >
            From host
          </Button>
          <Button
            size="xs"
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
  <MantineProvider
    theme={theme}
    cssVariablesResolver={cssVariablesResolver}
    forceColorScheme="light"
  >
    {location.pathname === "/platform-admin" ? <PlatformAdmin /> : <App />}
  </MantineProvider>
);
