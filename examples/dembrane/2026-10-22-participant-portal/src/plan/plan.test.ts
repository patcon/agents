import { describe, expect, it } from "vitest";
import { PlanItemSchema, questionFor } from "./plan";

describe("questionFor() and dictation", () => {
  it("carries a text question's dictate: false onto the question", () => {
    const item = PlanItemSchema.parse({
      id: "tags",
      order: "a0",
      kind: "prompt",
      payload: {
        key: "tags",
        question: {
          type: "text",
          prompt: "Which tags?",
          required: false,
          dictate: false
        }
      }
    });

    expect(questionFor(item)?.dictate).toBe(false);
  });

  it("leaves dictate unset when the prompt doesn't say", () => {
    const item = PlanItemSchema.parse({
      id: "tags",
      order: "a0",
      kind: "prompt",
      payload: {
        key: "tags",
        question: { type: "text", prompt: "Which tags?", required: false }
      }
    });

    expect(questionFor(item)?.dictate).toBeUndefined();
  });
});
