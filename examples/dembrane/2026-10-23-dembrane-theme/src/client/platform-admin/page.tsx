// /platform-admin: edit a playbook, compile it, see how the plan would
// change, and have new sessions in this browser use it. A demo of
// compilePlaybook() in the UI, so it needn't be run as a script; to be removed.
// The plan it swaps in lives in localStorage, and the session page passes it
// to open(), so nothing is shared between browsers.

import { useMemo, useState, type ReactNode } from "react";
import { Badge, Button, Surface, Text } from "@cloudflare/kumo";
import type { Compiled } from "../../compile/compile";
import { comparePlans } from "../../compile/compare-plans";
import { PlanSchema, type Plan } from "../../plan/plan";
import { readActive, writeActive, type Active } from "./plan-storage";
import adminSetup from "../../plan/admin-setup.json";
import decompiledPlaybook from "../../compile/playbooks/admin-setup.decompiled.md?raw";

const FILE_PLAN = PlanSchema.parse(adminSetup);

// --- A line diff, by longest common subsequence ---

type Line = { op: " " | "-" | "+"; text: string };

function lineDiff(a: string[], b: string[]): Line[] {
  // lcs[i][j]: how long the common run of a[i..] and b[j..] is
  const lcs = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const lines: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ op: " ", text: a[i++] });
      j++;
    } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      lines.push({ op: "-", text: a[i++] });
    } else {
      lines.push({ op: "+", text: b[j++] });
    }
  }
  return lines;
}

const CONTEXT = 3;

/** A plan's JSON lines, without `$schema`, which only the file has. */
function jsonLines(plan: Plan) {
  const { $schema: _, ...rest } = plan as Plan & { $schema?: string };
  return JSON.stringify(rest, null, 2).split("\n");
}

function JsonDiff({ from, to }: { from: Plan; to: Plan }) {
  const lines = useMemo(
    () => lineDiff(jsonLines(from), jsonLines(to)),
    [from, to]
  );
  if (lines.every((l) => l.op === " ")) {
    return <Text size="xs" variant="secondary">The JSON is the same.</Text>;
  }
  // Unchanged lines more than CONTEXT away from a change fold away.
  const near = lines.map((_, i) =>
    lines
      .slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1)
      .some((l) => l.op !== " ")
  );
  const rows: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!near[i]) {
      let end = i;
      while (end < lines.length && !near[end]) end++;
      rows.push(
        <div key={i} className="text-kumo-subtle">
          {`  … ${end - i} unchanged lines`}
        </div>
      );
      i = end - 1;
      continue;
    }
    const { op, text } = lines[i];
    rows.push(
      <div
        key={i}
        className={
          op === "+"
            ? "bg-kumo-success-tint"
            : op === "-"
              ? "bg-kumo-danger-tint"
              : undefined
        }
      >
        {`${op} ${text}`}
      </div>
    );
  }
  return (
    <pre className="text-xs leading-5 overflow-x-auto rounded-lg ring ring-kumo-line p-3">
      {rows}
    </pre>
  );
}

// --- The page ---

type Result = (Compiled & { ms: number }) | { error: string };

export function PlatformAdmin() {
  const [active, setActive] = useState(readActive);
  const [markdown, setMarkdown] = useState(
    () => active?.playbook ?? decompiledPlaybook
  );
  const [compiling, setCompiling] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const current = active?.plan ?? FILE_PLAN;

  const save = (next: Active | null) => {
    writeActive(next);
    setActive(next);
  };

  const compile = async () => {
    setCompiling(true);
    setResult(null);
    try {
      const res = await fetch("/api/compile-playbook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown })
      });
      setResult(await res.json());
    } catch (error) {
      setResult({ error: String(error) });
    } finally {
      setCompiling(false);
    }
  };

  const compiled = result && "plan" in result ? result.plan : undefined;
  const differences = useMemo(
    () => (compiled ? comparePlans(current, compiled) : []),
    [current, compiled]
  );

  return (
    <div className="min-h-full bg-kumo-base text-kumo-default">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 flex flex-col gap-6">
        <header className="flex flex-wrap items-center gap-3">
          <Text as="h1" size="lg" bold>
            Platform admin
          </Text>
          <span className="mr-auto" />
          {active ? (
            <>
              <Badge variant="warning">
                New sessions here use a compiled plan (
                {new Date(active.at).toLocaleTimeString()})
              </Badge>
              <Button variant="secondary" size="sm" onClick={() => save(null)}>
                Reset to file
              </Button>
            </>
          ) : (
            <Badge variant="secondary">
              Sessions use src/plan/admin-setup.json
            </Badge>
          )}
          <a href="/" className="text-sm text-kumo-brand">
            New session →
          </a>
        </header>

        <Surface className="rounded-xl ring ring-kumo-line p-4 flex flex-col gap-3">
          <Text size="sm" variant="secondary">
            Playbook
          </Text>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            spellCheck={false}
            rows={20}
            className="w-full font-mono text-xs leading-5 rounded-lg ring ring-kumo-line bg-kumo-base p-3"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={compile}
              disabled={compiling || !markdown.trim()}
            >
              {compiling ? "Compiling… (about 20 s)" : "Compile"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setMarkdown(decompiledPlaybook)}
              disabled={compiling || markdown === decompiledPlaybook}
            >
              Back to the file's playbook
            </Button>
          </div>
        </Surface>

        {result && "error" in result && (
          <Surface className="rounded-xl ring ring-kumo-line p-4">
            <Text size="sm">Compiling failed: {result.error}</Text>
          </Surface>
        )}

        {result && !("error" in result) && (
          <Surface className="rounded-xl ring ring-kumo-line p-4 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={compiled ? "success" : "warning"}>
                {compiled ? "Compiled" : "Gave up"}
              </Badge>
              <Text size="xs" variant="secondary">
                {result.attempts.length} attempt
                {result.attempts.length === 1 ? "" : "s"} ·{" "}
                {(result.ms / 1000).toFixed(1)} s ·{" "}
                {result.usage.inputTokens.toLocaleString()} in /{" "}
                {result.usage.outputTokens.toLocaleString()} out tokens
              </Text>
              <span className="mr-auto" />
              {compiled && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    save({ plan: compiled, playbook: markdown, at: Date.now() })
                  }
                >
                  Use this plan
                </Button>
              )}
            </div>

            {result.messages.length > 0 && (
              <ul className="text-xs flex flex-col gap-1">
                {result.messages.map((m, i) => (
                  <li key={i}>
                    {m.severity} {m.rule}: {m.itemId ? `${m.itemId}: ` : ""}
                    {m.message}
                  </li>
                ))}
              </ul>
            )}

            {compiled && (
              <>
                <div className="flex flex-col gap-2">
                  <Text size="sm" bold>
                    What a session would do differently
                  </Text>
                  {differences.length ? (
                    <ul className="text-xs flex flex-col gap-1">
                      {differences.map((d, i) => (
                        <li key={i}>
                          <Badge
                            variant={d.kind === "differs" ? "warning" : "outline"}
                          >
                            {d.kind}
                          </Badge>{" "}
                          <span className="font-mono">{d.where}</span>:{" "}
                          {d.message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Text size="xs" variant="secondary">
                      Nothing: it asks the same questions, in the same way.
                    </Text>
                  )}
                </div>
                <details className="flex flex-col gap-2">
                  <summary className="cursor-pointer text-sm">
                    Raw JSON diff, against the plan in use{" "}
                    <span className="text-xs text-kumo-subtle">
                      (ids and card element names are the compiler's own pick,
                      so they differ even when nothing above does)
                    </span>
                  </summary>
                  <div className="pt-2">
                    <JsonDiff from={current} to={compiled} />
                  </div>
                </details>
              </>
            )}
          </Surface>
        )}
      </div>
    </div>
  );
}
