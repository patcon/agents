// The platform's portal settings: what a plan's prompts can write. A
// playbook talks about them in a host's words; the compiler maps those words
// to these keys, so a prompt's `key`, and any condition on it, names a real
// setting.
//
// Written by hand from src/shared/plan/admin-setup.json, in the platform's terms.
// The platform's own field definitions (echo's ProjectPortalEditor.tsx)
// would be the source if this outlives the prototype.
//
// Which setting only matters once another is on isn't here. That's the
// playbook's to say, and the compiler's to turn into triggers.

export type Setting = {
  key: string;
  /** What it controls, in a host's words. */
  means: string;
  /** The shape of its value. `one of` and `any of` list their options. */
  value: "one of" | "any of" | "text" | "number";
  options?: string[];
};

const yesNo = ["Yes", "No"];

export const SETTINGS: Setting[] = [
  {
    key: "language",
    means: "The language participants speak in their conversations",
    value: "one of",
    options: [
      "English",
      "Dutch",
      "German",
      "French",
      "Spanish",
      "Italian",
      "Ukrainian",
      "Czech"
    ]
  },
  {
    // Echo stores this as two booleans, default_conversation_ask_for_participant_name and _email.
    key: "default_conversation_ask_for_participant_details",
    means: "Details a participant must give before a conversation starts",
    value: "any of",
    options: ["A name", "An email"]
  },
  {
    key: "is_project_notification_subscription_allowed",
    means: "Participants can ask to be emailed when the report is ready",
    value: "one of",
    options: yesNo
  },
  {
    key: "default_conversation_tutorial_slug",
    means: "The tutorial participants see before they start",
    value: "one of",
    options: ["None", "Basic", "Advanced"]
  },
  {
    key: "tags",
    means: "Tags participants can pick from, separated by commas",
    value: "text"
  },
  {
    key: "is_get_reply_enabled",
    means: "Participants can use Explore, which replies to what they've said",
    value: "one of",
    options: yesNo
  },
  {
    key: "get_reply_mode",
    means: "How Explore replies",
    value: "one of",
    options: ["Summarize", "Brainstorm", "Custom"]
  },
  {
    key: "get_reply_prompt",
    means: "The prompt Explore replies with in its custom mode",
    value: "text"
  },
  {
    key: "is_verify_enabled",
    means:
      "Participants can use Verify, which checks their conversation for topics",
    value: "one of",
    options: yesNo
  },
  {
    key: "verification_topics",
    means: "The topics Verify checks for",
    value: "any of",
    options: [
      "Actions",
      "Agreements",
      "Disagreements",
      "Gems",
      "Moments",
      "Truths"
    ]
  },
  {
    key: "is_verify_on_finish_enabled",
    means: "Participants are reminded to verify when they finish",
    value: "one of",
    options: yesNo
  },
  {
    key: "default_conversation_title",
    means: "The title of the portal page",
    value: "text"
  },
  {
    key: "default_conversation_description",
    means: "What the portal page says",
    value: "text"
  },
  {
    key: "default_conversation_finish_text",
    means: "What participants see when they finish",
    value: "text"
  },
  {
    key: "default_conversation_transcript_prompt",
    means: "Key terms the transcriber should know, separated by commas",
    value: "text"
  },
  {
    key: "anonymize_transcripts",
    means: "Transcripts are anonymized",
    value: "one of",
    options: yesNo
  },
  {
    key: "enable_ai_title_and_tags",
    means: "Conversation titles and tags are generated automatically",
    value: "one of",
    options: yesNo
  },
  {
    key: "conversation_title_prompt",
    means: "A custom prompt for how generated titles are written",
    value: "text"
  }
];

/** The catalog as one line per setting, for a prompt. */
export function settingsForPrompt(settings: Setting[] = SETTINGS): string {
  return settings
    .map(
      ({ key, means, value, options }) =>
        `- ${key}: ${means}. ${value}${options ? `: ${options.join(" | ")}` : ""}`
    )
    .join("\n");
}
