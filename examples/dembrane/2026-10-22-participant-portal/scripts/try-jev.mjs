// Runs short transcripts past Jev, with every question in the admin setup
// plan that presents options, as the session would. Prints how likely Jev
// thinks each expected option is, and any other question it lit up.
//
// Usage: pnpm try-jev [case-name-prefix]
// Reads TYPESAFE_API_KEY from .env; JEV_MODEL picks the model.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PlanSchema, questionFor } from "../src/plan/plan.ts";
import {
  askJev,
  assessmentRequest,
  isAssessable,
  likelihoodOf,
  readAssessment
} from "../src/models/jev.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split("\n")
    .map((line) => line.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value])
);
const apiKey = process.env.TYPESAFE_API_KEY || env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error("Set TYPESAFE_API_KEY in .env");
const model = process.env.JEV_MODEL || "jev-1.13.0";

const plan = PlanSchema.parse(
  JSON.parse(readFileSync(join(root, "src/plan/admin-setup.json"), "utf8"))
);
const questions = plan.items
  .map(questionFor)
  .filter((q) => q && isAssessable(q));

// Each line is [question on screen, what was said]. `expect` gives the
// options that should light up; null means nothing should yet.
const CASES = [
  {
    name: "nl-language",
    lines: [["language", "De deelnemers spreken allemaal Nederlands, het is een buurtproject in Utrecht."]],
    expect: { language: "Dutch" }
  },
  {
    name: "nl-language-implicit",
    lines: [["language", "Nou, we zitten in Gent, dus ja, Vlaams eigenlijk."]],
    expect: { language: "Dutch" }
  },
  {
    name: "nl-name-yes-email-ahead",
    lines: [
      ["default_conversation_ask_for_participant_details", "Ja, namen mogen ze invullen. Maar e-mailadressen hoeven we echt niet te hebben."]
    ],
    expect: { default_conversation_ask_for_participant_details: ["A name"] }
  },
  {
    name: "nl-undecided",
    lines: [["is_project_notification_subscription_allowed", "Hmm, goeie vraag. Daar moet ik even over nadenken, misschien later."]],
    expect: { is_project_notification_subscription_allowed: null }
  },
  {
    name: "nl-on-screen-overrides",
    lines: [
      ["default_conversation_ask_for_participant_details", "Nee, namen niet. En anonimiseren lijkt me trouwens ook niet nodig."],
      ["anonymize_transcripts", "Nou, nu ik het zo zie, eigenlijk toch wel. Laten we het anonimiseren."]
    ],
    expect: { default_conversation_ask_for_participant_details: [], anonymize_transcripts: "Yes" }
  },
  {
    name: "nl-checkbox",
    lines: [["verification_topics", "Acties en afspraken zijn het belangrijkst, en de onenigheden ook wel. Die gems hoeven niet."]],
    expect: { verification_topics: ["Actions", "Agreements", "Disagreements"] }
  },
  {
    name: "nl-unrelated",
    lines: [["default_conversation_tutorial_slug", "We hebben volgende week ongeveer veertig deelnemers, in drie groepen."]],
    expect: { default_conversation_tutorial_slug: null }
  },
  {
    name: "nl-tutorial-implicit",
    lines: [["default_conversation_tutorial_slug", "Doe maar de simpele uitleg, niks ingewikkelds."]],
    expect: { default_conversation_tutorial_slug: "Basic" }
  },
  {
    name: "nl-bare-ja",
    lines: [
      ["is_project_notification_subscription_allowed", "Ehm, ja."],
      ["anonymize_transcripts", "Ja."]
    ],
    expect: { is_project_notification_subscription_allowed: "Yes", anonymize_transcripts: "Yes" }
  },
  {
    name: "nl-vague-ahead",
    lines: [["language", "Nederlands. O, en dat Explore-ding klinkt wel leuk trouwens, maar daar kom ik nog op."]],
    expect: { language: "Dutch", is_get_reply_enabled: null }
  },
  {
    name: "en-name-yes-email-ahead",
    lines: [
      ["default_conversation_ask_for_participant_details", "Yes, they can fill in their names. But we really don't need email addresses."]
    ],
    expect: { default_conversation_ask_for_participant_details: ["A name"] }
  },
  {
    name: "en-checkbox",
    lines: [["verification_topics", "Actions and agreements matter most, and the disagreements too I guess. Skip the gems."]],
    expect: { verification_topics: ["Actions", "Agreements", "Disagreements"] }
  }
];

const pct = (p) => `${Math.round(p * 100)}%`.padStart(4);
const only = process.argv[2];
let tokens = 0;

for (const c of CASES.filter((c) => !only || c.name.startsWith(only))) {
  const transcript = c.lines.map(([onScreen, text], i) => ({ id: `u${i}`, text, onScreen }));
  const started = Date.now();
  const response = await askJev(apiKey, assessmentRequest(model, questions, transcript));
  const ms = Date.now() - started;
  tokens += response.usage.input_tokens;
  const assessments = readAssessment(questions, response);

  console.log(`\n## ${c.name} (${response.model}, ${ms} ms, ${response.usage.input_tokens} tokens)`);
  for (const [, text] of c.lines) console.log(`   > ${text}`);
  for (const q of questions) {
    const assessment = assessments[q.id];
    if (!assessment) continue;
    const likelihood = likelihoodOf(assessment);
    const top = Math.max(...Object.values(likelihood));
    if (!(q.id in c.expect) && top < 0.3) continue;
    const expected = c.expect[q.id];
    const want = new Set(expected == null ? [] : [expected].flat());
    const extra =
      assessment.type === "radio"
        ? ` stated ${pct(assessment.stated)} confidence ${pct(assessment.confidence)}`
        : "";
    console.log(`${q.id in c.expect ? "  " : "! "}${q.id}${extra}`);
    for (const [option, p] of Object.entries(likelihood)) {
      if (p < 0.05 && !want.has(option)) continue;
      console.log(`     ${want.has(option) ? "*" : " "} ${pct(p)} ${option}`);
    }
  }
}
console.log(`\n${tokens} input tokens in all`);
