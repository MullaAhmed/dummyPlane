import { toastError } from "@/lib/errorToast";
import { createStore, useStore } from "zustand";
import { messages } from "@/i18n";
import { setSubagentTerminals } from "@/ipc/app";
import { getSetting, setSetting } from "@/ipc/db";
import { appMessages } from "./messages";

const TERMINALS_KEY = "agents.subagentTerminals";
const MAX_KEY = "agents.maxSpawned";

/** Sub-agents opened with spawn_agent that may run at once, all trees together. */
export const DEFAULT_MAX_SPAWNED = 6;
/** What the Settings menu offers for that cap. */
export const MAX_SPAWNED_CHOICES: readonly number[] = [2, 4, 6, 8, 12];

interface SubagentSettings {
  /**
   * "Sub-agents open as terminals": Claude's built-in Agent/Task tool is
   * denied (a PreToolUse hook, decided in Rust) and agents delegate with
   * spawn_agent. Off, the built-in sub-agents run and show as read-only mirrors.
   */
  terminals: boolean;
  maxSpawned: number;
}

export const subagentSettingsStore = createStore<SubagentSettings>()(() => ({ terminals: true, maxSpawned: DEFAULT_MAX_SPAWNED }));
export const useSubagentSettings = <T,>(selector: (s: SubagentSettings) => T) => useStore(subagentSettingsStore, selector);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A whole number of 1 at least, else the default. */
export function readMaxSpawned(raw: unknown): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_MAX_SPAWNED;
}

/** Tells Rust whether to deny the built-in sub-agents; a failure leaves its default (on). */
function pushToHooks(on: boolean) {
  return setSubagentTerminals(on).catch((error: unknown) => console.warn(`sub-agent terminals: ${message(error)}`));
}

/** At boot. An unreadable setting keeps the defaults. */
export async function loadSubagentSettings() {
  try {
    const [terminals, max] = await Promise.all([getSetting<unknown>(TERMINALS_KEY), getSetting<unknown>(MAX_KEY)]);
    subagentSettingsStore.setState({ terminals: terminals !== false, maxSpawned: readMaxSpawned(max) });
  } catch (error) {
    console.warn(`sub-agent settings: ${message(error)}`);
  }
  await pushToHooks(subagentSettingsStore.getState().terminals);
}

const saved = (key: string, value: unknown) =>
  setSetting(key, value).catch((error: unknown) => toastError(messages(appMessages).settingNotSaved, { error, next: messages(appMessages).settingForNow }));

export async function setSubagentTerminalsSetting(terminals: boolean) {
  subagentSettingsStore.setState({ terminals });
  await Promise.all([pushToHooks(terminals), saved(TERMINALS_KEY, terminals)]);
}

export async function setMaxSpawned(maxSpawned: number) {
  subagentSettingsStore.setState({ maxSpawned: readMaxSpawned(maxSpawned) });
  await saved(MAX_KEY, subagentSettingsStore.getState().maxSpawned);
}
