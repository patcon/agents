import { describe, expect, it } from "vitest";
import { foldLog, isOpen, type LogMessage, type Question } from "./shared";

// Log entries as the server appends them.

let next = 0;
const at = () => ++next;

function asked(question: Partial<Question> & Pick<Question, "id" | "type">): LogMessage {
  return {
    id: `q-${question.id}`,
    role: "assistant",
    metadata: { kind: "question", subjectId: question.id, at: at() },
    parts: [
      {
        type: "data-question",
        data: { prompt: question.id, required: false, source: "plan", ...question }
      }
    ]
  };
}

function shown(questionId: string): LogMessage {
  return {
    id: `shown-${at()}`,
    role: "user",
    metadata: { kind: "shown", subjectId: questionId, at: next },
    parts: [{ type: "data-shown", data: { questionId } }]
  };
}

function said(text: string): LogMessage {
  return {
    id: `u-${at()}`,
    role: "user",
    metadata: { kind: "utterance", subjectId: `u-${next}`, at: next },
    parts: [{ type: "text", text }]
  };
}

const suggestedFor = (log: LogMessage[], id: string) =>
  foldLog(log).questions.find((q) => q.question.id === id)?.suggested;

describe("foldLog() dictation into text questions", () => {
  it("drafts what was said while a text question showed, in order", () => {
    const log = [
      asked({ id: "tags", type: "text" }),
      shown("tags"),
      said("Housing,"),
      said("transport and parks.")
    ];

    expect(suggestedFor(log, "tags")).toBe("Housing, transport and parks.");
  });

  it("leaves out what was said before it showed, or while another question showed", () => {
    const log = [
      asked({ id: "intro", type: "text" }),
      asked({ id: "tags", type: "text" }),
      said("Before anything showed."),
      shown("intro"),
      said("About the intro."),
      shown("tags"),
      said("Housing.")
    ];

    expect(suggestedFor(log, "tags")).toBe("Housing.");
  });

  it("joins every stretch the question was on screen", () => {
    const log = [
      asked({ id: "intro", type: "text" }),
      asked({ id: "tags", type: "text" }),
      shown("tags"),
      said("Housing."),
      shown("intro"),
      said("About the intro."),
      shown("tags"),
      said("And parks.")
    ];

    expect(suggestedFor(log, "tags")).toBe("Housing. And parks.");
  });

  it("drafts nothing when dictation is off", () => {
    const log = [
      asked({ id: "tags", type: "text", dictate: false }),
      shown("tags"),
      said("Housing.")
    ];

    expect(suggestedFor(log, "tags")).toBeUndefined();
  });

  it("drafts nothing when nothing was said while it showed", () => {
    const log = [
      asked({ id: "tags", type: "text" }),
      said("Before it showed."),
      shown("tags")
    ];

    expect(suggestedFor(log, "tags")).toBeUndefined();
  });

  it("doesn't dictate into radio, checkbox or number questions", () => {
    const log = [
      asked({ id: "pick", type: "radio", options: ["Yes", "No"] }),
      asked({ id: "many", type: "checkbox", options: ["A", "B"] }),
      asked({ id: "count", type: "number" }),
      shown("pick"),
      said("Yes."),
      shown("many"),
      said("A."),
      shown("count"),
      said("Three.")
    ];

    expect(suggestedFor(log, "pick")).toBeUndefined();
    expect(suggestedFor(log, "many")).toBeUndefined();
    expect(suggestedFor(log, "count")).toBeUndefined();
  });

  it("still fills radio questions from Jev's assessment", () => {
    const log: LogMessage[] = [
      asked({ id: "pick", type: "radio", options: ["Yes", "No"] }),
      shown("pick"),
      said("Yes."),
      {
        id: "assessment",
        role: "assistant",
        metadata: { kind: "assessment", subjectId: "jev", at: at() },
        parts: [
          {
            type: "data-assessment",
            data: {
              model: "jev-test",
              seenUpTo: "",
              onScreen: "pick",
              questions: {
                pick: {
                  type: "radio",
                  pick: { Yes: 0.95, No: 0.05 },
                  confidence: 0.9,
                  stated: 1,
                  heardOnScreen: ["Yes."]
                }
              }
            }
          }
        ]
      }
    ];

    expect(suggestedFor(log, "pick")).toBe("Yes");
  });
});

describe("isOpen()", () => {
  const question = { id: "tags", type: "text", prompt: "Tags?", required: false, source: "plan" } as const;

  it("is open with no answer", () => {
    expect(isOpen({ question, askedAt: 1, answerCount: 0 })).toBe(true);
  });

  it("is open when skipped, since a skip isn't an answer", () => {
    const answer = { value: null, skipped: true };

    expect(isOpen({ question, askedAt: 1, answerCount: 1, answer })).toBe(true);
  });

  it("is closed once answered", () => {
    const answer = { value: "Housing", skipped: false };

    expect(isOpen({ question, askedAt: 1, answerCount: 1, answer })).toBe(false);
  });
});
