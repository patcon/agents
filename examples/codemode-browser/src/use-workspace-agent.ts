import { useEffect, useRef } from "react";
import { useAgent } from "agents/react";
import { emptyWorkspace, workspaceSchema, type Workspace } from "./schemas";
import { appStore } from "./store";

/**
 * Connects to the agent and persists the workspace as its state, so it
 * survives reloads and syncs across tabs. The agent's copy hydrates the
 * store on connect (and when another tab changes it); local changes are
 * pushed back.
 */
export function useWorkspaceAgent(agentName: string) {
  // The last workspace received from the server, so applying it to the
  // store isn't echoed straight back.
  const serverState = useRef<Workspace | null>(null);
  // Until the server's copy arrives, the local store is just the empty
  // default; pushing it would overwrite the saved workspace.
  const hydrated = useRef(false);

  const agent = useAgent<Workspace>({
    agent: agentName,
    onStateUpdate: (state, source) => {
      if (source !== "server") return;
      // Stored state from an older shape falls back to empty, and that
      // empty workspace is then pushed to replace it.
      const result = workspaceSchema.safeParse(state);
      hydrated.current = true;
      serverState.current = result.success ? result.data : null;
      appStore.set(() => (result.success ? result.data : emptyWorkspace));
    }
  });

  useEffect(
    () =>
      appStore.subscribe(() => {
        const state = appStore.get();
        if (hydrated.current && state !== serverState.current) {
          agent.setState(state);
        }
      }),
    [agent]
  );

  return agent;
}
