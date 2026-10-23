import {
  AUDIO_TOKENS_PER_SECOND,
  CHARS_PER_TOKEN,
  costOf,
  priceChangesAfter,
  rateOn,
  type Usage
} from "../../shared";
import { formatClock } from "../format";

function formatUsd(usd: number | undefined) {
  if (usd === undefined) return "—";
  return usd > 0 && usd < 0.0001 ? "<$0.0001" : `$${usd.toFixed(4)}`;
}

/**
 * What the session has cost so far, at today's prices and at each announced
 * change after today.
 */
export function CostEstimate({ usage }: { usage: Usage }) {
  const today = new Date().toISOString().slice(0, 10);
  const dates = [
    today,
    ...priceChangesAfter(today, [
      usage.sttModel,
      usage.agentModel,
      usage.draftModel,
      usage.jevModel
    ])
  ];
  const audioTokens = usage.audioSeconds * AUDIO_TOKENS_PER_SECOND;
  const transcriptTokens = usage.transcriptChars / CHARS_PER_TOKEN;
  const rows = [
    {
      label: "Transcription",
      detail: `${formatClock(usage.audioSeconds)} of audio`,
      costs: dates.map((d) =>
        costOf(rateOn(usage.sttModel, d), audioTokens, transcriptTokens)
      )
    },
    {
      label: "Agent",
      detail: `${usage.agentCalls} calls · ${usage.agentInputTokens.toLocaleString()} in / ${usage.agentOutputTokens.toLocaleString()} out`,
      costs: dates.map((d) =>
        costOf(
          rateOn(usage.agentModel, d),
          usage.agentInputTokens,
          usage.agentOutputTokens
        )
      )
    },
    {
      label: "Drafting",
      detail: `${usage.draftCalls} calls · ${usage.draftInputTokens.toLocaleString()} in / ${usage.draftOutputTokens.toLocaleString()} out`,
      costs: dates.map((d) =>
        usage.draftCalls
          ? costOf(
              rateOn(usage.draftModel, d),
              usage.draftInputTokens,
              usage.draftOutputTokens
            )
          : 0
      )
    },
    {
      label: "Jev",
      detail: `${usage.jevCalls} calls · ${usage.jevInputTokens.toLocaleString()} in`,
      costs: dates.map((d) =>
        usage.jevCalls
          ? costOf(rateOn(usage.jevModel, d), usage.jevInputTokens, 0)
          : 0
      )
    }
  ];
  const totals = dates.map((_, i) =>
    rows.some((r) => r.costs[i] === undefined)
      ? undefined
      : rows.reduce((sum, r) => sum + (r.costs[i] ?? 0), 0)
  );

  return (
    <section className="pb-3 mb-3 border-b border-app-quiet">
      <table className="w-full text-xs tabular-nums">
        <thead className="text-app-muted">
          <tr>
            <th className="text-left font-normal">Cost estimate</th>
            {dates.map((d, i) => (
              <th key={d} className="text-right font-normal pl-3">
                {i === 0 ? "Now" : `From ${d}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-app-text">
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="py-1">
                {row.label}
                <div className="text-[11px] text-app-muted">{row.detail}</div>
              </td>
              {row.costs.map((cost, i) => (
                <td key={dates[i]} className="text-right pl-3 align-top py-1">
                  {formatUsd(cost)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="pt-1">Total</td>
            {totals.map((cost, i) => (
              <td key={dates[i]} className="text-right pl-3 pt-1">
                {formatUsd(cost)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-app-muted">
        From list prices; <code>pnpm update-prices</code> refreshes them.
        Transcription counts every second streamed, silence included.
      </p>
    </section>
  );
}
