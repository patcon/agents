# RFC: Jev judges how well the evidence supports an answer

Status: proposed

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

- Plain `fetch` to `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer`. The JS SDK (`@typesafe-ai/sdk`) needs Node 22, and the docs don't say whether it runs in Workers.
- `TYPESAFE_API_KEY` is listed under `secrets.required` in `wrangler.jsonc`.
- The model is pinned in `wrangler.jsonc`, not `jev-latest`, and the version Jev reports is logged with each assessment. Assessments can then be compared over time.
- Input tokens are billed. Output tokens are free for now. The cost tally in the log drawer should count Jev's `usage` too.

## The alternatives

- **Keep Gemini's own confidence.** No new service. But it's two coarse levels the model reports about itself, and no threshold can be tuned on it.
- **Ask Gemini for a probability.** A number, but not a calibrated one. A model generating text is not trained to make its stated numbers mean anything.
- **Jev proposes the answer as well.** For radio and checkbox questions, `pick` and the per-option Nouls already are a proposal. That could replace Gemini for those types later. Text answers still need a model that writes.
- **One request per question type, or per evidence item.** Simpler code, but slower and more expensive. The docs recommend asking questions that share state together.

## Open questions

- **Language.** The docs say Jev is mainly trained on English and is less accurate in other languages. Much of Dembrane's audio is Dutch. We need to test on real Dutch transcripts before trusting any threshold. Translating the evidence to English first is a fallback.
- **How much transcript.** The most recent N utterances may miss something said early on. Choosing relevant utterances first (TypeSafe's reranking cookbook) is an option if N turns out too small.
- **Thresholds.** 0.8 comes from the cookbook, not from our data. We'd collect assessments alongside what people actually accepted, and set thresholds from that.
- **Freeform answers.** Once we have numbers from the quantitative types, we could experiment with Jev on text answers, for instance with the `relation` Choice alone, and see whether its confidences mean anything there.
- **Assessing the person's own answers.** Flagging an answer the transcript contradicts could be useful or could feel like being second-guessed. Maybe only for the host.

## The decision

Not decided yet. A first slice would be:

- the evidence sources for the transcript and other answers;
- `assessCertainty()` with the `relation` Choice for every type except text, over `fetch`;
- the `assessment` entry and the log drawer showing its probabilities;
- a run on every proposal.

The per-type questions, per-utterance basis, settings as evidence and thresholds that change the UI wait until we've seen numbers on real transcripts.
