import { createStore, useStore } from "zustand";
import type { TerminalPayload } from "@/nodes/types";
import { isRunning, terminalStatusStore } from "@/store/terminalStatus";

/**
 * What a launch reads from a terminal's payload: a running terminal keeps the values it started with.
 * Not the title: Claude gets it only when a new conversation starts (`-n`), and "Restart now" resumes the
 * one it has; the other agents never get it. A title changed while it runs is no reason to restart.
 */
export interface LaunchSettings {
  cwd: string;
  shell: string;
  /** Only a Custom terminal runs its command; the others ignore it. */
  command: string;
  /** Claude only, like the next three: its `--model`, "" for the model Claude picks itself. */
  model: string;
  /** `--effort`, "" for Claude's own level. */
  effort: string;
  /**
   * `--permission-mode`, "" for none. Not the same launch as "ask": any permission given also blocks
   * `git push` in the session's settings (`apply_permission`), none leaves Claude as the user set it up.
   */
  permission: string;
  /** The profile whose folder it starts with, "" for the default account. */
  accountId: string;
}

export const launchSettingsOf = (payload: TerminalPayload): LaunchSettings => {
  const claude = payload.agent === "claude";
  return {
    cwd: payload.cwd,
    shell: payload.shell,
    command: payload.agent === "custom" ? payload.command : "",
    model: claude ? (payload.model ?? "") : "",
    effort: claude ? (payload.effort ?? "") : "",
    permission: claude ? (payload.permission ?? "") : "",
    accountId: claude ? (payload.accountId ?? "") : "",
  };
};

const KEYS = ["cwd", "shell", "command", "model", "effort", "permission", "accountId"] as const satisfies readonly (keyof LaunchSettings)[];

/**
 * The launch settings a running terminal started with, noted when they first
 * change during that session. A terminal that stops loses its note: it starts
 * with whatever is stored.
 */
const startedStore = createStore<Record<string, LaunchSettings>>()(() => ({}));

let watching = false;
function forgetStopped() {
  if (watching) return;
  watching = true;
  terminalStatusStore.subscribe(({ statuses }) => {
    const started = startedStore.getState();
    const kept = Object.fromEntries(Object.entries(started).filter(([id]) => statuses[id]?.state === "running"));
    if (Object.keys(kept).length !== Object.keys(started).length) startedStore.setState(kept, true);
  });
}

/** Before a launch setting of a terminal changes (its folder, shell, command, model, effort, permission or account): a running one keeps what it started with. */
export function noteLaunchChange(nodeId: string, before: TerminalPayload) {
  if (!isRunning(nodeId) || nodeId in startedStore.getState()) return;
  forgetStopped();
  startedStore.setState({ [nodeId]: launchSettingsOf(before) });
}

/** The terminal restarts now: it starts with what is stored. */
export function forgetStartedLaunch(nodeId: string) {
  const started = startedStore.getState();
  if (nodeId in started) startedStore.setState(Object.fromEntries(Object.entries(started).filter(([id]) => id !== nodeId)), true);
}

/** The launch settings the running terminal's session started with: the noted ones once one changed, else `current`'s. */
export function useStartedLaunch(nodeId: string, current: TerminalPayload | undefined): LaunchSettings | undefined {
  const started = useStore(startedStore, (s) => s[nodeId]);
  return started ?? (current && launchSettingsOf(current));
}

/** Whether the running terminal's session started with other launch settings than `current` has. */
export function useLaunchRestartPending(nodeId: string, current: TerminalPayload | undefined): boolean {
  return useStore(startedStore, (s) => {
    const started = s[nodeId];
    if (!started || !current) return false;
    const now = launchSettingsOf(current);
    return KEYS.some((key) => started[key] !== now[key]);
  });
}
