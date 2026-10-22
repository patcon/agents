# RFC: Jev judges how well the evidence supports an answer

Status: partly implemented. [`2026-10-22-jev`](../2026-10-22-jev) asks Jev about each card's options live, as people talk, with no proposal in between (see "What 2026-10-22-jev built" below). Assessing Gemini's proposals isn't built.

## The problem

`rfc-agent-proposals.md` has Gemini propose answers from what a person says, with `confidence: "high" | "low"`. That confidence is the model's own report about its own output. It's coarse, it isn't calibrated, and nothing can be compared from one proposal to the next.

We want a number we can set thresholds on: how strongly does the evidence we have support this answer to this question? The evidence comes from several places: the transcript, the person's other answers, and, for the admin setup, the project's current settings.

[Jev](https://docs.typesafe.ai/introduction), TypeSafe's System One model, answers typed questions about some given state with probabilities instead of text. That fits the job: give it the question, the candidate answer and the evidence, and read off how likely it is that the evidence supports the answer.

## The proposal

### Only for quantitative answers

Jev is meant for quantitative evidence: answers that come from a fixed set of options, or a number. That's radio, checkbox and number questions. It shouldn't be used on freeform text answers, where "does the evidence support this answer" has no clear shape for a probability. Text answers keep Gemini's proposal without an assessment.

### `assessCertainty()`, called by code or the agent

Jev doesn't call tools. It answers questions about the state it's given. So the tool is a server function that the agent or plain code calls, and that function calls Jev:

```ts
async assessCertainty(questionId: string, candidate: AnswerValue): Promise<Assessment>
```

It runs after each proposal (replacing Gemini's `confidence`), and can also run on an answer the person gave, to flag ones the transcript disagrees with.

### Evidence is gathered in code, with ids

Each source is a small function over the folded log:

```ts
type EvidenceItem = {
  id: string; // utterance id, question id or setting name
  source: "transcript" | "answers" | "settings";
  at?: number;
  text: string;
};

type EvidenceSource = (view: LogView) => EvidenceItem[];
```

The bundle goes to Jev as named fields, which the [state guidance](https://docs.typesafe.ai/concepts/state) recommends:

```ts
const state = {
  question: { prompt, type, options },
  candidate_answer: candidate,
  evidence: {
    transcript: [...], // the most recent N utterances
    other_answers: [...],
    project_settings: {...}
  }
};
```

The docs give no maximum state size, so the transcript is cut to the most recent N utterances to start with.

### Questions to Jev, asked together

All questions about one candidate go in one request. Jev answers them independently and in parallel, and the docs say extra questions barely change the response time.

The model for this is TypeSafe's [citation check cookbook](https://docs.typesafe.ai/cookbooks/citation_check). It asks one Choice question, "How does the section relate to the claim?", with the options `supports`, `contradicts` and `says_nothing`, and accepts the verdict when its confidence is at least 0.8.

| Question type | Questions |
|---|---|
| Every type | `relation`: a Choice with `supports`, `contradicts` and `says_nothing`: "How does `evidence` relate to `candidate_answer` as an answer to `question`?" |
| radio | `pick`: a Choice over the question's own options, to see how close the alternatives are. `stated`: a Noul, "Does `evidence` state an answer to `question` at all?" The docs say a "none of the above" option doesn't work well in a Choice. |
| checkbox | One Noul per option: "Does `evidence` indicate that `<option>` applies?" A Choice can only pick one. |
| number | `relation` only |
| text | Not assessed |

### Which evidence supports it

Jev returns no explanation and no spans. To find the `basis` that `rfc-agent-proposals.md` wants, ask one Noul per recent utterance in the same request: "Does `evidence.transcript[3]` support `candidate_answer`?" The utterances with high values become the basis, so the transcript drawer can mark them.

### An `assessment` entry in the log

```ts
| { kind: "assessment"; subjectId: string; at: number }
// data-assessment: {
//   candidate: AnswerValue;
//   model: string;            // the version Jev reports, e.g. "jev-1.13.0"
//   seenUpTo: string;         // the last utterance id in the evidence
//   answers: Record<string, unknown>; // Jev's answers as returned
// }
```

The raw probabilities are stored, not a verdict. Thresholds are applied when the log is folded, so they can change without calling Jev again. A starting policy, following the cookbook:

- `relation` is `supports` with confidence ≥ 0.8: accept the proposal as is;
- in between: show it, and ask the person to confirm;
- `contradicts`, or `stated` below 0.5: drop the proposal.

An assessment is stale once utterances newer than `seenUpTo` exist, and is run again.

### Calling Jev from the Worker

- Plain `fetch` to `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer`. The JS SDK (`@typesafe-ai/sdk`) needs Node 22, and the docs don't say whether it runs in Workers. `2026-10-22-jev` uses `fetch`, retrying on 429 and 529 (`src/jev.ts`).
- `TYPESAFE_API_KEY` is listed under `secrets.required` in `wrangler.jsonc`.
- The model is pinned in `wrangler.jsonc`, not `jev-latest`, and the version Jev reports is logged with each assessment. Assessments can then be compared over time.
- Input tokens are billed. Output tokens are free for now. The cost tally in the log drawer should count Jev's `usage` too.

## The alternatives

- **Keep Gemini's own confidence.** No new service. But it's two coarse levels the model reports about itself, and no threshold can be tuned on it.
- **Ask Gemini for a probability.** A number, but not a calibrated one. A model generating text is not trained to make its stated numbers mean anything.
- **Jev proposes the answer as well.** For radio and checkbox questions, `pick` and the per-option Nouls already are a proposal. That could replace Gemini for those types later. Text answers still need a model that writes.
- **One request per question type, or per evidence item.** Simpler code, but slower and more expensive. The docs recommend asking questions that share state together.

## Open questions

- **Language.** The docs say Jev is mainly trained on English and is less accurate in other languages. Much of Dembrane's audio is Dutch. On short written Dutch transcripts (`pnpm try-jev` in `2026-10-22-jev`) it did as well as on the English ones; real transcribed Dutch, with its errors, is still untested. Translating the evidence to English first is a fallback.
- **How much transcript.** The most recent N utterances may miss something said early on. Choosing relevant utterances first (TypeSafe's reranking cookbook) is an option if N turns out too small.
- **Thresholds.** 0.8 comes from the cookbook, not from our data. `2026-10-22-jev` fills in options at 0.8 and keeps them until 0.3, which looks right on a dozen test transcripts and nothing more. We'd collect assessments alongside what people actually accepted, and set thresholds from that.
- **Freeform answers.** Once we have numbers from the quantitative types, we could experiment with Jev on text answers, for instance with the `relation` Choice alone, and see whether its confidences mean anything there.
- **Assessing the person's own answers.** Flagging an answer the transcript contradicts could be useful or could feel like being second-guessed. Maybe only for the host.

## What 2026-10-22-jev built

A narrower use than the one proposed above: no candidate answer and no `relation` question. Jev is asked directly which options of each card the speaker chose, and the page shades and fills them in.

- **Which questions.** Every unanswered radio and checkbox question, in one request, over the last 40 utterances. It runs about 1.5 seconds after an utterance or a new question, with one request in flight at a time. Number and text questions aren't assessed. A plan prompt can opt out with `"assess": false`.
- **What's asked.** For radio, `pick`, a Choice over the options, and `stated`, a Noul: "has the speaker answered this at all?". An option's likelihood is `pick × stated`. That keeps "none of the above" out of the Choice, as the docs advise. For checkbox, one Noul per option, as proposed above.
- **What was on screen.** The page reports each question it shows, as a `shown` entry in the log. Each utterance in Jev's state carries the question that was on screen when it was said. Jev is told that those lines answer that question directly, and that earlier ones count only if they clearly settle it. Questions arrive filled in from earlier talk, at lower likelihoods than answers given while they show.
- **The log.** An `assessment` entry per run, with the raw probabilities, the model version, the last utterance seen (`seenUpTo`), the question on screen, and per question the utterances said while it showed (`heardOnScreen`). The fold applies thresholds, as proposed above. There's one entry per run rather than per question, since one request covers them all.
- **The page.** Each option has a bar as wide as its likelihood: dim and blurred below 0.8, solid above it. At 0.8 the option is filled into the draft, never submitted, and a manual edit wins. Once filled, it stays until it drops below 0.3, so noise between runs doesn't flip it.
- **Switching it on.** On whenever `TYPESAFE_API_KEY` is set; `JEV_ENABLED=false` turns it off.

What we learned:

| Case (`pnpm try-jev`, `jev-1.13.0`)                         | Likelihood               |
| ----------------------------------------------------------- | ------------------------ |
| Answered while the question is on screen, Dutch or English  | 0.90–0.99                |
| Answered before the question appeared                       | 0.81–0.87                |
| A bare "Ja." to a yes/no question on screen                 | 0.86–0.91                |
| Undecided, or talking about something else                  | ≤ 0.07                   |
| Checkbox: three topics named, one turned down               | 0.91–0.96, and not ticked |
| "Don't anonymize… no, actually, do"                         | 0.63, so not filled in   |

- **Cost and speed.** About 4,500 input tokens per run for the admin setup's 13 option questions, about $0.0002, in 230–400 ms. Most of those tokens are the questions themselves, not the transcript.
- **Model.** `jev-1.14.0` (`jev-preview`) is slightly sharper. But it scored "the language is Dutch" at 0.31 from unrelated Dutch speech, reading the speech's own language as an answer. `jev-1.13.0` stays pinned for now.

## The decision

Not decided yet. A first slice would be:

- the evidence sources for the transcript and other answers;
- `assessCertainty()` with the `relation` Choice for every type except text, over `fetch`;
- the `assessment` entry and the log drawer showing its probabilities;
- a run on every proposal.

The per-type questions, per-utterance basis, settings as evidence and thresholds that change the UI wait until we've seen numbers on real transcripts.
