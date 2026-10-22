import { defineCatalog, validateSpec, type Spec } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";
import type { Question } from "../shared";

// A card is a json-render spec: what goes between a question's prompt and
// its Submit button. The client renders it with the registry in
// card-registry.tsx; the server and `pnpm check-plans` validate it here.
//
// A card sees one state model, seeded by the client:
//   /question  the question being asked (read with `$state`)
//   /value     the answer being drafted (bound with `$bindState`)
//   /likelihood  Jev's likelihood for each option, which option rows show
//              on their own; a card doesn't refer to it
//   /dictating whether dictation fills the draft, and /interim, what's
//              being said now before it's final, which text inputs show on
//              their own; neither is ever part of the value
// The prop schemas only accept those paths, so a card can't read or write
// anything else.
//
// Optional props are nullable rather than optional, as json-render's own
// catalogs do: a model writing a spec then always says what it means.

/** Reads a field of the question, e.g. `{ "$state": "/question/options" }`. */
const fromQuestion = <T extends z.ZodType>(type: T) =>
  z.union([type, z.strictObject({ $state: z.string().startsWith("/question/") })]);

/** An input's value, which always drafts the answer. */
const draft = z.strictObject({ $bindState: z.literal("/value") });

const choices = z.strictObject({
  options: fromQuestion(z.array(z.string()).min(1)),
  columns: z
    .number()
    .int()
    .min(1)
    .max(4)
    .nullable()
    .describe("Lay options out in this many columns; one when null"),
  value: draft
});

export const cardCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.strictObject({ gap: z.enum(["sm", "md", "lg"]).nullable() }),
      slots: ["default"],
      description: "Stacks its children vertically"
    },
    Prose: {
      props: z.strictObject({ text: fromQuestion(z.string()) }),
      description: "A paragraph of text. Blank lines separate paragraphs."
    },
    RadioGroup: {
      props: choices,
      description: "Pick one option. The answer is the option's text."
    },
    CheckboxGroup: {
      props: choices,
      description: "Pick any number of options. The answer is a list of them."
    },
    TextInput: {
      props: z.strictObject({
        placeholder: z.string().nullable(),
        value: draft
      }),
      description: "Free text"
    },
    NumberInput: {
      props: z.strictObject({
        min: fromQuestion(z.number()).nullable(),
        max: fromQuestion(z.number()).nullable(),
        value: draft
      }),
      description: "A number, optionally between min and max"
    }
  },
  actions: {}
});

export type CardSpec = Spec;
export type CardComponent = keyof typeof cardCatalog.data.components;

/** The components that draft the answer. A card has exactly one. */
export const INPUTS: readonly CardComponent[] = [
  "RadioGroup",
  "CheckboxGroup",
  "TextInput",
  "NumberInput"
];

/**
 * The spec shape, built from the catalog's own prop schemas with one
 * element variant per component. The catalog's zodSchema(), jsonSchema()
 * and validate() all leave props unchecked once there's more than one
 * component, so they can't catch a bad prop, or tell an editor or a model
 * what props a RadioGroup takes. Strict, so a card can't set `state`.
 */
const elementVariants = Object.entries(cardCatalog.data.components).map(
  ([type, definition]) =>
    z
      .strictObject({
        type: z.literal(type),
        props: definition.props,
        children: z.array(z.string())
      })
      .describe(definition.description)
);

export const CardSpecSchema = z.strictObject({
  root: z.string().describe("Key of the root element"),
  elements: z.record(
    z.string(),
    z.discriminatedUnion(
      "type",
      elementVariants as [
        (typeof elementVariants)[number],
        ...(typeof elementVariants)[number][]
      ]
    )
  )
}) as unknown as z.ZodType<CardSpec>;

/** What's wrong with a card, if anything. Empty when it's fine to render. */
export function cardIssues(spec: unknown): string[] {
  // Not cardCatalog.validate(): with more than one component in the
  // catalog, it doesn't check props.
  const parsed = CardSpecSchema.safeParse(spec);
  if (!parsed.success) {
    return parsed.error.issues.map(
      (issue) => `/${issue.path.join("/")}: ${issue.message}`
    );
  }
  const card = spec as CardSpec;
  const issues = validateSpec(card).issues.map((issue) => issue.message);
  const inputs = Object.values(card.elements).filter((element) =>
    INPUTS.includes(element.type as CardComponent)
  );
  if (inputs.length !== 1) {
    issues.push(`a card needs exactly one input, found ${inputs.length}`);
  }
  return issues;
}

/** The card for a question that doesn't bring its own. */
export function defaultCard(question: Question): CardSpec {
  const input = (() => {
    switch (question.type) {
      case "radio":
      case "checkbox":
        return {
          type: question.type === "radio" ? "RadioGroup" : "CheckboxGroup",
          props: {
            options: { $state: "/question/options" },
            columns: null,
            value: { $bindState: "/value" }
          }
        };
      case "number":
        return {
          type: "NumberInput",
          props: {
            min: question.min ?? null,
            max: question.max ?? null,
            value: { $bindState: "/value" }
          }
        };
      case "text":
        return {
          type: "TextInput",
          props: { placeholder: "Type your answer", value: { $bindState: "/value" } }
        };
    }
  })();
  return { root: "input", elements: { input: { ...input, children: [] } } };
}

// --- Platform cards ---
//
// Defined here, not in a plan: a plan places them but can't change them.
// The question's card goes into the log, so the log records the exact
// wording each person agreed to.

export const CONSENT = {
  version: "2026-10-22",
  prompt: "Before we start: may we record this session?",
  card: {
    root: "consent",
    elements: {
      consent: {
        type: "Stack",
        props: { gap: "md" },
        children: ["what", "why", "agree"]
      },
      what: {
        type: "Prose",
        props: {
          text: "This session is recorded and transcribed while you talk through your portal settings."
        },
        children: []
      },
      why: {
        type: "Prose",
        props: {
          text: "We use the recording only to fill in those settings from what you say. You can stop recording at any time."
        },
        children: []
      },
      agree: {
        type: "CheckboxGroup",
        props: {
          options: ["Yes, I agree to be recorded"],
          columns: null,
          value: { $bindState: "/value" }
        },
        children: []
      }
    }
  } satisfies CardSpec
};
