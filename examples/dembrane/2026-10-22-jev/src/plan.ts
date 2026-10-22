import { z } from "zod";
import { CONSENT, CardSpecSchema, cardIssues } from "./cards.ts";
import type { AnswerValue, Question } from "./shared";

// A plan is what a markdown playbook compiles to: a flat, typed list of
// sections and items, plus the triggers that cue them. It's the rigid form
// the runtime walks through and the linter checks. The playbook stays
// freeform; anything it can't express here has to be compiled away.
//
// The Zod schemas below are the one definition. The TypeScript types are
// inferred from them, and `pnpm check-plans` writes them out as
// src/plan.schema.json for anything that isn't TypeScript (an LLM's
// structured output, the platform, an editor).
//
// A schema can only say a plan has the right shape. Whether it makes sense
// (consent first, triggers cue items that exist) is `lintPlan()`'s job.

// --- Primitives ---

const WallTime = z.iso.datetime({ offset: true });
const Seconds = z.number().describe('Negative offsets mean "before"');

// --- Questions ---
//
// What a prompt shows, matching `Question` in shared.ts without the fields
// the server fills in when it's asked.

const AnswerValueSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.number(),
  z.null()
]);

const QuestionSpecSchema = z.strictObject({
  type: z.enum(["radio", "checkbox", "text", "number"]),
  prompt: z.string().min(1),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  required: z.boolean()
});

// --- Items ---

const ItemBase = z.strictObject({
  id: z.string().min(1),
  order: z
    .string()
    .min(1)
    .describe("Fractional index: sorts as a string among siblings"),
  parentId: z
    .string()
    .optional()
    .describe("The section this item sits in. Top level when absent."),
  duration: z
    .strictObject({
      pref: Seconds,
      min: Seconds.optional(),
      max: Seconds.optional().describe("Also caps extends")
    })
    .optional()
    .describe("Self-paced items leave this out"),
  anchor: z
    .strictObject({ start: WallTime.optional(), end: WallTime.optional() })
    .optional()
    .describe("Anchors are hard"),
  locked: z
    .boolean()
    .optional()
    .describe("The host can't remove it, during setup or live")
});

export const PlanItemSchema = z.discriminatedUnion("kind", [
  ItemBase.extend({
    kind: z.literal("section"),
    payload: z.strictObject({ title: z.string().min(1) })
  }),
  ItemBase.extend({ kind: z.literal("consent") }).describe(
    "The platform's consent card. A plan places it but can't change it."
  ),
  ItemBase.extend({
    kind: z.literal("discussion"),
    payload: z.strictObject({
      title: z.string().min(1),
      guide: z
        .string()
        .describe("For the agent: what to talk through, not what to say")
    })
  }),
  ItemBase.extend({
    kind: z.literal("prompt"),
    payload: z.strictObject({
      key: z
        .string()
        .min(1)
        .describe(
          "The setting the answer writes, and how conditions refer to it"
        ),
      question: QuestionSpecSchema,
      card: CardSpecSchema.optional().describe(
        "How the question is shown, as a json-render spec. A default card for its type when absent."
      ),
      assess: z
        .boolean()
        .optional()
        .describe(
          "False keeps Jev from judging which options were said. Judged when absent."
        )
    })
  }),
  ItemBase.extend({
    kind: z.literal("phoneActivity"),
    payload: z.strictObject({
      activity: z.string().min(1),
      config: z.record(z.string(), z.unknown()).optional()
    })
  }),
  ItemBase.extend({
    kind: z.literal("break"),
    payload: z.strictObject({ title: z.string().optional() })
  })
]);

export type PlanItem = z.infer<typeof PlanItemSchema>;
export type ItemKind = PlanItem["kind"];

// --- Triggers ---

export const ConditionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("start") }).describe("The session starts"),
  z.strictObject({ kind: z.literal("wall"), at: WallTime }),
  z
    .strictObject({
      kind: z.literal("relative"),
      item: z.string(),
      edge: z.enum(["start", "end"]),
      offset: Seconds
    })
    .describe("Resolves against the item's effective end"),
  z.strictObject({
    kind: z.literal("answer"),
    key: z.string(),
    equals: AnswerValueSchema
  }),
  z
    .strictObject({
      kind: z.literal("includes"),
      key: z.string(),
      option: z.string()
    })
    .describe("A checkbox answer has this option among those picked"),
  z
    .strictObject({ kind: z.literal("answered"), item: z.string() })
    .describe("Once the item's question is answered, whatever the answer; a skip doesn't count"),
  z
    .strictObject({ kind: z.literal("consented") })
    .describe("Recording is allowed: every option of the consent card is ticked"),
  z.strictObject({ kind: z.literal("manual") }).describe("The host cues it"),
  z.strictObject({
    kind: z.literal("any"),
    get of(): z.ZodArray<typeof ConditionSchema> {
      return z.array(ConditionSchema);
    }
  })
]);

export type Condition = z.infer<typeof ConditionSchema>;

export const TriggerSchema = z
  .strictObject({ id: z.string().min(1), when: ConditionSchema, cue: z.string() })
  .describe("Cueing a section cues every child that has no trigger of its own");

export type Trigger = z.infer<typeof TriggerSchema>;

export const PlanOpSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("insert"), item: PlanItemSchema }),
  z.strictObject({
    op: z.literal("update"),
    id: z.string(),
    patch: ItemBase.omit({ id: true })
      .partial()
      .extend({ payload: z.record(z.string(), z.unknown()).optional() })
  }),
  z.strictObject({ op: z.literal("remove"), id: z.string() }),
  z.strictObject({ op: z.literal("addTrigger"), trigger: TriggerSchema }),
  z.strictObject({ op: z.literal("removeTrigger"), id: z.string() })
]);

export type PlanOp = z.infer<typeof PlanOpSchema>;

export const PlanSchema = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: z.literal(1),
    source: z
      .strictObject({ playbook: z.string(), version: z.string() })
      .describe("The playbook this was compiled from, so a log can say which"),
    items: z.array(PlanItemSchema),
    triggers: z.array(TriggerSchema)
  })
  .meta({ title: "Plan", description: "A playbook, compiled" });

export type Plan = z.infer<typeof PlanSchema>;

// Fails to compile if the schemas drift from the types in shared.ts.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
true satisfies Same<z.infer<typeof AnswerValueSchema>, AnswerValue>;
true satisfies Same<
  z.infer<typeof QuestionSpecSchema>,
  Omit<Question, "id" | "source" | "card">
>;

// --- Releasing ---

/** What just happened, for deciding which triggers fire. */
export type PlanEvent = { kind: "start" } | { kind: "answer" };

/** Current answers, by prompt key. */
export type AnswersByKey = ReadonlyMap<string, AnswerValue>;

/** What's been answered so far, and not skipped. */
export type Answered = {
  /** Answers to prompts, by key. */
  byKey: AnswersByKey;
  /** Ids of every item whose question has an answer. */
  items: ReadonlySet<string>;
  /** Whether the consent card allows recording. */
  consented: boolean;
};

function sameValue(a: AnswerValue | undefined, b: AnswerValue) {
  const normalize = (value: AnswerValue | undefined) =>
    JSON.stringify(
      Array.isArray(value)
        ? [...value].sort()
        : typeof value === "string"
          ? value.trim()
          : value
    );
  return normalize(a) === normalize(b);
}

function holds(
  condition: Condition,
  event: PlanEvent,
  answered: Answered
): boolean {
  switch (condition.kind) {
    case "start":
      return event.kind === "start";
    case "answer":
      return (
        answered.byKey.has(condition.key) &&
        sameValue(answered.byKey.get(condition.key), condition.equals)
      );
    case "includes": {
      const value = answered.byKey.get(condition.key);
      return Array.isArray(value) && value.includes(condition.option);
    }
    case "answered":
      return answered.items.has(condition.item);
    case "consented":
      return answered.consented;
    case "any":
      return condition.of.some((c) => holds(c, event, answered));
    // Not yet: these need timers, or a host control.
    case "wall":
    case "relative":
    case "manual":
      return false;
  }
}

/**
 * The items that `event` releases, in reading order: those whose trigger now
 * holds, and the untriggered items in any section that's cued. Items in
 * `released` are left out, so each is released at most once.
 */
export function dueItems(
  plan: Plan,
  event: PlanEvent,
  answered: Answered,
  released: ReadonlySet<string>
): PlanItem[] {
  const triggered = new Set(plan.triggers.map((t) => t.cue));
  const due = new Set<string>();
  const cue = (id: string) => {
    due.add(id);
    for (const child of childrenOf(plan, id)) {
      if (!triggered.has(child.id)) cue(child.id);
    }
  };
  for (const trigger of plan.triggers) {
    if (holds(trigger.when, event, answered)) cue(trigger.cue);
  }
  return flatten(plan).filter(
    (item) => due.has(item.id) && !released.has(item.id)
  );
}

/**
 * The question an item shows, if it shows one. Its id is the item's id, so
 * the log says which item each question came from.
 */
export function questionFor(item: PlanItem): Question | undefined {
  switch (item.kind) {
    case "prompt":
      return {
        ...item.payload.question,
        id: item.id,
        card: item.payload.card,
        assess: item.payload.assess,
        source: "plan"
      };
    case "consent":
      return {
        id: item.id,
        type: "checkbox",
        prompt: CONSENT.prompt,
        options: ["Yes, I agree to be recorded"],
        // Not required, so it can be answered unticked: that's how consent
        // is declined, or taken back. Recording waits for the tick either way.
        required: false,
        card: CONSENT.card,
        // Ticked by hand: nothing is recorded until it is.
        assess: false,
        consent: true,
        source: "plan"
      };
    // Sections only group; the rest have no card yet.
    default:
      return undefined;
  }
}

// --- Lint ---

export type LintMessage = {
  rule: string;
  severity: "error" | "warning";
  message: string;
  itemId?: string;
};

/** Items under `parentId` (top level when undefined), in order. */
export function childrenOf(plan: Plan, parentId?: string) {
  return plan.items
    .filter((item) => item.parentId === parentId)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
}

/** Every item in reading order: depth first, siblings by `order`. */
export function flatten(plan: Plan, parentId?: string): PlanItem[] {
  return childrenOf(plan, parentId).flatMap((item) => [
    item,
    ...(item.kind === "section" ? flatten(plan, item.id) : [])
  ]);
}

function conditionsIn(condition: Condition): Condition[] {
  return condition.kind === "any"
    ? condition.of.flatMap(conditionsIn)
    : [condition];
}

/**
 * Check a plan before it runs, and after every live edit. Errors stop it
 * going live, and reject an edit that would introduce one.
 */
export function lintPlan(plan: Plan): LintMessage[] {
  const messages: LintMessage[] = [];
  const report = (
    rule: string,
    severity: LintMessage["severity"],
    message: string,
    itemId?: string
  ) => messages.push({ rule, severity, message, itemId });

  const byId = new Map<string, PlanItem>();
  for (const item of plan.items) {
    if (byId.has(item.id)) {
      report("unique-ids", "error", `"${item.id}" is used twice`, item.id);
    }
    byId.set(item.id, item);
  }

  for (const item of plan.items) {
    if (item.parentId === undefined) continue;
    const parent = byId.get(item.parentId);
    if (!parent) {
      report("parent-exists", "error", `parent "${item.parentId}" doesn't exist`, item.id);
    } else if (parent.kind !== "section") {
      report("parent-is-section", "error", `parent "${parent.id}" is a ${parent.kind}`, item.id);
    }
  }

  for (const item of plan.items) {
    const seen = new Set<string>();
    let parentId = item.parentId;
    while (parentId !== undefined && !seen.has(parentId)) {
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
    if (parentId === item.id) {
      report("no-cycles", "error", "it's inside itself", item.id);
    }
  }

  const ordered = flatten(plan);
  const position = new Map(ordered.map((item, index) => [item.id, index]));

  const consents = plan.items.filter((item) => item.kind === "consent");
  if (consents.length !== 1) {
    report("one-consent", "error", `expected one consent item, found ${consents.length}`);
  }
  for (const consent of consents) {
    if (ordered[0]?.id !== consent.id) {
      report("consent-first", "error", "consent must come before everything else", consent.id);
    }
    if (!consent.locked) {
      report("consent-locked", "error", "consent must be locked", consent.id);
    }
    for (const issue of cardIssues(CONSENT.card)) {
      report("card-valid", "error", `the platform's consent card: ${issue}`, consent.id);
    }
  }

  const prompts = new Map<string, Extract<PlanItem, { kind: "prompt" }>>();
  for (const item of plan.items) {
    if (item.kind !== "prompt") continue;
    if (prompts.has(item.payload.key)) {
      report("unique-keys", "error", `key "${item.payload.key}" is used twice`, item.id);
    }
    prompts.set(item.payload.key, item);
    const { type, options } = item.payload.question;
    if ((type === "radio" || type === "checkbox") && !options?.length) {
      report("choices-have-options", "error", `a ${type} prompt needs options`, item.id);
    }
    if (item.payload.card) {
      for (const issue of cardIssues(item.payload.card)) {
        report("card-valid", "error", issue, item.id);
      }
    }
  }

  for (const item of plan.items) {
    const d = item.duration;
    if (!d) continue;
    if ((d.min !== undefined && d.min > d.pref) || (d.max !== undefined && d.max < d.pref)) {
      report("duration-in-range", "error", "pref must be between min and max", item.id);
    }
  }

  const triggerIds = new Set<string>();
  const cued = new Set<string>();
  for (const trigger of plan.triggers) {
    if (triggerIds.has(trigger.id)) {
      report("unique-ids", "error", `trigger "${trigger.id}" is used twice`);
    }
    triggerIds.add(trigger.id);

    const target = byId.get(trigger.cue);
    if (!target) {
      report("trigger-target-exists", "error", `trigger "${trigger.id}" cues "${trigger.cue}", which doesn't exist`);
      continue;
    }
    cued.add(target.id);

    for (const condition of conditionsIn(trigger.when)) {
      if (condition.kind === "relative" && !byId.has(condition.item)) {
        report("condition-refers-to-item", "error", `trigger "${trigger.id}" waits on "${condition.item}", which doesn't exist`, target.id);
      }
      if (condition.kind === "answered") {
        const source = byId.get(condition.item);
        if (!source || questionFor(source) === undefined) {
          report("condition-refers-to-item", "error", `trigger "${trigger.id}" waits on an answer to "${condition.item}", which asks no question`, target.id);
        } else if ((position.get(source.id) ?? 0) > (position.get(target.id) ?? 0)) {
          report("condition-comes-first", "warning", `"${target.id}" comes before "${source.id}", the item it waits on`, target.id);
        }
      }
      // Consent comes first in time, not just in order: nothing else is
      // asked until it's answered.
      if (condition.kind === "start" && target.kind !== "consent") {
        report("consent-before-all", "error", `only consent can be cued at the start; "${target.id}" should wait for it`, target.id);
      }
      if (condition.kind !== "answer" && condition.kind !== "includes") continue;
      const source = prompts.get(condition.key);
      if (!source) {
        report("condition-refers-to-key", "error", `trigger "${trigger.id}" waits on key "${condition.key}", which no prompt has`, target.id);
        continue;
      }
      const { type, options } = source.payload.question;
      const option =
        condition.kind === "includes" ? condition.option : condition.equals;
      if (typeof option === "string" && options && !options.includes(option)) {
        report("condition-is-an-option", "error", `"${option}" isn't an option of "${condition.key}"`, target.id);
      }
      if (condition.kind === "includes" && type !== "checkbox") {
        report("includes-is-checkbox", "error", `trigger "${trigger.id}" checks what "${condition.key}" includes, but it's a ${type} prompt`, target.id);
      }
      if ((position.get(source.id) ?? 0) > (position.get(target.id) ?? 0)) {
        report("condition-comes-first", "warning", `"${target.id}" comes before "${source.id}", the prompt it depends on`, target.id);
      }
    }
  }

  // An item is reachable if it, or a section it sits in, is cued.
  const isCued = (item: PlanItem): boolean =>
    cued.has(item.id) ||
    (item.parentId !== undefined &&
      byId.has(item.parentId) &&
      isCued(byId.get(item.parentId)!));
  for (const item of ordered) {
    if (!isCued(item)) {
      report("reachable", "warning", "no trigger cues it or a section it's in", item.id);
    }
  }

  return messages;
}
