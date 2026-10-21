# RFC: Cards composed with json-render, and choices only one person can claim

Status: proposed

## The problem

Every card today is one of four hand-built question types: radio, checkbox, text and number. Two things don't fit that.

- **Cards with more than one field.** For example, "Pick your team colour and give your team a name" asks for a colour and a name together, with one Submit.
- **Choices that depend on other people.** Only one person in a group can have each colour. A colour someone has picked should grey out for everyone else straight away, even though nothing is recorded until they press Submit.

We also want an agent to be able to write cards like this later, on demand, without every new card shape needing new client code.

## The proposal

### Layout comes from json-render, behaviour from our own components

A card is a [json-render](https://github.com/vercel-labs/json-render) spec: a flat tree of elements drawn from a catalog we define. The catalog lists each component and its props as a Zod schema. A spec that doesn't fit the catalog fails validation instead of rendering.

The catalog starts small:

| Component                                                 | What it is                                                |
| --------------------------------------------------------- | --------------------------------------------------------- |
| `QuestionCard`                                            | The card frame and its prompt                             |
| `TextInput`, `NumberInput`, `RadioGroup`, `CheckboxGroup` | Today's four question types, as fields                    |
| `ClaimableChoice`                                         | Pick one option. Options someone else holds are disabled. |
| `SubmitButton`                                            | Submits the card's draft as one answer                    |

The colour card from above:

```json
{
  "root": "card",
  "elements": {
    "card": {
      "type": "QuestionCard",
      "props": { "prompt": "Pick your team colour and give your team a name" },
      "children": ["name", "color", "submit"]
    },
    "name": {
      "type": "TextInput",
      "props": {
        "label": "Team name",
        "value": { "$bindState": "/draft/name" }
      }
    },
    "color": {
      "type": "ClaimableChoice",
      "props": {
        "claim": "team-color",
        "options": ["red", "blue", "green", "amber"],
        "value": { "$bindState": "/draft/color" }
      }
    },
    "submit": { "type": "SubmitButton", "props": { "label": "Submit" } }
  }
}
```

The spec says what's on the card. The rule that only one person gets each colour isn't in the spec. It lives in `ClaimableChoice` and in the agent, so a spec, whether written by hand or by a model, can't get it wrong.

### The draft stays in the browser until Submit

json-render keeps the card's own state: what's been typed and picked so far, under `/draft`. Nothing goes to the log while someone is filling in the card. `SubmitButton` sends the whole draft as one answer.

### Claims are held by a shared agent

A rule that spans people can't be enforced in one person's browser. Two people clicking blue at the same moment would both think they'd won. Claims are held by a Durable Object shared by the group, `GroupAgent`. It handles one request at a time, so the first `hold()` for blue wins and the second is refused.

```ts
type Claim = {
  holder: string; // the holder's session id
  status: "held" | "confirmed";
  at: number;
};

// GroupAgent's state, synced to every participant
type GroupState = {
  claims: Record<string, Record<string, Claim>>; // claim name → option → claim
};
```

| Call                             | What it does                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `hold(claim, option)`            | Grants the option if nobody else holds it, and releases the caller's other hold on the same claim |
| `release(claim)`                 | Gives up the caller's hold                                                                        |
| `confirm(claim, option, holder)` | Makes a hold permanent. Only `ConversationAgent` calls this, on Submit.                           |

Each participant's client connects to `GroupAgent` with `useAgent`, as well as to their own `ConversationAgent`. `ClaimableChoice` reads the claims from the synced state and calls `hold()` when an option is picked. A refused `hold()` puts the picker back to its previous value.

Holds that nobody submits have to end:

- **Picking another option** releases the old hold.
- **Leaving** releases it: `GroupAgent` releases a session's holds when its last connection closes.
- **A timeout** releases it: each hold schedules its own expiry with `this.schedule()`, starting at 2 minutes. Picking again restarts it.

Holds aren't written to the log. Like the cost tally, they're live state, not events anyone acts on. The log records only what was submitted.

### Submitting appends one answer

`SubmitButton` calls `ConversationAgent.answer(questionId, draft)`. For each `ClaimableChoice` in the spec, the agent calls `GroupAgent.confirm()` first. If a confirm fails, because the hold expired and someone else took the option, nothing is appended and the card says so.

Otherwise it appends an ordinary `answer` entry:

```ts
// data-answer
{ value: { name: "Kestrel", color: "blue" }, skipped: false }
```

`AnswerValue` gains an object form, `Record<string, AnswerValue>`. `sameAnswer()` and `formatAnswer()` learn to compare and print it. Answering again is a revision, as it is today. A revision that changes the colour holds the new colour first, then releases the old one once the new answer is appended.

### Questions carry a spec

`Question` gains a variant:

```ts
| { id: string; type: "card"; spec: Spec; required: boolean; source: "schedule" | "host" | "agent" }
```

The catalog is defined in `src/shared.ts` so both sides use the same one. The server validates every spec against it before appending a `card` question, so a malformed spec, including one from a model, never reaches the log.

### Later: the agent writes cards

`catalog.prompt()` turns the catalog into a system prompt that lists the components, their props and their descriptions. The agent's question turn can then ask Gemini for a spec rather than a single question. Server-side validation already covers a spec the model gets wrong.

## The alternatives

- **More hand-built question types** (a `color-and-name` type). This is simpler for one card. But each new shape needs client code, and a model can't make a new one.
- **A2UI or OpenUI instead of json-render.** Either could draw these cards. Both would still need our own component and a shared agent for the claim rule, so neither removes the hard part. json-render's catalog is Zod schemas, as `QUESTION_SCHEMA` nearly is already, and it streams through the AI SDK message stream this example already uses. A2UI is the better fit if we need native renderers or want to show cards inside other agents' hosts.
- **The claim rule in json-render's state expressions** (`$cond` or `visible` over a list of taken colours). These expressions only see one browser's state, so they can't stop two people taking the same colour at once.
- **Claims in each person's own `ConversationAgent`.** Nobody else could see them. A rule that spans people needs one place that everyone's requests go through.
- **Claims in the log** (a `hold` entry per pick). The log would fill with holds that come and go, and a hold has nothing to do with what the person finally answered.
- **Claim on Submit only, with no holds.** This is simpler, and nothing has to expire. But two people can fill in the card with the same colour, and one of them finds out only at Submit. This is the fallback if holds turn out to be confusing.

## Open questions

- **Who is the group?** Today each session is its own Durable Object with one person in it. If the group is people in separate sessions, they need a way to join the same `GroupAgent`, such as a room code in the URL. That also decides what the host sees.
- **When does a colour grey out for others?** This RFC assumes as soon as someone picks it. The other choice is only once they submit, which is the "claim on Submit only" alternative above.
- **Do custom components bind cleanly?** We haven't checked how a custom json-render component writes to a `$bindState` value. `ClaimableChoice` depends on it.

## The decision

Not decided yet. A first slice would be:

- the catalog, the `card` question type and `SubmitButton`, with a hand-written spec on the schedule;
- the object form of `AnswerValue`;
- `GroupAgent` with `hold`, `release`, `confirm` and the timeout, and `ClaimableChoice`.

Cards written by the agent wait until hand-written cards work.
