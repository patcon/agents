import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { flushSync } from "react-dom";
import {
  JSONUIProvider,
  Renderer,
  createStateStore,
  defineRegistry,
  useBoundProp,
  useStateValue
} from "@json-render/react";
import { Input } from "@cloudflare/kumo";
import { cardCatalog, defaultCard } from "./cards";
import { caretHitAt, draftOffset } from "./caret";
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
      const dictating = useStateValue<boolean | null>("/dictating") ?? false;
      const interim = useStateValue<string | null>("/interim");
      const [value, setValue] = useBoundProp<AnswerValue>(
        props.value as unknown as AnswerValue,
        bindings?.value
      );
      return (
        <DictationField
          label={prompt}
          placeholder={props.placeholder ?? undefined}
          short={props.length === "short"}
          value={typeof value === "string" ? value : ""}
          onChange={(v) => setValue(v)}
          dictating={dictating}
          interim={interim ?? undefined}
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

// The display layer and the field lay their text out identically, so
// swapping one for the other moves nothing: same box, font, padding, line
// height and wrapping, and room for a scrollbar whether or not there is one.
// A single line doesn't wrap, and scrolls sideways with no scrollbar, as an
// input does.
const FIELD_TEXT =
  "col-start-1 row-start-1 w-full px-3 py-2 text-sm leading-6 [font-family:inherit]";
const LINES_TEXT =
  "overflow-y-auto [scrollbar-gutter:stable] whitespace-pre-wrap break-words";
const LINE_TEXT = "overflow-x-auto overflow-y-hidden [scrollbar-width:none] whitespace-pre";
/** Eight lines of leading-6 plus py-2 for long text, or one for short. */
const fieldHeight = (short: boolean) => (short ? "h-10" : "h-52");

/**
 * A text field that dictation can fill. A textarea can't grey out part of its
 * own text, so while dictation fills it, a display layer over the textarea
 * shows the draft with what's being said now greyed after it, and follows
 * new text down unless the person has scrolled up. Pressing it, or tabbing
 * to it, swaps in the textarea; dictation keeps filling it until they change
 * the text, and the display comes back if they leave without changing it.
 * Short text is a single-line input, and new text is followed sideways.
 */
function DictationField({
  label,
  placeholder,
  short,
  value,
  onChange,
  dictating,
  interim
}: {
  label?: string;
  placeholder?: string;
  short: boolean;
  value: string;
  onChange: (value: string) => void;
  dictating: boolean;
  interim?: string;
}) {
  const display = useRef<HTMLDivElement>(null);
  const interimText = useRef<HTMLSpanElement>(null);
  const textarea = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const Field = short ? "input" : "textarea";
  // Which way new text pushes the field: down, or sideways on one line.
  const axis = short
    ? ({ pos: "scrollLeft", size: "scrollWidth", client: "clientWidth" } as const)
    : ({ pos: "scrollTop", size: "scrollHeight", client: "clientHeight" } as const);
  // Shared by both layers, so swapping keeps the field's place.
  const scroll = useRef({ pos: 0, atEnd: true });
  // The textarea's selection, put back when dictation adds text under it.
  const selection = useRef({ start: 0, end: 0 });
  // Once they've typed, the text is theirs: nothing moves the caret for them.
  const typed = useRef(false);
  const [focused, setFocused] = useState(false);
  const showDisplay = dictating && !focused;
  // While the textarea has focus, what's being said now is in it as plain
  // text, and the final words replace it when they arrive. If they type
  // first, it's theirs as it stands.
  const separator = value ? " " : "";
  const text =
    focused && dictating && interim ? value + separator + interim : value;

  const onScroll = (el: HTMLElement) => {
    scroll.current = {
      pos: el[axis.pos],
      atEnd: el[axis.size] - el[axis.pos] - el[axis.client] < 4
    };
  };

  // The textarea is swapped in within the event, so it can take focus there
  // (a phone only opens its keyboard then), with the caret where they pressed.
  const swapIn = (caret: number) => {
    flushSync(() => setFocused(true));
    const el = textarea.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(caret, caret);
    selection.current = { start: caret, end: caret };
    el[axis.pos] = scroll.current.pos;
  };

  useLayoutEffect(() => {
    const place = (el: HTMLElement) => {
      el[axis.pos] = scroll.current.atEnd ? el[axis.size] : scroll.current.pos;
    };
    if (showDisplay) {
      if (display.current) place(display.current);
      return;
    }
    // Dictation adding text under a focused textarea moves its caret and
    // scroll, so they're put back. Their own typing is left alone.
    const el = textarea.current;
    if (!el || !focused || !dictating || typed.current) return;
    el.setSelectionRange(selection.current.start, selection.current.end);
    place(el);
  }, [text, interim, showDisplay]);

  return (
    <div
      className={`grid ${fieldHeight(short)} rounded-lg bg-kumo-control ring ring-kumo-line focus-within:ring-[1.5px] focus-within:ring-kumo-focus/50`}
    >
      <Field
        ref={textarea}
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onSelect={(e) => {
          const el = e.currentTarget;
          selection.current = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
        }}
        onScroll={(e) => onScroll(e.currentTarget)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`${FIELD_TEXT} ${short ? LINE_TEXT : LINES_TEXT} h-full resize-none border-0 bg-transparent text-kumo-default outline-none placeholder:text-kumo-subtle ${
          showDisplay ? "invisible" : ""
        }`}
      />
      {showDisplay && (
        <div
          ref={display}
          role="textbox"
          aria-multiline={!short}
          aria-label={label}
          tabIndex={0}
          onMouseDown={(e) => {
            // Not the browser's own focus: the textarea takes it instead.
            e.preventDefault();
            const el = e.currentTarget;
            swapIn(
              draftOffset(caretHitAt(e.clientX, e.clientY), {
                display: el,
                draft: value ? el.firstChild : null,
                length: value.length,
                interim: interimText.current?.lastChild ?? null,
                interimStart: value.length + separator.length
              })
            );
          }}
          onFocus={() => swapIn(value.length)}
          onScroll={(e) => onScroll(e.currentTarget)}
          className={`${FIELD_TEXT} ${short ? LINE_TEXT : LINES_TEXT} h-full cursor-text text-kumo-default`}
        >
          {value}
          {/* A textarea shows a trailing line break; a div needs a nudge. */}
          {value.endsWith("\n") && "\u200b"}
          {interim ? (
            <span ref={interimText} className="italic text-kumo-subtle">
              {separator}
              {interim}
            </span>
          ) : (
            !value &&
            placeholder && <span className="text-kumo-subtle">{placeholder}</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A question's card, drafting its answer. The card gets its own state model
 * with the question at /question, the draft at /value, Jev's likelihoods
 * at /likelihood, whether dictation fills it at /dictating and what's being
 * said now at /interim; `value` and `onChange` keep /value in step with the
 * drafts the page holds.
 */
export function CardInput({
  question,
  value,
  likelihood,
  dictating = false,
  interim,
  readOnly = false,
  onChange
}: {
  question: Question;
  value: AnswerValue;
  likelihood?: Record<string, number>;
  /** Whether dictation fills the draft, which text fields show it doing. */
  dictating?: boolean;
  /** What's being said now, shown greyed in a text field; not in the draft. */
  interim?: string;
  /** Shows the answer without letting it change. */
  readOnly?: boolean;
  onChange: (value: AnswerValue) => void;
}) {
  const spec = question.card ?? defaultCard(question);
  // One store per question, seeded with its current draft.
  const store = useMemo(
    () =>
      createStateStore({
        question,
        value,
        likelihood: likelihood ?? null,
        dictating,
        interim: interim ?? null
      }),
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

  useEffect(() => {
    store.set("/dictating", dictating);
  }, [store, dictating]);

  useEffect(() => {
    store.set("/interim", interim ?? null);
  }, [store, interim]);

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
