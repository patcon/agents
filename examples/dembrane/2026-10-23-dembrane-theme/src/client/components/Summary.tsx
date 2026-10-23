import { Paper, Text } from "@mantine/core";
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
    <Paper className="p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <FlagCheckeredIcon size={20} className="text-app-action" />
        <Text size="lg">Session finished</Text>
      </div>
      {missing.length > 0 && (
        <div className="flex gap-2 p-3 bg-app-warning-tint">
          <WarningIcon
            size={16}
            className="text-app-warning shrink-0 mt-0.5"
          />
          <Text size="sm">
            {missing.length} required question
            {missing.length === 1 ? " was" : "s were"} skipped or left
            unanswered.
          </Text>
        </div>
      )}
      <ol className="flex flex-col divide-y divide-app-quiet">
        {questions.map((entry, i) => (
          <li
            key={entry.question.id}
            className="grid grid-cols-[1.5rem_1fr] gap-x-2 py-3 first:pt-0 last:pb-0"
          >
            <span className="text-sm text-app-muted tabular-nums">
              {i + 1}.
            </span>
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="text-sm font-medium text-app-text">
                {entry.question.prompt}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`text-sm ${entry.answer && !entry.answer.skipped ? "text-app-text" : "text-app-muted italic"}`}
                >
                  {formatAnswer(entry.answer)}
                </span>
                <AnswerStatusBadge entry={entry} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Paper>
  );
}
