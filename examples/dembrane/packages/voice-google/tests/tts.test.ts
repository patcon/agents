import { afterEach, expect, it, vi } from "vitest";
import {
  _buildTTSRequest,
  _buildTTSUrl,
  _notServedHint,
  _parseAudio,
  _parseSSEEvent,
  _resolveLocation,
  _wavToPCM,
  VERTEX_TTS_SAMPLE_RATE,
  VertexTTS
} from "../src/tts";
import { VERTEX_TTS_MODELS } from "../src/vertex-tts-models";

const options = { accessToken: "test-token", project: "test-project" };

// Two 16-bit samples each: [1, 2] and [3, 4].
const PCM_A = btoa(String.fromCharCode(1, 0, 2, 0));
const PCM_B = btoa(String.fromCharCode(3, 0, 4, 0));

const audioResponse = (...data: string[]) => ({
  candidates: [
    {
      content: {
        parts: data.map((d) => ({
          inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: d }
        }))
      }
    }
  ]
});

const samples = (buffer: ArrayBuffer | null) =>
  buffer ? Array.from(new Int16Array(buffer)) : null;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("posts to generateContent, or streamGenerateContent over SSE", () => {
  expect(_buildTTSUrl(options, "generateContent")).toBe(
    "https://aiplatform.googleapis.com/v1beta1/projects/test-project/locations/global/publishers/google/models/gemini-3.8-flash-tts:generateContent"
  );
  expect(
    _buildTTSUrl(
      { ...options, location: "us-central1", model: "gemini-2.5-pro-tts" },
      "streamGenerateContent"
    )
  ).toBe(
    "https://us-central1-aiplatform.googleapis.com/v1beta1/projects/test-project/locations/us-central1/publishers/google/models/gemini-2.5-pro-tts:streamGenerateContent?alt=sse"
  );
});

it("goes where the model is served, unless told a location", () => {
  for (const [model, { locations }] of Object.entries(VERTEX_TTS_MODELS)) {
    expect(_resolveLocation({ ...options, model })).toBe(locations[0]);
  }
  expect(_resolveLocation({ ...options, model: "gemini-9-tts" })).toBe(
    "global"
  );
  expect(
    _resolveLocation({
      ...options,
      model: "gemini-2.5-flash-tts",
      location: "europe-west4"
    })
  ).toBe("europe-west4");
});

it("says where a model is served when Vertex can't find it", () => {
  const where = {
    ...options,
    model: "gemini-3.8-flash-tts",
    location: "europe-west4"
  };
  expect(_notServedHint(where, 404)).toMatch(
    /Vertex served gemini-3.8-flash-tts from global\)$/
  );
  expect(_notServedHint(where, 401)).toBe("");
  expect(_notServedHint({ ...options, model: "gemini-9-tts" }, 404)).toBe("");
});

it("has every Vertex model at the one sample rate agents declare", () => {
  for (const model of Object.values(VERTEX_TTS_MODELS)) {
    expect(model.sampleRate).toBe(VERTEX_TTS_SAMPLE_RATE);
  }
});

it("asks for audio in the chosen voice, Kore by default", () => {
  const voice = (request: ReturnType<typeof _buildTTSRequest>) =>
    request.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig
      .voiceName;
  expect(_buildTTSRequest("Hi.")).toMatchObject({
    contents: [{ role: "user", parts: [{ text: "Hi." }] }],
    generationConfig: { responseModalities: ["AUDIO"] }
  });
  expect(voice(_buildTTSRequest("Hi."))).toBe("Kore");
  expect(voice(_buildTTSRequest("Hi.", "Puck"))).toBe("Puck");
});

/** A WAV file around 16-bit samples, with a `LIST` chunk before `data`. */
function wav(samples: number[]): ArrayBuffer {
  const pcm = new Int16Array(samples);
  const list = new TextEncoder().encode("INFOabc"); // odd length, so padded
  const bytes = new Uint8Array(
    12 + 24 + 8 + list.length + 1 + 8 + pcm.byteLength
  );
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, id: string) =>
    bytes.set(new TextEncoder().encode(id), offset);
  tag(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 24_000, true);
  view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "LIST");
  view.setUint32(40, list.length, true);
  bytes.set(list, 44);
  const data = 44 + list.length + 1;
  tag(data, "data");
  view.setUint32(data + 4, pcm.byteLength, true);
  bytes.set(new Uint8Array(pcm.buffer), data + 8);
  return bytes.buffer;
}

it("takes the samples out of a WAV file, past other chunks", () => {
  expect(samples(_wavToPCM(wav([1, 2, -3])))).toEqual([1, 2, -3]);
  expect(() => _wavToPCM(new ArrayBuffer(12))).toThrow("no data chunk");
});

it("unwraps WAV parts, as Gemini 3.8 sends from generateContent", () => {
  const bytes = new Uint8Array(wav([5, 6]));
  const response = {
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: btoa(String.fromCharCode(...bytes))
              }
            }
          ]
        }
      }
    ]
  };
  expect(_parseAudio(response).map(samples)).toEqual([[5, 6]]);
});

it("reads audio from an SSE event, and nothing from one without data", () => {
  const chunks = _parseSSEEvent(
    `data: ${JSON.stringify(audioResponse(PCM_A))}`
  );
  expect(chunks.map(samples)).toEqual([[1, 2]]);
  expect(_parseSSEEvent("")).toEqual([]);
  expect(_parseSSEEvent(": keep-alive")).toEqual([]);
});

it("joins every audio part into one buffer", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json(audioResponse(PCM_A, PCM_B))
  );
  vi.stubGlobal("fetch", fetchMock);
  const audio = await new VertexTTS(options).synthesize("Hi.");
  expect(samples(audio)).toEqual([1, 2, 3, 4]);
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining(":generateContent"),
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer test-token" })
    })
  );
});

it("returns null and logs when Vertex refuses", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("token expired", { status: 401 }))
  );
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await new VertexTTS(options).synthesize("Hi.")).toBeNull();
  expect(log).toHaveBeenCalled();
});

it("yields chunks as SSE events arrive, even split across reads", async () => {
  const event = (data: string) =>
    `data: ${JSON.stringify(audioResponse(data))}\r\n\r\n`;
  const body = event(PCM_A) + event(PCM_B);
  const split = 30;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body.slice(0, split)));
      controller.enqueue(encoder.encode(body.slice(split)));
      controller.close();
    }
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(stream))
  );
  const chunks: ArrayBuffer[] = [];
  for await (const chunk of new VertexTTS(options).synthesizeStream("Hi.")) {
    chunks.push(chunk);
  }
  expect(chunks.map(samples)).toEqual([
    [1, 2],
    [3, 4]
  ]);
});
