import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compilePlaybook, fillTemplate, type Generate } from "../src/compile/compile";
import { comparePlans } from "../src/compile/compare-plans";
import { PlanSchema, type Plan } from "../src/plan/plan";

const handMade = PlanSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../src/plan/admin-setup.json", import.meta.url),
      "utf8"
    )
  )
);
const prompt = (name: string) =>
  readFileSync(new URL(`../src/compile/prompts/${name}.md`, import.meta.url), "utf8");
const prompts = {
  system: prompt("compile-playbook"),
  retry: prompt("compile-playbook-retry")
};
const copy = (): Plan => structuredClone(handMade);
const usage = { inputTokens: 10, outputTokens: 5 };

/** A model that gives these answers in turn, and records what it was asked. */
function stub(...answers: unknown[]) {
  const requests: Parameters<Generate>[0][] = [];
  const generate: Generate = async (request) => {
    requests.push(structuredClone(request));
    return { json: answers[requests.length - 1], usage };
  };
  return { generate, requests };
}

describe("fillTemplate", () => {
  it("fills placeholders", () => {
    expect(fillTemplate("a {{x}} b", { x: "1" })).toBe("a 1 b");
  });
  it("throws when a placeholder has no value", () => {
    expect(() => fillTemplate("{{x}} {{y}}", { x: "1" })).toThrow("{{y}}");
  });
  it("throws when a value has no placeholder", () => {
    expect(() => fillTemplate("{{x}}", { x: "1", y: "2" })).toThrow("{{y}}");
  });
});

describe("compilePlaybook", () => {
  it("fills the settings into the system prompt", async () => {
    const { generate, requests } = stub(copy());
    await compilePlaybook("# Setup", { name: "setup", prompts, generate });
    expect(requests[0].system).toContain("- is_get_reply_enabled:");
    expect(requests[0].system).not.toContain("{{");
  });

  it("sends errors back, and returns the first clean plan", async () => {
    const noConsent = copy();
    noConsent.items = noConsent.items.filter((i) => i.kind !== "consent");
    noConsent.triggers = noConsent.triggers.filter((t) => t.cue !== "consent");
    const { generate, requests } = stub(noConsent, copy());

    const result = await compilePlaybook("# Setup", {
      name: "setup",
      prompts,
      generate
    });

    expect(result.plan).toBeDefined();
    expect(result.attempts).toHaveLength(2);
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    const retry = requests[1].prompt;
    expect(retry.map((t) => t.role)).toEqual(["user", "model", "user"]);
    expect(retry[2].text).toContain("one-consent");
  });

  it("sends Zod's objections back too", async () => {
    const { generate, requests } = stub({ schemaVersion: 1 }, copy());
    const result = await compilePlaybook("# Setup", {
      name: "setup",
      prompts,
      generate
    });
    expect(result.attempts[0].messages[0].rule).toBe("schema");
    expect(requests[1].prompt[2].text).toContain("schema:");
  });

  it("gives up after maxAttempts with the last errors", async () => {
    const { generate } = stub({}, {});
    const result = await compilePlaybook("# Setup", {
      name: "setup",
      prompts,
      generate,
      maxAttempts: 2
    });
    expect(result.plan).toBeUndefined();
    expect(result.attempts).toHaveLength(2);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("names the playbook and hashes its text as the version", async () => {
    const a = await compilePlaybook("one", {
      name: "setup",
      prompts,
      generate: stub(copy()).generate
    });
    const b = await compilePlaybook("two", {
      name: "setup",
      prompts,
      generate: stub(copy()).generate
    });
    expect(a.plan?.source.playbook).toBe("setup");
    expect(a.plan?.source.version).toMatch(/^[0-9a-f]{8}$/);
    expect(a.plan?.source.version).not.toBe(b.plan?.source.version);
  });
});

describe("comparePlans", () => {
  it("finds nothing between a plan and itself", () => {
    expect(comparePlans(handMade, copy())).toEqual([]);
  });

  it("ignores ids, order strings and how triggers are split up", () => {
    const plan = copy();
    // Rename the "features" section, and give its children new order strings
    for (const item of plan.items) {
      if (item.id === "features") item.id = "participant-features";
      if (item.parentId === "features") {
        item.parentId = "participant-features";
        item.order = `b${item.order}`;
      }
    }
    // Cue each untriggered child of "basics" on consent, instead of the section
    plan.triggers = plan.triggers.flatMap((t) => {
      if (t.cue === "features") return [{ ...t, cue: "participant-features" }];
      if (t.cue !== "basics") return [t];
      const cued = new Set(plan.triggers.map((x) => x.cue));
      return plan.items
        .filter((i) => i.parentId === "basics" && !cued.has(i.id))
        .map((i) => ({ id: `consent:${i.id}`, when: t.when, cue: i.id }));
    });
    expect(plan.triggers.some((t) => t.cue === "basics")).toBe(false);
    expect(comparePlans(handMade, plan)).toEqual([]);
  });

  it("reports a rewording apart from a difference", () => {
    const plan = copy();
    const tags = plan.items.find((i) => i.id === "tags")!;
    if (tags.kind === "prompt") tags.payload.question.prompt = "Which tags?";
    expect(comparePlans(handMade, plan)).toEqual([
      {
        kind: "reworded",
        where: "tags",
        message: expect.stringContaining("Which tags?")
      }
    ]);
  });

  it("reports different options, a missing prompt, and a different release", () => {
    const plan = copy();
    const mode = plan.items.find((i) => i.id === "get_reply_mode")!;
    if (mode.kind === "prompt")
      mode.payload.question.options = ["Summarize", "Custom"];
    plan.items = plan.items.filter((i) => i.id !== "tags");
    plan.triggers = plan.triggers.filter(
      (t) => t.cue !== "conversation_title_prompt"
    );

    const found = comparePlans(handMade, plan).map(
      (d) => `${d.where}: ${d.message}`
    );
    expect(found).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^tags: missing/),
        expect.stringMatching(/^get_reply_mode: options/),
        expect.stringMatching(/^conversation_title_prompt: released by/)
      ])
    );
  });
});
