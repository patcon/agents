import { vertexHost } from "@dembrane/voice-gemini";

export type TokenUsage = { inputTokens: number; outputTokens: number };

/**
 * Asks a Gemini model on Vertex AI for an answer that fits a JSON schema, and
 * returns it parsed, with the tokens it used. Throws on any failure, with
 * Vertex's own words where it gave some.
 */
export async function generateJson(
  env: Env,
  request: { system: string; prompt: string; schema: object }
): Promise<{ json: unknown; usage: TokenUsage }> {
  for (const name of ["GOOGLE_CLOUD_PROJECT", "GOOGLE_ACCESS_TOKEN"] as const) {
    if (!env[name]?.trim()) throw new Error(`${name} isn't set`);
  }
  const location = "global";
  const url = `https://${vertexHost(location)}/v1beta1/projects/${env.GOOGLE_CLOUD_PROJECT}/locations/${location}/publishers/google/models/${env.AGENT_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GOOGLE_ACCESS_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: request.schema
      }
    })
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
