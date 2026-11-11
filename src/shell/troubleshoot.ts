import { createStore, useStore } from "zustand";
import { loadDiagnostics, type Diagnostics } from "@/app/diagnostics";
import { agentsStore } from "@/agents/agentsStore";
import { refreshPath } from "@/ipc/pty";

interface TroubleshootState {
  open: boolean;
  diagnostics: Diagnostics | null;
  error: string | null;
}

export const troubleshootStore = createStore<TroubleshootState>()(() => ({ open: false, diagnostics: null, error: null }));

export function useTroubleshoot<T>(selector: (state: TroubleshootState) => T): T {
  return useStore(troubleshootStore, selector);
}

async function load() {
  try {
    troubleshootStore.setState({ diagnostics: await loadDiagnostics(), error: null });
  } catch (error) {
    troubleshootStore.setState({ error: error instanceof Error ? error.message : String(error) });
  }
}

/** Troubleshooting from the palette, the settings menu and the home screen. */
export async function showTroubleshooting() {
  troubleshootStore.setState({ open: true, diagnostics: null, error: null });
  await load();
}

/** Check again: Windows' PATH first, so an agent installed since the start is found. */
export async function checkAgain() {
  try {
    await refreshPath();
  } catch {
    // The diagnostics still say what the PATH dummyPlane has finds.
  }
  await Promise.all([load(), agentsStore.getState().load().catch(() => undefined)]);
}
