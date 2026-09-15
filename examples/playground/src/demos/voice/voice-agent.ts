import { Agent, type Connection } from "agents";
import {
  withVoice,
  WorkersAIFluxSTT,
  WorkersAITTS,
  type VoiceTurnContext
} from "agents/voice";
import { streamText } from "ai";
import { getModel } from "../../model";

const VoiceAgent = withVoice(Agent);

export class PlaygroundVoiceAgent extends VoiceAgent<Env> {
  transcriber = new WorkersAIFluxSTT(this.env.AI);
  tts = new WorkersAITTS(this.env.AI);

  async onTurn(transcript: string, context: VoiceTurnContext) {

    const result = streamText({
      model: getModel(this.env, { sessionAffinity: this.sessionAffinity }),
      instructions:
        "You are a friendly voice assistant in a demo playground. Keep responses concise — 1-2 sentences. Be warm and helpful.",
      messages: [
        ...context.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content
        })),
        { role: "user" as const, content: transcript }
      ],
      abortSignal: context.signal
    });

    return result.stream;
  }

  async onCallStart(connection: Connection) {
    await this.speak(
      connection,
      "Hi! I'm a voice agent running in the playground. What would you like to talk about?"
    );
  }
}
