// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { TeamPreset } from "./model";
import { presetsStore } from "./store";

const preset = (name: string, id = name): TeamPreset => ({ id, name, savedAt: 1, groups: [{ name: "G", role: "docs", agents: ["claude"], x: 0, y: 0 }], fleets: [] });
// A preset as the setting holds it: the fleets are listed under the key they have always had, "orchestrators".
const savedPreset = (name: string, id = name) => ({ id, name, savedAt: 1, groups: [{ name: "G", role: "docs", agents: ["claude"], x: 0, y: 0 }], orchestrators: [] });

let saved: { key: string; value: unknown }[];
let stored: unknown;

beforeEach(() => {
  saved = [];
  stored = { version: 1, presets: [savedPreset("Dev HQ", "1")] };
  presetsStore.setState({ presets: [], loaded: false });
  mockIPC((cmd, args) => {
    if (cmd === "get_setting") return stored;
    if (cmd === "set_setting") saved.push(args as { key: string; value: unknown });
  });
});
afterEach(() => clearMocks());

it("loads the saved presets once, and reads nothing from a damaged setting", async () => {
  await presetsStore.getState().load();
  expect(presetsStore.getState().presets.map((p) => p.name)).toEqual(["Dev HQ"]);
  expect(presetsStore.getState().loaded).toBe(true);
  stored = "garbage";
  presetsStore.setState({ presets: [], loaded: false });
  await presetsStore.getState().load();
  expect(presetsStore.getState().presets).toEqual([]);
});

it("saves a preset under presets.teams, versioned, replacing one of the same name", async () => {
  await presetsStore.getState().load();
  expect(await presetsStore.getState().save(preset("Tests", "2"))).toBe(true);
  expect(await presetsStore.getState().save(preset("dev hq", "3"))).toBe(true);
  expect(saved[saved.length - 1]).toEqual({ key: "presets.teams", value: { version: 1, presets: [savedPreset("dev hq", "3"), savedPreset("Tests", "2")] } });
  expect(presetsStore.getState().presets.map((p) => p.id)).toEqual(["3", "2"]);
});

it("does not save over a list it has not read: a send before the load would overwrite the saved presets", async () => {
  let release: (value: unknown) => void = () => undefined;
  mockIPC((cmd, args) => {
    if (cmd === "get_setting") return new Promise((resolve) => (release = resolve));
    if (cmd === "set_setting") saved.push(args as { key: string; value: unknown });
  });
  const saving = presetsStore.getState().save(preset("Tests", "2"));
  release({ version: 1, presets: [savedPreset("Dev HQ", "1")] });
  await saving;
  expect(saved[saved.length - 1]?.value).toEqual({ version: 1, presets: [savedPreset("Dev HQ", "1"), savedPreset("Tests", "2")] });
});

it("removes a preset and saves the rest", async () => {
  await presetsStore.getState().load();
  await presetsStore.getState().remove("1");
  expect(presetsStore.getState().presets).toEqual([]);
  expect(saved[saved.length - 1]?.value).toEqual({ version: 1, presets: [] });
});

it("saves nothing over a list it could not read: a busy database must not wipe the presets (review)", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "get_setting") throw { kind: "db", message: "database is locked" };
    if (cmd === "set_setting") saved.push(args as { key: string; value: unknown });
  });
  await expect(presetsStore.getState().save(preset("Tests", "2"))).rejects.toThrow();
  await expect(presetsStore.getState().remove("1")).rejects.toThrow();
  expect(saved).toEqual([]);
  expect(presetsStore.getState().loaded).toBe(false);
});

it("has the text of a setting it reads only in part kept before anything is saved over it, once", async () => {
  const asked: string[] = [];
  mockIPC((cmd, args) => {
    asked.push(cmd);
    if (cmd === "get_setting") return stored;
    if (cmd === "keep_setting") return "presets.teams.unreadable";
    if (cmd === "set_setting") saved.push(args as { key: string; value: unknown });
  });
  // Another version: the list reads empty, and the save that follows would replace what the setting holds.
  stored = { version: 2, presets: [savedPreset("Newer", "9")] };
  await presetsStore.getState().load();
  expect(presetsStore.getState().presets).toEqual([]);
  expect(await presetsStore.getState().save(preset("Tests", "2"))).toBe(true);
  expect(asked).toEqual(["get_setting", "keep_setting", "set_setting"]);
  // A damaged preset among good ones: the good stay, the text is kept all the same.
  asked.length = 0;
  presetsStore.setState({ presets: [], loaded: false });
  stored = { version: 1, presets: [savedPreset("Dev HQ", "1"), { id: "2", name: "" }] };
  await presetsStore.getState().load();
  expect(presetsStore.getState().presets.map((p) => p.name)).toEqual(["Dev HQ"]);
  expect(asked).toEqual(["get_setting", "keep_setting"]);
});

it("keeps nothing aside for a setting it reads whole, or that was never saved", async () => {
  const asked: string[] = [];
  mockIPC((cmd) => {
    asked.push(cmd);
    return cmd === "get_setting" ? stored : null;
  });
  await presetsStore.getState().load();
  presetsStore.setState({ presets: [], loaded: false });
  stored = null;
  await presetsStore.getState().load();
  expect(asked).toEqual(["get_setting", "get_setting"]);
});
