// The plan /platform-admin swaps in, kept in localStorage. Apart from
// platform-admin.tsx so that file exports only a component, which Fast
// Refresh needs. To be removed with it.

import type { Plan } from "../../plan/plan";

const STORAGE_KEY = "platform-admin:plan";

export type Active = { plan: Plan; playbook: string; at: number };

export function readActive(): Active | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function writeActive(active: Active | null) {
  if (active) localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
  else localStorage.removeItem(STORAGE_KEY);
}

/** What the session page passes to open(): the swapped-in plan, if any. */
export function activePlanArgs(): [Plan] | [] {
  const active = readActive();
  return active ? [active.plan] : [];
}
