import { Surface, Text } from "@cloudflare/kumo";
import {
  FlagCheckeredIcon,
  WarningIcon
} from "@phosphor-icons/react";
import {
  formatAnswer,
  type QuestionView
} from "../../shared";
import { AnswerStatusBadge } from "./AnswerStatusBadge";

export function Summary({ questions }: { questions: QuestionView[] }) {
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
