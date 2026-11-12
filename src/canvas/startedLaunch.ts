import { useStore } from "zustand";
import { sameFolder } from "@/nodes/terminal/folder";
import { launchSettingsOf, sameLaunch } from "@/nodes/terminal/launch";
import type { LaunchSettings, TerminalPayload } from "@/nodes/types";
import { terminalStatusStore } from "@/store/terminalStatus";

/**
 * What a running terminal's process started with, read from its node (`launched`, kept by `startSession`): it
 * outlives a webview reload as the process does. Undefined while it does not run, which then starts with
 * whatever is stored.
 */
function useLaunched(nodeId: string, current: TerminalPayload | undefined): LaunchSettings | undefined {
  const running = useStore(terminalStatusStore, (s) => s.statuses[nodeId]?.state === "running");
  return running ? current?.launched : undefined;
}

/** The launch settings the running terminal's session started with: those kept at its start, else `current`'s. */
export function useStartedLaunch(nodeId: string, current: TerminalPayload | undefined): LaunchSettings | undefined {
  const launched = useLaunched(nodeId, current);
  return launched ?? (current && launchSettingsOf(current));
}

/** Whether the running terminal's session started with other launch settings than `current` has. */
export function useLaunchRestartPending(nodeId: string, current: TerminalPayload | undefined): boolean {
  const launched = useLaunched(nodeId, current);
  return Boolean(launched && current && !sameLaunch(launched, launchSettingsOf(current)));
}

/** A running terminal moved to another folder: the one its process runs in, and the one its next launch starts in. */
export interface FolderMove {
  from: string;
  to: string;
}

/** The move a running terminal's restart would make, null when it runs in its folder (or does not run). */
export function useFolderMove(nodeId: string, current: TerminalPayload | undefined): FolderMove | null {
  const launched = useLaunched(nodeId, current);
  if (!launched || !current || sameFolder(launched.cwd, current.cwd)) return null;
  return { from: launched.cwd, to: current.cwd };
}
