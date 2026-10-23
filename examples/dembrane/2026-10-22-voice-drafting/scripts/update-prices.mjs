// Writes src/models/prices.json for the models set in wrangler.jsonc. Today's
// Vertex AI rate comes from LiteLLM, which lists every model we use;
// announced changes after today come from pydantic/genai-prices, which
// dates them. It reads genai-prices' Google YAML rather than their published
// package, which lags it.
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

const LITELLM =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const GENAI_PRICES =
  "https://raw.githubusercontent.com/pydantic/genai-prices/main/prices/providers/google.yml";

// Which model each var names, and whether its input is audio.
const MODELS = {
  STT_MODEL: { audio: true },
  AGENT_MODEL: { audio: false },
  DRAFT_MODEL: { audio: false },
  COMPILE_MODEL: { audio: false }
};

const today = new Date().toISOString().slice(0, 10);

const wrangler = readFileSync("wrangler.jsonc", "utf8");
const wanted = Object.entries(MODELS).map(([name, { audio }]) => {
  const id = wrangler.match(new RegExp(`"${name}":\\s*"([^"]+)"`))?.[1];
  if (!id) throw new Error(`${name} isn't set in wrangler.jsonc`);
  return { id, audio };
});

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}
const [litellm, genaiPrices] = await Promise.all([
  get(LITELLM).then(JSON.parse),
  get(GENAI_PRICES).then(parse)
]);

// --- Today's rate, from LiteLLM (USD per token) ---

const perMillion = (perToken) => +(perToken * 1e6).toPrecision(6);

function currentRate(id, audio) {
  const entry = litellm[`vertex_ai/${id}`];
  if (!entry) return undefined;
  const input = audio
    ? (entry.input_cost_per_audio_token ?? entry.input_cost_per_token)
    : entry.input_cost_per_token;
  return {
    input: perMillion(input),
    output: perMillion(entry.output_cost_per_token)
  };
}

// --- Dated rates, from genai-prices (USD per million tokens) ---

/** genai-prices' match rules, as used in their provider files. */
function matches(rule, id) {
  if (rule.or) return rule.or.some((r) => matches(r, id));
  if (rule.and) return rule.and.every((r) => matches(r, id));
  if ("equals" in rule) return id === rule.equals;
  if ("starts_with" in rule) return id.startsWith(rule.starts_with);
  if ("ends_with" in rule) return id.endsWith(rule.ends_with);
  if ("contains" in rule) return id.includes(rule.contains);
  if ("regex" in rule) return new RegExp(rule.regex).test(id);
  throw new Error(`Unknown match rule: ${JSON.stringify(rule)}`);
}

// A tiered price (by context length) is priced at its base tier.
const base = (price) => (typeof price === "object" ? price.base : price);

function datedRates(id, audio) {
  const model = genaiPrices.models.find((m) => matches(m.match, id));
  if (!model) return undefined;
  const entries = Array.isArray(model.prices)
    ? model.prices
    : [{ prices: model.prices }];
  return entries.flatMap(({ constraint, prices }) => {
    // Time-of-day discounts and the like don't apply to a running tally.
    if (constraint && !constraint.start_date) return [];
    const input = audio
      ? (prices.input_audio_mtok ?? prices.input_mtok)
      : prices.input_mtok;
    return [
      {
        ...(constraint && { from: String(constraint.start_date) }),
        input: base(input),
        output: base(prices.output_mtok)
      }
    ];
  });
}

// --- Both together ---

const models = {};
for (const { id, audio } of wanted) {
  const current = currentRate(id, audio);
  const dated = datedRates(id, audio);
  if (!current) {
    console.warn(`${id}: not in LiteLLM, so it won't be priced`);
    continue;
  }
  if (!dated) console.warn(`${id}: not in genai-prices, so no dated changes`);

  // genai-prices' rate for today, to catch either source going stale.
  const theirs = dated?.filter((r) => !r.from || r.from <= today).at(-1);
  if (
    theirs &&
    (theirs.input !== current.input || theirs.output !== current.output)
  ) {
    console.warn(
      `${id}: LiteLLM says ${current.input}/${current.output}, genai-prices says ${theirs.input}/${theirs.output}; using LiteLLM's`
    );
  }

  models[id] = [current, ...(dated ?? []).filter((r) => r.from > today)];
  console.log(id, models[id]);
}

writeFileSync(
  "src/models/prices.json",
  `${JSON.stringify({ sources: [LITELLM, GENAI_PRICES], fetched: today, models }, null, 2)}\n`
);
console.log("Wrote src/models/prices.json");
