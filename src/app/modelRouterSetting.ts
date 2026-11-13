import { toastError } from "@/lib/errorToast";
import { createStore, useStore } from "zustand";
import { messages } from "@/i18n";
import { getSetting, keepSettingAside, setSetting } from "@/ipc/db";
import { readCliLevels, readCliModel, type CliLevels, type Level, type MappedCli } from "@/mission/router";
import { appMessages } from "./messages";

const ON_KEY = "agents.modelRouter";
const LEVELS_KEY = "agents.modelRouterLevels";

/**
 * The models a non-Claude CLI starts with for each level until the user writes others. Empty: the only Codex id
 * this codebase names (`gpt-5.6-luna`, in tests) is what Codex showed on its own screen, its default, never a level's
 * choice; prefilling it would pin every Codex sub-agent to it and route nothing.
 */
export const DEFAULT_CLI_LEVELS: CliLevels = {};

interface ModelRouterSetting {
  /**
   * "Model router": on, every agent's sub-agents, hand_off tasks and mission team agents take the model of their
   * level, with no switch turned on anywhere; a terminal's or a Fleet's switch set off vetoes it for that node and
   * all it spawns (`@/mission/routerState`). Off, only a switch set on routes, as before the setting existed.
   */
  on: boolean;
  /** The models each level picks on CLIs other than Claude, whose own are fixed (`@/mission/router` LEVELS). */
  levels: CliLevels;
}

export const modelRouterStore = createStore<ModelRouterSetting>()(() => ({ on: true, levels: DEFAULT_CLI_LEVELS }));
export const useModelRouter = <T,>(selector: (s: ModelRouterSetting) => T) => useStore(modelRouterStore, selector);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * How much of a saved map `readCliLevels` leaves out: nothing, some of its models (one no command line would take, a
 * level or a CLI nobody knows), or all of them. What it leaves out is lost at the next save, unless its text is kept.
 */
export function levelsLeftOut(raw: unknown): "none" | "some" | "all" {
  if (raw === null || raw === undefined) return "none";
  if (typeof raw !== "object" || Array.isArray(raw)) return "all";
  const isMap = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  const held = Object.values(raw).reduce<number>((n, stored) => n + (isMap(stored) ? Object.keys(stored).length : 1), 0);
  const kept = Object.values(readCliLevels(raw)).reduce((n, models) => n + Object.keys(models ?? {}).length, 0);
  return kept === held ? "none" : kept === 0 ? "all" : "some";
}

/** At boot. An unreadable setting keeps the defaults: on, no other CLI mapped. */
export async function loadModelRouter() {
  try {
    const [on, levels] = await Promise.all([getSetting<unknown>(ON_KEY), getSetting<unknown>(LEVELS_KEY)]);
    modelRouterStore.setState({ on: on !== false });
    // Before the map is read into the store, or saved: what is left out is lost at the next save. A failed keep stops
    // the read of the map, as a failed read does: the defaults stay.
    const leftOut = levelsLeftOut(levels);
    if (leftOut !== "none") await keepSettingAside(LEVELS_KEY, leftOut === "some");
    modelRouterStore.setState({ levels: levels === null || levels === undefined ? DEFAULT_CLI_LEVELS : readCliLevels(levels) });
  } catch (error) {
    console.warn(`model router settings: ${message(error)}`);
  }
}

const saved = (key: string, value: unknown) =>
  setSetting(key, value).catch((error: unknown) => toastError(messages(appMessages).settingNotSaved, { error, next: messages(appMessages).settingForNow }));

export async function setModelRouterOn(on: boolean) {
  modelRouterStore.setState({ on });
  await saved(ON_KEY, on);
}

/**
 * The model `level` picks on `cli`: empty clears it (that level is not routed on that CLI). A model its command line
 * would refuse is not kept: false, and nothing changes.
 */
export async function setCliLevel(cli: MappedCli, level: Level, raw: string): Promise<boolean> {
  const model = readCliModel(raw);
  if (raw.trim() && !model) return false;
  const current = modelRouterStore.getState().levels;
  const models = { ...current[cli] };
  if (model) models[level] = model;
  else delete models[level];
  const levels: CliLevels = { ...current, [cli]: models };
  if (!Object.keys(models).length) delete levels[cli];
  modelRouterStore.setState({ levels });
  await saved(LEVELS_KEY, levels);
  return true;
}
