import { useEffect, useRef, useState } from "react";

// Ported from dembrane-echo-portal-config's portal-prototypes/00-components,
// which ported it from the frontend's components/voice/ (VoiceWaveform,
// waveformHeights) and participant/ParticipantRecordingWaveform.

/** Bars in the large meter, as in the frontend. */
export const WAVEFORM_BARS = 32;

/** How often a new sample goes into state. Fast enough to look live, slow
 * enough not to re-render every frame. */
const LEVEL_SAMPLE_MS = 80;

/** Below this the microphone is producing nothing at all: not "nobody is
 * talking", which still returns room tone, but muted, unplugged or taken. */
const SILENT_LEVEL = 0.002;

/** How long that has to hold before we say so. */
const SILENCE_MS = 8000;

/** Bar heights in percent, oldest first, padded to a fixed count so the row
 * never changes width as samples arrive.
 *
 * The square root spreads quiet speech across the visible range; raw RMS on a
 * normal speaking voice sits near the floor and reads as a dead meter. */
export function waveformHeights(
  levels: number[],
  barCount = WAVEFORM_BARS,
  gain = 1
): number[] {
  const recent = levels.slice(-barCount);
  const padding = Array<number>(Math.max(0, barCount - recent.length)).fill(0);
  return [...padding, ...recent].map((level) => {
    const scaled = Math.sqrt(Math.max(0, Math.min(1, level))) * 100 * gain;
    // A floor of 8% keeps the row legible as a meter during silence.
    return Math.max(8, Math.min(100, scaled));
  });
}

function useReducedMotion() {
  const [reduce, setReduce] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduce(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return reduce;
}

/**
 * Samples the mic's level while `live`, keeping the last WAVEFORM_BARS, and
 * reports silence: `silent` once the level has stayed flat for SILENCE_MS,
 * and `onSilence` once each time that happens.
 */
export function useLevels(
  level: number,
  live: boolean,
  onSilence?: () => void
) {
  const latest = useRef(level);
  latest.current = level;
  const onSilenceRef = useRef(onSilence);
  onSilenceRef.current = onSilence;
  const [levels, setLevels] = useState<number[]>([]);
  const [silent, setSilent] = useState(false);

  useEffect(() => {
    if (!live) {
      setLevels([]);
      setSilent(false);
      return;
    }
    let silentSince: number | null = null;
    let reported = false;
    const id = setInterval(() => {
      const level = latest.current;
      setLevels((previous) => [...previous, level].slice(-WAVEFORM_BARS));
      if (level > SILENT_LEVEL) {
        silentSince = null;
        reported = false;
        setSilent(false);
        return;
      }
      silentSince ??= Date.now();
      if (Date.now() - silentSince < SILENCE_MS) return;
      setSilent(true);
      if (reported) return;
      reported = true;
      onSilenceRef.current?.();
    }, LEVEL_SAMPLE_MS);
    return () => clearInterval(id);
  }, [live]);

  return { levels, silent };
}

/**
 * A live level meter for a recording in progress. Decorative, so hidden from
 * the accessibility tree: the status text and timer beside it carry that.
 * Under prefers-reduced-motion the bars settle at a fixed height.
 *
 * `size="lg"` is the frontend's participant meter, full width; `size="sm"`
 * fits in the tucked strip, with fewer, thinner bars.
 */
export function Waveform({
  levels,
  size = "lg",
  silent = false,
  className = ""
}: {
  levels: number[];
  size?: "lg" | "sm";
  /** The mic has gone flat: drawn in the danger colour. Grey with no levels at all. */
  silent?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const bars = size === "lg" ? WAVEFORM_BARS : 18;
  // Twice the swing of the frontend's composer meter, as on its participant screen.
  const heights = reduceMotion
    ? Array<number>(bars).fill(30)
    : waveformHeights(levels, bars, 2);
  const colour = silent
    ? "bg-app-danger"
    : levels.length
      ? "bg-app-action"
      : "bg-app-quiet";
  return (
    <div
      aria-hidden="true"
      className={`flex items-center gap-[3px] ${
        size === "lg" ? "h-8" : "h-6 justify-center"
      } ${className}`}
    >
      {heights.map((height, index) => (
        <div
          // Bars are positions in a fixed-length meter, not data.
          key={index}
          className={`rounded-full ${size === "lg" ? "flex-1" : "w-0.5"} ${colour}`}
          style={{
            height: `${height}%`,
            minHeight: "2px",
            transition: reduceMotion
              ? undefined
              : "background-color 300ms ease, height 90ms linear"
          }}
        />
      ))}
    </div>
  );
}
