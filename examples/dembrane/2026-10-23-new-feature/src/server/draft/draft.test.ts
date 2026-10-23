import { describe, expect, it } from "vitest";
import type { Question } from "../../shared";
import { draftRequest, readDraft } from "./draft";

const tags: Question = {
  id: "tags",
  type: "text",
  prompt: "Which tags can participants pick from?",
  required: false,
  draftHints: "A comma-separated list of short, lowercase tags.",
  source: "plan"
};
const said = [
  { text: "um, tags, so housing, and transport" },
  { text: "oh and not parks, actually yes parks" }
];

describe("draftRequest", () => {
  it("includes the question's prompt", () => {
    expect(draftRequest(tags, said).prompt).toContain(
      "Which tags can participants pick from?"
    );
  });

  it("includes the hints", () => {
    expect(draftRequest(tags, said).prompt).toContain(
      "A comma-separated list of short, lowercase tags."
    );
  });

  it("says when there are no hints", () => {
    const { draftHints: _, ...noHints } = tags;
    expect(draftRequest(noHints, said).prompt).toMatch(/hints: none/i);
  });

  it("includes every utterance, in order", () => {
    const { prompt } = draftRequest(tags, said);
    const first = prompt.indexOf("um, tags, so housing, and transport");
    const second = prompt.indexOf("oh and not parks, actually yes parks");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it("includes the previous draft when there is one", () => {
    expect(draftRequest(tags, said, "housing, transport").prompt).toContain(
      "housing, transport"
    );
  });

  it("leaves the previous draft out when there isn't one", () => {
    expect(draftRequest(tags, said).prompt).not.toMatch(/previous draft/i);
  });

  it("asks for a draft string", () => {
    expect(draftRequest(tags, said).schema).toEqual({
      type: "object",
      properties: { draft: { type: "string" } },
      required: ["draft"]
    });
  });
});

describe("readDraft", () => {
  it("returns the draft's text", () => {
    expect(readDraft({ draft: "housing, transport" })).toBe(
      "housing, transport"
    );
  });

  it("throws when draft is missing", () => {
    expect(() => readDraft({})).toThrow();
  });

  it("throws when draft isn't a string", () => {
    expect(() => readDraft({ draft: 3 })).toThrow();
  });

  it("throws when the answer isn't an object", () => {
    expect(() => readDraft(null)).toThrow();
  });
});
