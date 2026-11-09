// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import {
  DEFAULT_MAX_SPAWNED,
  loadSubagentSettings,
  readMaxSpawned,
  setMaxSpawned,
  setSubagentTerminalsSetting,
  subagentSettingsStore,
} from "./subagentSettings";

/** The IPC calls made, in order. */
let calls: [string, unknown][];

/** Answers `get_setting` from `saved`, records every call; `fail` makes the named commands throw. */
function backend(saved: Record<string, unknown> = {}, fail: string[] = []) {
  mockIPC((cmd, args) => {
    calls.push([cmd, args]);
    if (fail.includes(cmd)) throw new Error(`${cmd} failed`);
    if (cmd === "get_setting") return saved[(args as { key: string }).key] ?? null;
    return undefined;
  });
}

const pushed = () => calls.filter(([cmd]) => cmd === "set_subagent_terminals").map(([, args]) => args);
const savedSettings = () => calls.filter(([cmd]) => cmd === "set_setting").map(([, args]) => args);

beforeEach(() => {
  calls = [];
  subagentSettingsStore.setState(subagentSettingsStore.getInitialState());
});
afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe("the sub-agent settings", () => {
  it("open sub-agents as terminals, six at once at most, until changed", () => {
    expect(DEFAULT_MAX_SPAWNED).toBe(6);
    expect(subagentSettingsStore.getInitialState()).toEqual({ terminals: true, maxSpawned: 6 });
  });

  it("read the saved choices at boot and tell the hooks whether to deny the built-in sub-agents", async () => {
    backend({ "agents.subagentTerminals": false, "agents.maxSpawned": 4 });
    await loadSubagentSettings();
    expect(subagentSettingsStore.getState()).toEqual({ terminals: false, maxSpawned: 4 });
    expect(calls.filter(([cmd]) => cmd === "get_setting").map(([, args]) => args)).toEqual([
      { key: "agents.subagentTerminals" },
      { key: "agents.maxSpawned" },
    ]);
    expect(pushed()).toEqual([{ on: false }]);
    // Told once the settings are read, so the hooks follow what was saved.
    expect(calls[calls.length - 1]).toEqual(["set_subagent_terminals", { on: false }]);
  });

  it("keep the defaults when nothing was saved, and push them too", async () => {
    backend();
    await loadSubagentSettings();
    expect(subagentSettingsStore.getState()).toEqual({ terminals: true, maxSpawned: 6 });
    expect(pushed()).toEqual([{ on: true }]);
  });

  it("take only a saved false for off", async () => {
    backend({ "agents.subagentTerminals": "off" });
    await loadSubagentSettings();
    expect(subagentSettingsStore.getState().terminals).toBe(true);
    expect(pushed()).toEqual([{ on: true }]);
  });

  for (const max of ["8", 0, -2, 2.5, true, {}]) {
    it(`fall back to six for an unreadable cap (${JSON.stringify(max)})`, async () => {
      backend({ "agents.maxSpawned": max });
      await loadSubagentSettings();
      expect(subagentSettingsStore.getState().maxSpawned).toBe(DEFAULT_MAX_SPAWNED);
    });
  }

  it("keep the defaults when the settings cannot be read, and still push them", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    subagentSettingsStore.setState({ terminals: true, maxSpawned: 6 });
    backend({}, ["get_setting"]);
    await expect(loadSubagentSettings()).resolves.toBeUndefined();
    expect(subagentSettingsStore.getState()).toEqual({ terminals: true, maxSpawned: 6 });
    expect(pushed()).toEqual([{ on: true }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sub-agent settings"));
  });

  it("boot on, without error, when the hooks cannot be told", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    backend({ "agents.subagentTerminals": false }, ["set_subagent_terminals"]);
    await expect(loadSubagentSettings()).resolves.toBeUndefined();
    expect(subagentSettingsStore.getState().terminals).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sub-agent terminals"));
  });
});

describe("changing them", () => {
  it("turning terminals off applies at once, tells the hooks and saves the choice", async () => {
    backend();
    await setSubagentTerminalsSetting(false);
    expect(subagentSettingsStore.getState().terminals).toBe(false);
    expect(pushed()).toEqual([{ on: false }]);
    expect(savedSettings()).toEqual([{ key: "agents.subagentTerminals", value: false }]);
    await setSubagentTerminalsSetting(true);
    expect(subagentSettingsStore.getState().terminals).toBe(true);
    expect(pushed()).toEqual([{ on: false }, { on: true }]);
  });

  it("keeps the choice for the session and says so when it cannot be saved", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    backend({}, ["set_setting"]);
    await setSubagentTerminalsSetting(false);
    expect(subagentSettingsStore.getState().terminals).toBe(false);
    expect(pushed()).toEqual([{ on: false }]);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Setting not saved: .*set_setting failed/));
  });

  it("sets and saves the cap of sub-agents at once", async () => {
    backend();
    await setMaxSpawned(8);
    expect(subagentSettingsStore.getState().maxSpawned).toBe(8);
    expect(savedSettings()).toEqual([{ key: "agents.maxSpawned", value: 8 }]);
    // Not a cap: the default instead, saved as such.
    await setMaxSpawned(0);
    expect(subagentSettingsStore.getState().maxSpawned).toBe(DEFAULT_MAX_SPAWNED);
    expect(savedSettings()[1]).toEqual({ key: "agents.maxSpawned", value: DEFAULT_MAX_SPAWNED });
    // The cap does not reach the hooks.
    expect(pushed()).toEqual([]);
  });

  it("reads a cap as a whole number of 1 at least", () => {
    expect(readMaxSpawned(1)).toBe(1);
    expect(readMaxSpawned(12)).toBe(12);
    for (const raw of [0, -1, 1.5, NaN, "4", null, undefined]) expect(readMaxSpawned(raw), String(raw)).toBe(DEFAULT_MAX_SPAWNED);
  });
});
