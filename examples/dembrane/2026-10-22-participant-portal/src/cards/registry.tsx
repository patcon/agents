import { useEffect, useId, useMemo, useRef } from "react";
import {
  JSONUIProvider,
  Renderer,
  createStateStore,
  defineRegistry,
  useBoundProp,
  useStateValue
} from "@json-render/react";
import { Input, InputArea } from "@cloudflare/kumo";
import { cardCatalog, defaultCard } from "./cards";
import { AUTO_SELECT, type AnswerValue, type Question } from "../shared";

// How each card component looks. The catalog in cards.ts says what props
// they take; props arrive here with `$state` and `$bindState` already
// resolved, so the casts below only undo the catalog's expression types.

const optionClass = (checked: boolean) =>
  `flex items-center gap-3 rounded-lg px-3 py-3 ring cursor-pointer transition-colors ${
    checked ? "ring-kumo-brand bg-kumo-tint" : "ring-kumo-line hover:bg-kumo-tint"
  }`;

const GAP = { sm: "gap-2", md: "gap-3", lg: "gap-5" } as const;

/**
 * An option, with a bar behind it as wide as Jev thinks it likely that the
 * speaker chose it: dim and blurred below the auto-select threshold, crisp
 * above it. Cards read the likelihoods from /likelihood.
 */
function Option({
  option,
  checked,
  children
}: {
  option: string;
  checked: boolean;
  children: React.ReactNode;
}) {
  const likelihood = useStateValue<Record<string, number> | null>("/likelihood");
  // Zero until Jev has a likelihood, so the first one grows from nothing,
  // while a card that loads with one shows it straight away.
  const p = likelihood?.[option] ?? 0;
  const likely = p >= AUTO_SELECT.select;
  return (
    <label className={`${optionClass(checked)} relative isolate overflow-hidden`}>
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 -z-10 bg-kumo-brand/15 transition-all duration-700 ease-out ${
          likely ? "" : "opacity-60 blur-[3px]"
        }`}
        style={{ width: `${Math.round(p * 100)}%` }}
      />
      {children}
    </label>
  );
}

/** Options laid out in `columns` columns. */
function OptionGrid({
  columns,
  children
}: {
  columns: number | null;
  children: React.ReactNode;
}) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns ?? 1}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

const { registry } = defineRegistry(cardCatalog, {
  components: {
    Stack: ({ props, children }) => (
      <div className={`flex flex-col ${GAP[props.gap ?? "md"]}`}>{children}</div>
    ),

    Prose: ({ props }) => (
      <div className="flex flex-col gap-2 text-sm text-kumo-default leading-relaxed">
        {String(props.text)
          .split(/\n\s*\n/)
          .map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
      </div>
    ),

    RadioGroup: ({ props, bindings }) => {
      const name = useId();
      const prompt = useStateValue<string>("/question/prompt");
      const [value, setValue] = useBoundProp<AnswerValue>(
        props.value as unknown as AnswerValue,
        bindings?.value
      );
      return (
        <fieldset>
          <legend className="sr-only">{prompt}</legend>
          <OptionGrid columns={props.columns}>
            {(props.options as string[]).map((option) => (
              <Option key={option} option={option} checked={value === option}>
                <input
                  type="radio"
                  name={name}
                  className="accent-[var(--color-kumo-brand)] size-4"
                  checked={value === option}
                  onChange={() => setValue(option)}
                />
                <span className="text-sm text-kumo-default">{option}</span>
              </Option>
            ))}
          </OptionGrid>
        </fieldset>
      );
    },

    CheckboxGroup: ({ props, bindings }) => {
      const prompt = useStateValue<string>("/question/prompt");
      const [value, setValue] = useBoundProp<AnswerValue>(
        props.value as unknown as AnswerValue,
        bindings?.value
      );
      const selected = Array.isArray(value) ? value : [];
      return (
        <fieldset>
          <legend className="sr-only">{prompt}</legend>
          <OptionGrid columns={props.columns}>
            {(props.options as string[]).map((option) => {
              const checked = selected.includes(option);
              return (
                <Option key={option} option={option} checked={checked}>
                  <input
                    type="checkbox"
                    className="accent-[var(--color-kumo-brand)] size-4"
                    checked={checked}
                    onChange={() =>
                      setValue(
                        checked
                          ? selected.filter((o) => o !== option)
                          : [...selected, option]
                      )
                    }
                  />
                  <span className="text-sm text-kumo-default">{option}</span>
                </Option>
              );
            })}
          </OptionGrid>
        </fieldset>
      );
    },

    TextInput: ({ props, bindings }) => {
      const prompt = useStateValue<string>("/question/prompt");
      const [value, setValue] = useBoundProp<AnswerValue>(
        props.value as unknown as AnswerValue,
        bindings?.value
      );
      return (
        <InputArea
          aria-label={prompt}
          placeholder={props.placeholder ?? undefined}
          value={typeof value === "string" ? value : ""}
          onValueChange={(v) => setValue(v)}
        />
      );
    },

    NumberInput: ({ props, bindings }) => {
      const prompt = useStateValue<string>("/question/prompt");
      const [value, setValue] = useBoundProp<AnswerValue>(
        props.value as unknown as AnswerValue,
        bindings?.value
      );
      const min = (props.min as number | null) ?? undefined;
      const max = (props.max as number | null) ?? undefined;
      return (
        <Input
          type="number"
          inputMode="numeric"
          aria-label={prompt}
          min={min}
          max={max}
          placeholder={
            min !== undefined && max !== undefined ? `${min}–${max}` : "Enter a number"
          }
          value={typeof value === "number" ? String(value) : ""}
          onChange={(e) =>
            setValue(e.target.value === "" ? null : Number(e.target.value))
          }
        />
      );
    }
  }
});

/**
 * A question's card, drafting its answer. The card gets its own state model
 * with the question at /question, the draft at /value and Jev's likelihoods
 * at /likelihood; `value` and `onChange` keep /value in step with the drafts
 * the page holds.
 */
export function CardInput({
  question,
  value,
  likelihood,
  readOnly = false,
  onChange
}: {
  question: Question;
  value: AnswerValue;
  likelihood?: Record<string, number>;
  /** Shows the answer without letting it change. */
  readOnly?: boolean;
  onChange: (value: AnswerValue) => void;
}) {
  const spec = question.card ?? defaultCard(question);
  // One store per question, seeded with its current draft.
  const store = useMemo(
    () => createStateStore({ question, value, likelihood: likelihood ?? null }),
    [question.id]
  );

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (store.get("/value") !== value) store.set("/value", value);
  }, [store, value]);

  useEffect(() => {
    store.set("/likelihood", likelihood ?? null);
  }, [store, likelihood]);

  useEffect(
    () =>
      store.subscribe(() => {
        const next = store.get("/value") as AnswerValue;
        if (next !== valueRef.current) onChangeRef.current(next);
      }),
    [store]
  );

  return (
    <JSONUIProvider registry={registry} store={store}>
      {/* A disabled fieldset disables every input the card draws. */}
      <fieldset disabled={readOnly} className="contents">
        <Renderer spec={spec} registry={registry} />
      </fieldset>
    </JSONUIProvider>
  );
}
