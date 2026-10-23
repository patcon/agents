import { useState } from "react";
import { Button } from "@mantine/core";
import { CheckIcon } from "@phosphor-icons/react";
import { CardInput } from "../cards/registry";
import { type AnswerValue, type QuestionView } from "../../shared";

/**
 * The consent card, in the recording sheet rather than among the questions:
 * recording waits for it. Every option has to be ticked to go on.
 */
export function ConsentForm({
  entry,
  disabled,
  onAgree
}: {
  entry: QuestionView;
  disabled: boolean;
  onAgree: (value: AnswerValue) => Promise<void>;
}) {
  const { question } = entry;
  const [value, setValue] = useState<AnswerValue>(
    entry.answer && !entry.answer.skipped ? entry.answer.value : []
  );
  const [saving, setSaving] = useState(false);
  const agreed =
    Array.isArray(value) &&
    (question.options ?? []).every((option) => value.includes(option));

  const agree = async () => {
    setSaving(true);
    try {
      await onAgree(value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 overflow-y-auto pb-4">
      <p className="m-0 text-base sm:text-lg">{question.prompt}</p>
      <CardInput question={question} value={value} onChange={setValue} />
      <div>
        <Button
          variant="filled"
          onClick={agree}
          disabled={disabled || saving || !agreed}
          leftSection={<CheckIcon size={16} />}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
