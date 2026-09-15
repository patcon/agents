import { Agent, routeAgentRequest, type Connection } from "agents";
import { withVoiceInput, WorkersAINova3STT } from "agents/voice";
import { LocalWhisperfileSTT } from "./local-whisper-stt";

const InputAgent = withVoiceInput(Agent);

// Set by `pnpm start:whisper` (VITE_STT_PROVIDER=local) to swap in the
// local whisperfile provider instead of Workers AI's hosted Nova 3.
const useLocalWhisper = import.meta.env.VITE_STT_PROVIDER === "local";

/**
 * Voice-to-text input agent.
 *
 * Uses Nova 3 continuous STT to transcribe speech in real time by default.
 * No TTS or LLM pipeline — each utterance is transcribed and sent back to
 * the client immediately. Run with `pnpm start:whisper` to use a local
 * whisperfile server instead (offline, lower quality, no Cloudflare
 * account) — see README.md "Running with a local-only model".
 */
export class VoiceInputAgent extends InputAgent<Env> {
  transcriber = useLocalWhisper
    ? new LocalWhisperfileSTT()
    : new WorkersAINova3STT(this.env.AI);

  onTranscript(text: string, _connection: Connection) {
    console.log(`[VoiceInputAgent] Transcribed: "${text}"`);
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
};
