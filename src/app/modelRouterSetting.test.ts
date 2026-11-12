// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { errorToasts } from "@/lib/errorToast.testkit";
import { DEFAULT_CLI_LEVELS, loadModelRouter, modelRouterStore, setCliLevel, setModelRouterOn } from "./modelRouterSetting";

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

const savedSettings = () => calls.filter(([cmd]) => cmd === "set_setting").map(([, args]) => args);

beforeEach(() => {
  calls = [];
  modelRouterStore.setState(modelRouterStore.getInitialState());
});
afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe("the model router setting", () => {
  it("is on until turned off, with no other CLI mapped: no Codex id is invented", () => {
    expect(modelRouterStore.getInitialState()).toEqual({ on: true, levels: {} });
    expect(DEFAULT_CLI_LEVELS).toEqual({});
  });

  it("reads the saved choice and map at boot", async () => {
    backend({ "agents.modelRouter": false, "agents.modelRouterLevels": { codex: { faible: "gpt-mini", eleve: "gpt-big" } } });
    await loadModelRouter();
    expect(modelRouterStore.getState()).toEqual({ on: false, levels: { codex: { faible: "gpt-mini", eleve: "gpt-big" } } });
    expect(calls.filter(([cmd]) => cmd === "get_setting").map(([, args]) => args)).toEqual([{ key: "agents.modelRouter" }, { key: "agents.modelRouterLevels" }]);
  });

  it("stays on when nothing was saved, and takes only a saved false for off", async () => {
    backend();
    await loadModelRouter();
    expect(modelRouterStore.getState()).toEqual({ on: true, levels: {} });
    backend({ "agents.modelRouter": "off", "agents.modelRouterLevels": { codex: { moyen: "bad model" } } });
    await loadModelRouter();
    // A model no command line takes is dropped, as an unknown CLI would be.
    expect(modelRouterStore.getState()).toEqual({ on: true, levels: {} });
  });

  it("keeps the defaults when the settings cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    backend({}, ["get_setting"]);
    await expect(loadModelRouter()).resolves.toBeUndefined();
    expect(modelRouterStore.getState()).toEqual({ on: true, levels: {} });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("model router settings"));
  });
});

describe("changing it", () => {
  it("turns the router off and on at once, and saves it", async () => {
    backend();
    await setModelRouterOn(false);
    expect(modelRouterStore.getState().on).toBe(false);
    await setModelRouterOn(true);
    expect(savedSettings()).toEqual([
      { key: "agents.modelRouter", value: false },
      { key: "agents.modelRouter", value: true },
    ]);
  });

  it("maps a level's model for Codex, trimmed; an empty field clears it", async () => {
    backend();
    expect(await setCliLevel("codex", "faible", "  gpt-mini ")).toBe(true);
    expect(await setCliLevel("codex", "eleve", "gpt-big")).toBe(true);
    expect(modelRouterStore.getState().levels).toEqual({ codex: { faible: "gpt-mini", eleve: "gpt-big" } });
    expect(await setCliLevel("codex", "faible", "")).toBe(true);
    expect(modelRouterStore.getState().levels).toEqual({ codex: { eleve: "gpt-big" } });
    expect(await setCliLevel("codex", "eleve", "  ")).toBe(true);
    expect(modelRouterStore.getState().levels).toEqual({});
    expect(savedSettings()[savedSettings().length - 1]).toEqual({ key: "agents.modelRouterLevels", value: {} });
  });

  it("keeps nothing a command line would refuse, nor a Claude model for Codex", async () => {
    backend();
    await setCliLevel("codex", "moyen", "gpt-mid");
    for (const bad of ["gpt 5", "-m", "x;rm -rf", "sonnet", "claude-opus-5-5"]) {
      expect(await setCliLevel("codex", "moyen", bad)).toBe(false);
    }
    expect(modelRouterStore.getState().levels).toEqual({ codex: { moyen: "gpt-mid" } });
    expect(savedSettings()).toHaveLength(1);
  });

  it("keeps the choice for the session and says so when it cannot be saved", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    backend({}, ["set_setting"]);
    await setModelRouterOn(false);
    expect(modelRouterStore.getState().on).toBe(false);
    expect(errorToasts(error)).toEqual([{ title: "Could not save the setting", description: expect.stringContaining("set_setting failed") }]);
  });
});
