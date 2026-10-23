import { describe, expect, it } from "vitest";
import { PlanItemSchema, planLlmSchema, questionFor } from "./plan";

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

describe("questionFor() and draft hints", () => {
  it("carries a text question's draftHints onto the question", () => {
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
          draftHints: "A comma-separated list of short, lowercase tags."
        }
      }
    });

    expect(questionFor(item)?.draftHints).toBe(
      "A comma-separated list of short, lowercase tags."
    );
  });

  it.each([
    { type: "radio", options: ["Yes", "No"] },
    { type: "checkbox", options: ["Yes", "No"] },
    { type: "number" }
  ])("rejects draftHints on a $type question", (shape) => {
    const parsed = PlanItemSchema.safeParse({
      id: "q",
      order: "a0",
      kind: "prompt",
      payload: {
        key: "q",
        question: {
          ...shape,
          prompt: "Which?",
          required: false,
          draftHints: "Short."
        }
      }
    });

    expect(parsed.success).toBe(false);
  });
});

describe("planLlmSchema() and draft hints", () => {
  it("asks for draftHints on every text question, as a string or null", () => {
    // Gemini leaves optional draftHints out even when the playbook has hints.
    const texts: { properties: Record<string, { type: unknown }>; required: string[] }[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as { properties?: { type?: { enum?: string[] } } };
      if (n.properties?.type?.enum?.[0] === "text") texts.push(node as never);
      Object.values(node).forEach(walk);
    };
    walk(planLlmSchema());

    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text.required).toContain("draftHints");
      expect(text.properties.draftHints.type).toEqual(["string", "null"]);
    }
  });
});
