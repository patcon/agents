import { useEffect, useState } from "react";
import { CardInput } from "../cards/registry";
import { Badge, Button, Paper } from "@mantine/core";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon
} from "@phosphor-icons/react";
import {
  isOpen,
  sameAnswer,
  type AnswerValue,
  type Question,
  type QuestionView
} from "../../shared";
import { AnswerStatusBadge } from "./AnswerStatusBadge";

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

export function QuestionStage({
  questions,
  activeIndex,
  pendingAhead,
  disabled,
  interim,
  drafting,
  onBack,
  onNext,
  onAnswer,
  onEdited,
  onTakeOver
}: {
  questions: QuestionView[];
  activeIndex: number;
  pendingAhead: number;
  disabled: boolean;
  /** What's being said now, before the transcriber makes it final. */
  interim?: string;
  /** Whether the server is writing a draft for this question now. */
  drafting: boolean;
  onBack: () => void;
  onNext: () => void;
  onAnswer: (value: AnswerValue, skipped: boolean) => Promise<void>;
  /** Whether there's an unsaved edit, whenever that changes. */
  onEdited: (edited: boolean) => void;
  /** Someone changed a text question's text, so it's theirs now. */
  onTakeOver: (questionId: string) => void;
}) {
  const entry = questions[activeIndex];
  const question = entry.question;
  const [drafts, setDrafts] = useState<Record<string, AnswerValue>>({});
  const [saving, setSaving] = useState(false);

  // Until the person touches the card, an unanswered question shows the
  // options Jev thinks were said. It's only a draft: they still submit it.
  // A skipped question counts as unanswered.
  const open = isOpen(entry);
  const filled =
    !(question.id in drafts) && open && entry.suggested !== undefined;
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
    open &&
    !(question.id in drafts);

  // Submitting mid-sentence saves what's on screen, the greyed words too.
  const submitted =
    dictating && interim && typeof value === "string"
      ? (value ? `${value} ${interim}` : interim)
      : value;

  // A final question's answer stands once given.
  const locked =
    !!question.final && !!entry.answer && !entry.answer.skipped;

  const submit = async (skipped: boolean) => {
    setSaving(true);
    try {
      await onAnswer(skipped ? null : submitted, skipped);
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
  useEffect(() => {
    if (edited && question.type === "text") onTakeOver(question.id);
  }, [edited, question, onTakeOver]);
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
          className="absolute inset-x-0 top-0 h-full border border-app-quiet bg-app-surface"
          style={{
            transform: `translateY(${(i + 1) * 8}px) scale(${1 - (i + 1) * 0.03})`,
            zIndex: -1 - i,
            opacity: 1 - (i + 1) * 0.3
          }}
        />
      ))}

      <Paper className="relative p-4 sm:p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-app-muted tabular-nums">
            Question {activeIndex + 1} of {questions.length}
          </span>
          <Badge color={question.required ? "primary" : "gray"}>
            {question.required ? "Required" : "Optional"}
          </Badge>
          <Badge color="gray">{SOURCE_LABEL[question.source]}</Badge>
          <AnswerStatusBadge entry={entry} />
          {filled && <Badge color="primary">Filled in from what was said</Badge>}
          {dictating && drafting && <Badge color="gray">Drafting…</Badge>}
          {locked && <Badge color="gray">Can't be changed</Badge>}
        </div>

        <p className="text-base sm:text-lg text-app-text">
          {question.prompt}
        </p>

        <CardInput
          question={question}
          value={value}
          likelihood={open ? entry.likelihood : undefined}
          dictating={dictating}
          interim={dictating ? interim : undefined}
          readOnly={locked}
          onChange={(v) => setDrafts((d) => ({ ...d, [question.id]: v }))}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-app-quiet">
          <Button
            variant="subtle"
            onClick={onBack}
            disabled={activeIndex === 0}
            leftSection={<ArrowLeftIcon size={16} />}
          >
            Back
          </Button>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="filled"
              onClick={() => submit(false)}
              disabled={
                disabled ||
                saving ||
                locked ||
                !isAnswerable(question, submitted) ||
                sameAnswer(entry.answer, { value: submitted, skipped: false })
              }
              leftSection={<CheckIcon size={16} />}
            >
              {entry.answer && !entry.answer.skipped ? "Update" : "Submit"}
            </Button>
            <Button
              onClick={skips ? skip : onNext}
              disabled={skips ? disabled || saving : !hasNext}
              aria-label={
                (skips ? "Skip" : "Next") +
                (pendingAhead > 0 ? `, ${pendingAhead} new` : "")
              }
              rightSection={
                // Inline, not floating: a Mantine Button clips what overflows.
                pendingAhead > 0 ? (
                  <span className="min-w-5 h-5 px-1 rounded-full bg-app-danger text-white text-xs font-bold flex items-center justify-center animate-pulse">
                    {pendingAhead}
                  </span>
                ) : (
                  <ArrowRightIcon size={16} />
                )
              }
            >
              {skips ? "Skip" : "Next"}
            </Button>
          </div>
        </div>
      </Paper>
    </div>
  );
}
