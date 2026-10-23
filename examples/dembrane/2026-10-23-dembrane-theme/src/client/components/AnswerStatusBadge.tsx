import { Badge } from "@cloudflare/kumo";
import {
  type QuestionView
} from "../../shared";

export function AnswerStatusBadge({ entry }: { entry: QuestionView }) {
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
