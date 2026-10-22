import {
  resolveAccessToken,
  serviceAccountToken,
  vertexHost,
  type VertexOptions
} from "@dembrane/voice-google";

export type TokenUsage = { inputTokens: number; outputTokens: number };

/** One turn of a conversation with the model, for asking again after an answer. */
export type Turn = { role: "user" | "model"; text: string };

/**
 * Vertex AI credentials: tokens from the service account key if it's set,
 * reused until they're about to expire, or else the fixed access token,
 * which lasts an hour. Throws if the project or both of those are unset.
 */
export function googleAccessToken(env: Env): VertexOptions["accessToken"] {
  if (!env.GOOGLE_CLOUD_PROJECT?.trim()) {
    throw new Error("GOOGLE_CLOUD_PROJECT isn't set");
  }
  if (env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim()) {
    return serviceAccountToken(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  }
  if (env.GOOGLE_ACCESS_TOKEN?.trim()) return env.GOOGLE_ACCESS_TOKEN;
  throw new Error(
    "Neither GOOGLE_SERVICE_ACCOUNT_KEY nor GOOGLE_ACCESS_TOKEN is set"
  );
}

/**
 * Asks a Gemini model on Vertex AI for an answer that fits a JSON schema, and
 * returns it parsed, with the tokens it used. `prompt` is the user's turn, or
 * the whole conversation so far. Throws on any failure, with Vertex's own
 * words where it gave some, and when `signal` aborts.
 */
export async function generateJson(
  env: Env,
  request: {
    model: string;
    system: string;
    prompt: string | Turn[];
    schema: object;
    temperature?: number;
    /** How much the model thinks first, e.g. "low"; its default when absent. */
    thinkingLevel?: string;
    signal?: AbortSignal;
  }
): Promise<{ json: unknown; usage: TokenUsage }> {
  const accessToken = await resolveAccessToken(
    googleAccessToken(env),
    "Gemini"
  );
  const location = "global";
  const url = `https://${vertexHost(location)}/v1beta1/projects/${env.GOOGLE_CLOUD_PROJECT}/locations/${location}/publishers/google/models/${request.model}:generateContent`;
  const turns =
    typeof request.prompt === "string"
      ? [{ role: "user", text: request.prompt }]
      : request.prompt;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: turns.map(({ role, text }) => ({ role, parts: [{ text }] })),
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: request.schema,
        temperature: request.temperature,
        thinkingConfig: request.thinkingLevel
          ? { thinkingLevel: request.thinkingLevel }
          : undefined
      }
    }),
    signal: request.signal
  });
  if (!res.ok) {
    throw new Error(`Gemini answered ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  };
  const text = body.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("");
  if (!text) throw new Error("Gemini answered with no text");
  const meta = body.usageMetadata;
  return {
    json: JSON.parse(text),
    // Thinking is billed as output.
    usage: {
      inputTokens: meta?.promptTokenCount ?? 0,
      outputTokens:
        (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0)
    }
  };
}
