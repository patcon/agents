import { Badge } from "@mantine/core";
import {
  type QuestionView
} from "../../shared";

export function AnswerStatusBadge({ entry }: { entry: QuestionView }) {
  const { answer, question } = entry;
  if (!answer) return null;
  if (answer.skipped) {
    return question.required ? (
      <Badge color="yellow">Required · skipped</Badge>
    ) : (
      <Badge color="gray">Skipped</Badge>
    );
  }
  return (
    <Badge color="green">
      {entry.answerCount > 1
        ? `Answered · rev ${entry.answerCount}`
        : "Answered"}
    </Badge>
  );
}
