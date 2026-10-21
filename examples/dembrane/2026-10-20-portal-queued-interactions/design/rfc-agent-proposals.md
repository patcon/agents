# RFC: The agent proposes answers from what the person says

Status: proposed

## The problem

Today a person answers every question by hand, even when they've already said the answer out loud. Someone who says "honestly I'm worried about the budget" has answered "How are you feeling about the topic so far?", but still has to find the question and tap "Concerned".

We want people to be able to just talk, and have an agent turn what they said into answers. The person should stay in charge of what counts as their answer, and the log should show where each answer came from.

## The proposal

### A `proposal` entry, separate from `answer`

The agent never writes `answer` entries. It appends a `proposal` with the question's `subjectId`, holding the proposed value, the utterances it's based on, and a confidence:

```ts
| { kind: "proposal"; subjectId: string; at: number }
// data-proposal: { value: AnswerValue; basis: string[]; confidence: "high" | "low" }
```

`foldLog()` gives each `QuestionView` a `proposal`, shown only while it's newer than the latest answer. When the person accepts it, a normal `answer` entry is appended with `from: <proposal message id>`. The log can then say "Optimistic, accepted from the agent, based on what they said at 0:42".

### When it runs

- **After each utterance:** `this.schedule(4, "propose")`, cancelling any pending one, so it runs after a few seconds of quiet. The portal prototype uses the same rhythm for its proposals.
- **When a new question arrives:** the answer may already be in the transcript.
- **On pause:** from `onCallEnd`.

Only one run at a time. A run counter drops an older run's result when a newer run has started.

`propose()` calls Gemini (`generateJson()`) straight from the scheduled callback rather than through `saveMessages()`. A chat turn per proposal pass would fill the log with assistant messages. The `proposal` entry and its `basis` already explain why it exists.

### The model is constrained per question

The JSON schema is built from the open questions:

- **radio:** an `enum` of its options;
- **checkbox:** an array of that `enum`;
- **number:** `minimum` and `maximum`;
- **every proposal:** must cite utterance ids in `basis`.

Only unanswered questions are offered. The prompt says to propose nothing when the transcript doesn't support an answer. The server drops a proposal that:

- fails `isAnswerable()`;
- uses an option that doesn't exist;
- cites an utterance id that isn't in the log;
- matches the current proposal (`sameAnswer()`).

### The UI pre-fills, it doesn't submit

- **Question card:** a proposal arrives as the draft, labelled "Suggested from what you said" with the quoted utterance. Submit accepts it. Skip and Next behave as they do for any other draft.
- **Stack and Next count:** a question with a fresh proposal counts as new.
- **Transcript drawer:** utterances cited by a proposal get a marker, so a person can see what led to it.

### Later: changes of mind

If someone answered "Neutral" at 0:30 and later says something that contradicts it, the agent could propose a change on an answered question. The UI shows it as "You may have changed your mind" rather than silently replacing the draft.

### Later: auto-accept

This would apply only to optional questions with `confidence: "high"`. The answer is marked "Answered by agent" with one-tap undo. Required questions always need a tap from the person.

## The alternatives

- **The agent writes `answer` entries directly.** Simpler, but nothing would separate what the person chose from what the agent assumed. The summary's required-question warning would also stop meaning anything.
- **Function calls from the Gemini Live transcription session.** Proposals would arrive faster. But it ties proposals to the STT connection, it's harder to debounce, and it gives the server no point to validate before writing to the log.
- **A chat turn per proposal pass, through a `trigger` entry.** That matches how the agent asks its question. But proposal passes are frequent and silent, and an assistant message for each one is log noise.
- **Propose on every interim transcript.** Lower latency, but much more cost, and it proposes from half-finished sentences.

## The decision

Not decided yet. A first slice would be:

- the `proposal` entry and its fold;
- the debounced `propose()` with a schema per question;
- the "Suggested from what you said" draft.

Changes of mind and auto-accept wait until we've seen how good the proposals are.
