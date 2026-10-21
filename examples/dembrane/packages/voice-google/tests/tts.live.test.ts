/**
 * Calls Vertex for every model in `VERTEX_TTS_MODELS`, through both methods.
 * Skipped unless GOOGLE_ACCESS_TOKEN and GOOGLE_CLOUD_PROJECT are set:
 *
 *   GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token) \
 *   GOOGLE_CLOUD_PROJECT=my-project pnpm test tts.live
 */
import { describe, expect, it } from "vitest";
import { VertexTTS } from "../src/tts";
import { VERTEX_TTS_MODELS } from "../src/vertex-tts-models";

const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
const project = process.env.GOOGLE_CLOUD_PROJECT;

describe.skipIf(!accessToken || !project).each(Object.keys(VERTEX_TTS_MODELS))(
  "%s on Vertex",
  (model) => {
    const tts = new VertexTTS({
      accessToken: accessToken!,
      project: project!,
      model
    });

    it("speaks a whole sentence as bare PCM", async () => {
      const audio = await tts.synthesize("Thanks for joining.");
      expect(audio).not.toBeNull();
      expect(audio!.byteLength % 2).toBe(0);
      const head = new TextDecoder().decode(new Uint8Array(audio!, 0, 4));
      expect(head).not.toBe("RIFF");
    });

    it("streams a sentence in chunks", async () => {
      let bytes = 0;
      let chunks = 0;
      for await (const chunk of tts.synthesizeStream("Thanks for joining.")) {
        bytes += chunk.byteLength;
        chunks++;
      }
      expect(chunks).toBeGreaterThan(1);
      expect(bytes % 2).toBe(0);
    });
  },
  30_000
);
