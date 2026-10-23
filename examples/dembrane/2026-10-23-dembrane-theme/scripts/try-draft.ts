// Runs short rambles past the draft prompt, with DRAFT_MODEL at low thinking
// as the server does, and prints each draft beside what was said, for
// reading by eye.
//
// Usage: pnpm try-draft [case-name-prefix] [--model name]
// --model tries another model in place of DRAFT_MODEL.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { draftRequest, readDraft } from "../src/server/draft/draft.ts";
import type { Question } from "../src/shared/index.ts";
import { generator, loadEnv, root } from "./gemini.ts";

type Case = {
  name: string;
  question: Pick<Question, "prompt" | "draftHints">;
  said: string[];
  previous?: string;
  /** What a good draft looks like, for whoever reads it. */
  want: string;
};

const tags = {
  prompt: "Which tags can participants pick from? Separate them with commas.",
  draftHints: "A comma-separated list of short, lowercase tags, nothing else."
};
const about = { prompt: "What should the portal page say?" };

const CASES: Case[] = [
  {
    name: "ramble-correction",
    question: tags,
    said: [
      "um, tags, so housing, and transport, oh and not parks, actually yes parks, and libraries"
    ],
    want: "housing, transport, parks, libraries"
  },
  {
    name: "verbatim",
    question: tags,
    said: [
      "um, tags, so housing, and transport, oh and not parks, actually yes parks, and libraries",
      "just write exactly what I said"
    ],
    previous: "housing, transport, parks, libraries",
    want: "their words as said, without the instruction"
  },
  {
    name: "drop-parking",
    question: about,
    said: [
      "Welcome to the neighbourhood consultation. We want to hear how you get around, what you think of the new bus route, and whether parking on the high street works for you.",
      "Actually, drop the bit about parking."
    ],
    previous:
      "Welcome to the neighbourhood consultation. We want to hear how you get around, what you think of the new bus route, and whether parking on the high street works for you.",
    want: "the same welcome, without parking"
  },
  {
    name: "no-hints",
    question: about,
    said: [
      "so, uh, this is where people, residents, come to share what they think about the, the park redesign, and, um, it takes about ten minutes"
    ],
    want: "a clean, faithful version of what was said"
  },
  {
    name: "dutch-english-hints",
    question: tags,
    said: [
      "eh, tags, dus wonen, verkeer, en, wacht, niet groen, ja toch wel groen, en veiligheid"
    ],
    want: "wonen, verkeer, groen, veiligheid"
  },
  {
    name: "complaint",
    question: tags,
    said: [
      "democracy consensus",
      "a sorry a comma between those",
      "A comma between those?",
      "It's no good."
    ],
    previous: "democracy, consensus",
    want: "democracy, consensus, not emptied by the complaint"
  },
  {
    name: "tempting-detail",
    question: about,
    said: [
      "it's about the library. we're asking people what they'd want from it. yeah."
    ],
    want: "nothing beyond the library and asking what people want from it"
  }
];

const args = process.argv.slice(2);
const modelAt = args.indexOf("--model");
const modelFlag = modelAt === -1 ? undefined : args[modelAt + 1];
const [prefix] = args.filter(
  (a, i) => !a.startsWith("--") && (modelAt === -1 || i !== modelAt + 1)
);
const cases = prefix ? CASES.filter((c) => c.name.startsWith(prefix)) : CASES;
if (!cases.length) {
  console.error(
    `No case starts with "${prefix}". Cases: ${CASES.map((c) => c.name).join(", ")}`
  );
  process.exit(1);
}

const env = loadEnv();
const generate = generator(env, modelFlag ?? env.DRAFT_MODEL, 90_000, "low");
const system = readFileSync(join(root, "src/server/draft/prompts/draft.md"), "utf8");

const results = await Promise.all(
  cases.map(async (c) => {
    const { prompt, schema } = draftRequest(
      c.question,
      c.said.map((text) => ({ text })),
      c.previous
    );
    try {
      const { json } = await generate({ system, prompt, schema });
      return { c, draft: readDraft(json) };
    } catch (error) {
      return { c, error: (error as Error).message };
    }
  })
);

let failed = false;
for (const { c, draft, error } of results) {
  console.log(`\n== ${c.name}`);
  console.log(`question: ${c.question.prompt}`);
  console.log(`hints:    ${c.question.draftHints ?? "(none)"}`);
  for (const line of c.said) console.log(`said:     ${line}`);
  if (c.previous !== undefined) console.log(`previous: ${c.previous}`);
  console.log(`want:     ${c.want}`);
  if (error !== undefined) {
    console.log(`failed:   ${error}`);
    failed = true;
  } else console.log(`draft:    ${draft}`);
}
process.exit(failed ? 1 : 0);
