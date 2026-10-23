import type { Question } from "../shared";

// Drafting a text question's answer from what was said while it showed: an
// LLM rewrites the utterances into what the speaker meant, the way the
// question's hints ask. Building the request and reading the answer are
// pure, so the server and `pnpm try-draft` share them. The system prompt is
// src/draft/prompts/draft.md, which the server imports with `?raw` and the
// script reads.

const SCHEMA = {
  type: "object",
  properties: { draft: { type: "string" } },
  required: ["draft"]
};

/**
 * The user's turn and the response schema for drafting `question` from
 * `said`, every utterance that counts for it in order, and the previous
 * draft if there is one.
 */
export function draftRequest(
  question: Pick<Question, "prompt" | "draftHints">,
  said: { text: string }[],
  previous?: string
): { prompt: string; schema: object } {
  const parts = [
    `Question: ${question.prompt}`,
    question.draftHints?.trim()
      ? `Hints: ${question.draftHints.trim()}`
      : "Hints: none. Write a clean, faithful version of what was said.",
    `What was said, in order:\n${said.map((u, i) => `${i + 1}. ${u.text}`).join("\n")}`
  ];
  if (previous !== undefined) parts.push(`Previous draft: ${previous}`);
  return { prompt: parts.join("\n\n"), schema: SCHEMA };
}

/** The draft's text, from an answer to `draftRequest()`'s schema. */
export function readDraft(json: unknown): string {
  const draft = (json as { draft?: unknown } | null)?.draft;
  if (typeof draft !== "string") {
    throw new Error(`expected { draft: string }, got ${JSON.stringify(json)}`);
  }
  return draft;
}
