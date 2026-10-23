// Jev, TypeSafe's System One model, judging which options of a card the
// speaker has chosen. It answers typed questions about the state it's given
// with probabilities instead of text. https://docs.typesafe.ai/api
//
// One request covers every open question with options: Jev answers them
// independently and in parallel, over the same transcript.
//
// Run as plain TypeScript by `pnpm try-jev` too, so only type imports here.

import type { Question } from "../shared";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

// --- The API ---

type JevQuestion =
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    }
  | {
      type: "noul";
      instructions: string;
      criteria?: { true: string; false: string };
    };

export type JevAnswer =
  | {
      type: "choice";
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
    }
  | { type: "noul"; noul: number };

export type JevRequest = {
  model: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
};

export type JevResponse = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
};

/** POST to Jev, retrying when it's rate limited (429) or overloaded (529). */
export async function askJev(
  apiKey: string,
  request: JevRequest,
  attempts = 3
): Promise<JevResponse> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request)
    });
    if (response.ok) return (await response.json()) as JevResponse;
    const retry = response.status === 429 || response.status === 529;
    if (!retry || attempt >= attempts) {
      throw new Error(`Jev ${response.status}: ${await response.text()}`);
    }
    const after = Number(response.headers.get("retry-after"));
    await new Promise((r) =>
      setTimeout(r, after > 0 ? after * 1000 : 500 * 2 ** attempt)
    );
  }
}

// --- What we ask ---

/** A question Jev can judge: one whose card presents options. */
export type Assessable = Pick<Question, "id" | "prompt"> & {
  type: "radio" | "checkbox";
  options: string[];
};

export function isAssessable(question: Question): question is Question & Assessable {
  return (
    (question.type === "radio" || question.type === "checkbox") &&
    !!question.options?.length &&
    question.assess !== false
  );
}

/** An utterance, and the question that was on screen when it was said. */
export type Heard = { id: string; text: string; onScreen: string | null };

/**
 * What Jev said about one question, with its options named again.
 * radio: `pick` spreads one choice over the options; `stated` is whether an
 * answer has been given at all. checkbox: one probability per option.
 */
export type QuestionAssessment =
  | {
      type: "radio";
      pick: Record<string, number>;
      confidence: number;
      stated: number;
    }
  | { type: "checkbox"; options: Record<string, number> };

const SETTING =
  "A host is setting up their project's participant portal by talking it " +
  "through out loud. Questions are shown on screen one at a time. The " +
  "transcript is speech-to-text, in whatever language they speak, and may " +
  "have errors.";

/**
 * What was said, as Jev reads it. A transcriber's "Basic?" is usually an
 * answer said with a rising voice, but Jev reads it as doubt, so question
 * marks become periods (and Spanish's opening "¿" goes).
 */
function asStatement(text: string) {
  return text.replaceAll("?", ".").replaceAll("¿", "");
}

/**
 * One request about all of `questions`. In the state, questions are named
 * q1, q2, ... and each line of the transcript says which one was on screen
 * when it was said.
 */
export function assessmentRequest(
  model: string,
  questions: Assessable[],
  transcript: Heard[]
): JevRequest {
  const alias = new Map(questions.map((q, i) => [q.id, `q${i + 1}`]));
  const state = {
    setting: SETTING,
    questions: Object.fromEntries(
      questions.map((q) => [
        alias.get(q.id),
        { prompt: q.prompt, options: q.options, pick: q.type === "radio" ? "one" : "any" }
      ])
    ),
    transcript: transcript.map((u) => ({
      said: asStatement(u.text),
      on_screen: (u.onScreen && alias.get(u.onScreen)) ?? null
    }))
  };

  const asked: Record<string, JevQuestion> = {};
  for (const q of questions) {
    const a = alias.get(q.id)!;
    const weigh =
      `Lines of \`transcript\` whose \`on_screen\` is "${a}" were said while ` +
      `\`questions.${a}\` was on screen, so they answer it directly. Lines said ` +
      `before it appeared count only if they clearly settle the same thing. ` +
      `Later lines override earlier ones.`;
    if (q.type === "radio") {
      asked[`${a}_pick`] = {
        type: "choice",
        instructions: `Which option of \`questions.${a}\` has the speaker chosen? ${weigh}`,
        criteria: Object.fromEntries(
          q.options.map((option) => [option, `The speaker's answer is "${option}".`])
        )
      };
      asked[`${a}_stated`] = {
        type: "noul",
        instructions: `Has the speaker given an answer to \`questions.${a}\`? ${weigh}`,
        criteria: {
          true: "They said which option they want, directly or clearly enough to tell.",
          false: "They haven't addressed it, are undecided, or only talked around it."
        }
      };
    } else {
      q.options.forEach((option, i) => {
        asked[`${a}_opt${i}`] = {
          type: "noul",
          instructions:
            `Has the speaker said that "${option}" should be among their ` +
            `answers to \`questions.${a}\`? ${weigh}`
        };
      });
    }
  }
  return { model, state, questions: asked };
}

/** Jev's answers, per question id. */
export function readAssessment(
  questions: Assessable[],
  response: JevResponse
): Record<string, QuestionAssessment> {
  const out: Record<string, QuestionAssessment> = {};
  questions.forEach((q, i) => {
    const a = `q${i + 1}`;
    if (q.type === "radio") {
      const pick = response.answers[`${a}_pick`];
      const stated = response.answers[`${a}_stated`];
      if (pick?.type !== "choice" || stated?.type !== "noul") return;
      out[q.id] = {
        type: "radio",
        pick: pick.probabilities,
        confidence: pick.confidence,
        stated: stated.noul
      };
    } else {
      const options: Record<string, number> = {};
      q.options.forEach((option, j) => {
        const answer = response.answers[`${a}_opt${j}`];
        if (answer?.type === "noul") options[option] = answer.noul;
      });
      out[q.id] = { type: "checkbox", options };
    }
  });
  return out;
}

/**
 * How likely each option is to be the speaker's, from 0 to 1. For radio,
 * an option is only as likely as an answer having been given at all.
 */
export function likelihoodOf(
  assessment: QuestionAssessment
): Record<string, number> {
  if (assessment.type === "checkbox") return assessment.options;
  return Object.fromEntries(
    Object.entries(assessment.pick).map(([option, p]) => [
      option,
      p * assessment.stated
    ])
  );
}
