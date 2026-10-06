import { useSyncExternalStore } from "react";
import { emptyWorkspace, type Workspace } from "../shared/schemas";

let state: Workspace = emptyWorkspace;
const listeners = new Set<() => void>();

/**
 * External store shared by the UI and the codemode tools. Tools read through
 * `get()` at call time, so they never see stale React closures, and every
 * `set()` re-renders subscribed components.
 */
export const appStore = {
  get: () => state,
  set(update: (s: Workspace) => Workspace) {
    state = update(state);
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
};

export function useWorkspace() {
  return useSyncExternalStore(appStore.subscribe, appStore.get);
}
