import type { CardSpec } from "../cards/cards";
import { flatten, type Condition, type Plan, type PlanItem } from "../plan/plan";

// How far one plan is from another: a compiled plan from the hand-made one
// it should reconstruct. Items are matched by what they mean, not by id:
// prompts by key, sections by title. What decides closeness is what a
// session would do: which questions are asked, where, with what options, and
// what releases each one. Ids, `order` strings and how triggers are split
// up don't count; neither does wording, which is reported apart.

export type Difference = {
  /** `differs` changes what a session does; `reworded` only what it says. */
  kind: "differs" | "reworded";
  /** The item it's about, by key or section title. */
  where: string;
  message: string;
};

type Prompt = Extract<PlanItem, { kind: "prompt" }>;

/** An item by what it means, which holds across plans. */
function label(plan: Plan, id: string): string {
  const item = plan.items.find((i) => i.id === id);
  if (!item) return `missing item "${id}"`;
  switch (item.kind) {
    case "prompt":
      return item.payload.key;
    case "section":
      return `section "${item.payload.title}"`;
    case "consent":
      return "consent";
    case "discussion":
      return `discussion "${item.payload.title}"`;
    case "phoneActivity":
      return `activity "${item.payload.activity}"`;
    case "break":
      return `break "${item.payload.title ?? ""}"`;
  }
}

/** JSON with sorted keys, so equal values print the same. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
        )
      : v
  );
}

/** A card as a tree, without the element keys a writer picks freely. */
function cardTree(card: CardSpec | undefined): unknown {
  if (!card) return undefined;
  const walk = (key: string): unknown => {
    const element = card.elements[key];
    if (!element) return `missing element "${key}"`;
    return {
      type: element.type,
      props: element.props,
      children: (element.children ?? []).map(walk)
    };
  };
  return walk(card.root);
}

/** A condition with item ids swapped for labels. */
function conditionText(plan: Plan, condition: Condition): string {
  switch (condition.kind) {
    case "any":
      return `any(${condition.of
        .map((c) => conditionText(plan, c))
        .sort()
        .join(", ")})`;
    case "answered":
    case "relative":
      return canonical({ ...condition, item: label(plan, condition.item) });
    default:
      return canonical(condition);
  }
}

/**
 * What releases each item: its own triggers, or else whatever releases the
 * section it's in. Several triggers on one item release it when any holds.
 */
function releases(plan: Plan): Map<string, string> {
  const byId = new Map(plan.items.map((item) => [item.id, item]));
  const own = (id: string) =>
    plan.triggers
      .filter((t) => t.cue === id)
      .map((t) => conditionText(plan, t.when))
      .sort();
  const release = (id: string): string => {
    const conditions = own(id);
    if (conditions.length) return conditions.join(" or ");
    const parentId = byId.get(id)?.parentId;
    return parentId === undefined ? "nothing" : release(parentId);
  };
  return new Map(
    flatten(plan)
      .filter((item) => item.kind !== "section")
      .map((item) => [label(plan, item.id), release(item.id)])
  );
}

function sectionOf(plan: Plan, item: PlanItem) {
  return item.parentId === undefined
    ? "the top level"
    : label(plan, item.parentId);
}

export function comparePlans(expected: Plan, actual: Plan): Difference[] {
  const differences: Difference[] = [];
  const differs = (where: string, message: string) =>
    differences.push({ kind: "differs", where, message });

  const prompts = (plan: Plan) =>
    new Map(
      flatten(plan)
        .filter((item): item is Prompt => item.kind === "prompt")
        .map((item) => [item.payload.key, item])
    );
  const want = prompts(expected);
  const got = prompts(actual);

  for (const key of want.keys()) if (!got.has(key)) differs(key, "missing");
  for (const key of got.keys())
    if (!want.has(key)) differs(key, "not in the expected plan");

  const sections = (plan: Plan) =>
    plan.items
      .filter((i) => i.kind === "section")
      .map((i) => label(plan, i.id));
  const wantSections = sections(expected);
  const gotSections = sections(actual);
  for (const s of wantSections)
    if (!gotSections.includes(s)) differs(s, "missing");
  for (const s of gotSections)
    if (!wantSections.includes(s)) differs(s, "not in the expected plan");

  for (const [key, a] of want) {
    const b = got.get(key);
    if (!b) continue;
    const [qa, qb] = [a.payload.question, b.payload.question];
    const compare = (what: string, x: unknown, y: unknown) => {
      if (canonical(x) !== canonical(y)) {
        differs(
          key,
          `${what}: expected ${canonical(x) ?? "none"}, got ${canonical(y) ?? "none"}`
        );
      }
    };
    compare("section", sectionOf(expected, a), sectionOf(actual, b));
    // Each type has its own fields; one another type lacks reads as absent.
    const field = (q: typeof qa, name: string) =>
      (q as Record<string, unknown>)[name];
    compare("type", qa.type, qb.type);
    for (const name of ["options", "min", "max"]) {
      compare(name, field(qa, name), field(qb, name));
    }
    compare("length", field(qa, "length") ?? "long", field(qb, "length") ?? "long");
    compare("required", qa.required, qb.required);
    compare("assess", field(qa, "assess") ?? true, field(qb, "assess") ?? true);
    compare("dictate", field(qa, "dictate") ?? true, field(qb, "dictate") ?? true);
    compare("card", cardTree(a.payload.card), cardTree(b.payload.card));
    if (qa.prompt.trim() !== qb.prompt.trim()) {
      differences.push({
        kind: "reworded",
        where: key,
        message: `"${qa.prompt}" → "${qb.prompt}"`
      });
    }
    // Hints are prose, like the prompt: having them or not is what counts.
    const [ha, hb] = [field(qa, "draftHints"), field(qb, "draftHints")];
    if ((ha === undefined) !== (hb === undefined)) {
      compare("draftHints", ha, hb);
    } else if (String(ha).trim() !== String(hb).trim()) {
      differences.push({
        kind: "reworded",
        where: key,
        message: `draftHints "${ha}" → "${hb}"`
      });
    }
  }

  // Reading order, over the prompts both plans have
  const order = (plan: Map<string, Prompt>, other: Map<string, Prompt>) =>
    [...plan.keys()].filter((key) => other.has(key));
  const wantOrder = order(want, got);
  const gotOrder = order(got, want);
  if (wantOrder.join() !== gotOrder.join()) {
    differs(
      "order",
      `expected ${wantOrder.join(", ")}; got ${gotOrder.join(", ")}`
    );
  }

  const wantReleases = releases(expected);
  const gotReleases = releases(actual);
  for (const [where, release] of wantReleases) {
    const other = gotReleases.get(where);
    if (other !== undefined && other !== release) {
      differs(where, `released by ${other}, expected ${release}`);
    }
  }
  if (wantReleases.has("consent") && !gotReleases.has("consent")) {
    differs("consent", "missing");
  }

  return differences;
}
