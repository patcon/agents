// Asks Vertex which Gemini TTS models each location serves, and what audio
// they send back, then writes what it finds to src/vertex-tts-models.ts.
// The Gemini API serves its own set of models, so it isn't probed here.
//
//   pnpm probe-vertex-tts [project]
//
// The project defaults to GOOGLE_CLOUD_PROJECT, then gcloud's. The token
// comes from GOOGLE_ACCESS_TOKEN, or gcloud. Vertex's model catalog leaves
// some TTS models out, so this calls each one instead of listing them.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// What the probe can't find out, from the Gemini API docs:
// https://ai.google.dev/gemini-api/docs/deprecations
const MODELS = [
  { id: "gemini-3.8-flash-tts", status: "stable" },
  { id: "gemini-3.8-flash-lite-tts", status: "stable" },
  {
    id: "gemini-3.1-flash-tts-preview",
    status: "preview",
    shutdown: "2026-11-17"
  },
  { id: "gemini-2.5-flash-tts", status: "stable" },
  { id: "gemini-2.5-pro-tts", status: "stable" },
  { id: "gemini-2.5-flash-lite-preview-tts", status: "preview" }
];

const LOCATIONS = [
  "global",
  "us-central1",
  "us-east1",
  "us-east4",
  "us-east5",
  "us-south1",
  "us-west1",
  "us-west4",
  "northamerica-northeast1",
  "southamerica-east1",
  "europe-west1",
  "europe-west2",
  "europe-west3",
  "europe-west4",
  "europe-west8",
  "europe-west9",
  "europe-north1",
  "europe-southwest1",
  "europe-central2",
  "asia-northeast1",
  "asia-northeast3",
  "asia-south1",
  "asia-southeast1",
  "australia-southeast1",
  "me-central1"
];

const gcloud = (...args) =>
  execFileSync("gcloud", args, { encoding: "utf8" }).trim();
const project =
  process.argv[2] ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  gcloud("config", "get-value", "project");
const token =
  process.env.GOOGLE_ACCESS_TOKEN || gcloud("auth", "print-access-token");

const host = (location) =>
  location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;

function call(model, location, method, text) {
  const query = method === "streamGenerateContent" ? "?alt=sse" : "";
  return fetch(
    `https://${host(location)}/v1beta1/projects/${project}/locations/${location}/publishers/google/models/${model}:${method}${query}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
          }
        }
      })
    }
  );
}

/** The mime type the model answers `generateContent` with, or null if not served. */
async function probeUnary(model, location) {
  const resp = await call(model, location, "generateContent", "Hi.");
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(
      `${model} in ${location}: ${resp.status} ${await resp.text()}`
    );
  }
  const json = await resp.json();
  return json.candidates[0].content.parts[0].inlineData.mimeType;
}

/** The streamed mime type, and how long the first audio took. */
async function probeStream(model, location) {
  const start = Date.now();
  const resp = await call(
    model,
    location,
    "streamGenerateContent",
    "What matters most to you about public transport in this city?"
  );
  if (!resp.ok) throw new Error(`${model} stream: ${resp.status}`);
  const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`${model} streamed no audio`);
    buffered += value;
    const match = buffered.match(/"mimeType":\s*"([^"]+)"/);
    if (match) {
      reader.cancel();
      return { mimeType: match[1], firstAudioMs: Date.now() - start };
    }
  }
}

const sampleRate = (mimeType) =>
  Number(/rate=(\d+)/.exec(mimeType)?.[1]) || null;

const results = [];
for (const model of MODELS) {
  const unary = await Promise.all(
    LOCATIONS.map(async (location) => ({
      location,
      mimeType: await probeUnary(model.id, location)
    }))
  );
  const served = unary.filter((u) => u.mimeType);
  if (served.length === 0) {
    console.log(`${model.id}: not served`);
    continue;
  }
  const stream = await probeStream(model.id, served[0].location);
  const result = {
    ...model,
    locations: served.map((u) => u.location),
    audio: {
      generateContent: served[0].mimeType,
      streamGenerateContent: stream.mimeType
    },
    sampleRate: sampleRate(stream.mimeType),
    firstAudioMs: stream.firstAudioMs
  };
  results.push(result);
  console.log(
    `${model.id}: ${result.locations.join(", ")} | ${result.audio.generateContent} | ${result.audio.streamGenerateContent} | first audio ${result.firstAudioMs} ms`
  );
}

const checked = new Date().toISOString().slice(0, 10);
const entries = results
  .map((r) => {
    const model = {
      status: r.status,
      ...(r.shutdown ? { shutdown: r.shutdown } : {}),
      locations: r.locations,
      audio: r.audio,
      sampleRate: r.sampleRate,
      firstAudioMs: r.firstAudioMs
    };
    return `"${r.id}": ${JSON.stringify(model)}`;
  })
  .join(",\n");

const file = fileURLToPath(
  new URL("../src/vertex-tts-models.ts", import.meta.url)
);
writeFileSync(
  file,
  `/**
 * Gemini TTS models on Vertex AI, as \`scripts/probe-vertex-tts.mjs\` found
 * them on ${checked}. Regenerate with \`pnpm probe-vertex-tts\`; don't edit
 * by hand. The Gemini API serves a different set.
 */

export interface VertexTTSModel {
  /** \`shutdown\` is when Google retires it, from the Gemini API docs. */
  status: "stable" | "preview";
  shutdown?: string;
  /** Vertex locations that served it, \`global\` first when it does. */
  locations: string[];
  /** The mime types it answered each method with. */
  audio: { generateContent: string; streamGenerateContent: string };
  sampleRate: number;
  /** From one streamed sentence, so only a rough guide. */
  firstAudioMs: number;
}

export const VERTEX_TTS_MODELS_CHECKED = "${checked}";

export const VERTEX_TTS_MODELS: Record<string, VertexTTSModel> = {
${entries}
};
`
);
// The workspace's formatter, so a regenerated file only differs in its data.
execFileSync("pnpm", ["-w", "exec", "oxfmt", file], { stdio: "inherit" });
console.log(`Wrote src/vertex-tts-models.ts (${results.length} models)`);
