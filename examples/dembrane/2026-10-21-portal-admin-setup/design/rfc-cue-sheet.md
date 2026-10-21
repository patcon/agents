# RFC: A cue sheet of prepared questions, released by triggers

Status: proposed

## The problem

Questions reach a person in three ways today, and each is wired up separately:

- **`SCHEDULE`** in `src/shared.ts` pairs each question with the second it appears. `begin()` sets up one `this.schedule()` per entry.
- **`HOST_QUESTIONS`** in `src/server.ts` is a separate list that the "From host" button works through in order.
- **The agent** writes its own question at `AGENT_QUESTION_AT`.

What a question asks and when it arrives are tied together. That doesn't fit what this prototype is for: walking a host through a project's portal settings. Those questions shouldn't be on timers. They should arrive together when the session starts, and the host should move through them at their own pace. Some of them only make sense once an earlier one is answered: "Which Explore mode?" only matters if Explore is turned on.

We want the host to prepare a list of questions ahead of time, like a playlist, and have different triggers release them.

## The proposal

### Three separate things

1. **The cue sheet (what's prepared).** An ordered list of cues. Each cue holds one or more questions and a release rule.
2. **The release rule (when).** Each cue says what releases it.
3. **The log (what happened).** A release appends `question` entries as now, with the cue and the reason in their metadata.

How a person moves through released questions doesn't change. The client still shows one question at a time with Back / Next, and new questions stack behind the current one. A self-paced group is just several questions released together.

### Cues

```ts
type Cue = {
  id: string;
  questions: Omit<Question, "id" | "source">[];
  release: Release;
};

type Release =
  | { on: "start" }
  | { on: "time"; at: number } // seconds after the session starts
  | { on: "cue"; cueId: string } // once every question in that cue is answered
  | { on: "answer"; questionKey: string; matches: AnswerValue } // when an answer matches
  | { on: "manual" } // the host releases it
  | { on: "topic"; description: string } // the agent hears it come up
  | { on: "pause" }
  | { on: "finish" };
```

Questions in a cue get a stable `key` (e.g. `explore.enabled`), so an `answer` rule can refer to one without knowing the `id` it gets when it's released.

`PLAYLIST` replaces both `SCHEDULE` and `HOST_QUESTIONS`. What `SCHEDULE` does today is a set of `time` cues. What the "From host" button does is a set of `manual` cues.

### Releasing

The server has one function, `#releaseCues(event)`. It checks every cue that hasn't been released yet against what just happened, and appends the questions of each cue that matches. It's called from:

- `begin()` for `start`, and to set up a `this.schedule()` per `time` cue;
- `answer()` for `cue` and `answer`;
- `setPaused()` and `finish()` for `pause` and `finish`;
- a new `@callable() releaseCue(cueId)` for `manual`;
- the scheduled callback for `time`.

A cue is released at most once. Whether it has been released comes from the log, not from separate state: `foldLog()` collects the `cueId`s it has seen.

```ts
| { kind: "question"; subjectId: string; at: number; cueId?: string; reason?: string }
```

`reason` is short and readable: `"start"`, `"answer to explore.enabled"`, `"host"`. The log drawer then shows why each question arrived.

### Topic cues

A `topic` cue is released by the agent, not by a rule in code. After a few seconds without speech (the same rhythm as `propose()` in `rfc-agent-proposals.md`), the agent is shown the transcript and the `description` of every unreleased `topic` cue. It answers with which ones, if any, have come up. Unlike `askAgentQuestion()`, it picks from prepared questions rather than writing a new one.

This could be a Gemini call, or a yes/no question to Jev per cue (see `rfc-jev-certainty.md`).

### The admin setup as cues

The fields and their dependencies come from the platform's portal editor (`frontend/src/components/project/ProjectPortalEditor.tsx` in the echo repo) and the `01-admin-portal` prototype's `src/shared/fields.ts`. Each section is one cue released at `start`. Each field that only shows when another is on is its own cue, released by that answer.

| Cue | Release | Questions |
|---|---|---|
| Basics | `start` | Language (radio), ask for name (yes/no), ask for email (yes/no), tutorial (radio: none / basic / advanced), tags (text) |
| Participant features | `start` | Explore (yes/no), Verify (yes/no) |
| Portal content | `start` | Page title (text), page content (text), thank-you text (text) |
| Advanced | `start` | Key terms (text), anonymize transcripts (yes/no), auto-generate titles (yes/no) |
| Explore mode | `answer`: Explore = Yes | Mode (radio: summarize / brainstorm / custom) |
| Explore prompt | `answer`: mode = custom | Custom reply prompt (text) |
| Verify details | `answer`: Verify = Yes | Topics (checkbox, at least one), remind on finish (yes/no) |
| Report notifications | `answer`: ask for email = Yes | Allow report notifications (yes/no) |
| Title prompt | `answer`: auto-generate titles = Yes | Custom title prompt (text) |

`legal_basis` and the dembrane event invitation are left out. The platform restricts who can change them, and `behaviours.ts` in `01-admin-portal` keeps the voice conversation away from them too.

## The alternatives

- **Keep timers and set them to zero.** That gets the admin questions on screen at once. But it can't express "only after Explore is on", and the log can't say why a question arrived.
- **Show dependent questions inside their parent's card.** That's closer to the real form. It needs cards with more than one field, which is `rfc-composed-cards.md`. Cues work with the four question types that exist, and a cue could later release a composed card instead.
- **Let the agent decide everything.** Give it the whole cue sheet and let it release whatever it thinks fits. That's flexible, but hard to predict, and the dependencies above are fixed rules that code handles better.
- **Keep the cue sheet in the agent's state, not in code.** This is needed for a host to edit it during a session. It's left for later, so the first version can stay a constant.

## Open questions

- **Where do cues released mid-session go?** If an answer releases a cue while the person is still in an earlier group, do its questions go to the end of their queue or straight after the current one? The admin dependencies read better straight after their parent. Perhaps a cue says which.
- **What if a releasing answer changes?** If Explore is turned off after "Explore mode" was released, the question stays in the log, since nothing is removed. It could be shown as "no longer applies" and skipped by Next.
- **Editing during a session.** Reordering, holding a cue back or releasing one early would each need a log entry, so the log still explains what happened.

## The decision

Not decided yet. A first slice would be:

- `Cue`, `Release` and `PLAYLIST` in `src/shared.ts`, replacing `SCHEDULE` and `HOST_QUESTIONS`;
- `#releaseCues()` with `start`, `time`, `answer` and `manual`;
- `cueId` and `reason` on `question` entries, shown in the log drawer;
- the admin setup cues above.

`topic`, `pause` and `finish` cues, and editing the cue sheet during a session, wait until that works.
