// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { flushAll } from "@/lib/flush";
import { keepSettingAside, onSettingKept, saveFiles, saveNode, saveScene, setSetting } from "./db";

afterEach(() => clearMocks());

it("never lets a scene save overtake a node save sent before it", async () => {
  const started: string[] = [];
  let release!: () => void;
  mockIPC((cmd) => {
    started.push(cmd);
    if (cmd === "save_node") return new Promise<void>((resolve) => (release = resolve));
  });
  const node = saveNode("n1", "w1", "terminal", "{}");
  const scene = saveScene("w1", "[]", "{}", ["n1"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(started).toEqual(["save_node"]);
  release();
  await Promise.all([node, scene]);
  expect(started).toEqual(["save_node", "save_scene"]);
});

it("flushing before close waits for writes already in the queue", async () => {
  let release!: () => void;
  mockIPC((cmd) => {
    if (cmd === "save_files") return new Promise<void>((resolve) => (release = resolve));
  });
  void saveFiles("w1", []);
  let flushed = false;
  const flushing = flushAll().then(() => (flushed = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(flushed).toBe(false);
  release();
  await flushing;
  expect(flushed).toBe(true);
});

it("sends camelCase arguments", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    received = { cmd, args };
  });
  await saveScene("w1", "[1]", '{"zoom":1}', ["a"]);
  expect(received).toEqual({
    cmd: "save_scene",
    args: { workspaceId: "w1", elementsJson: "[1]", appStateJson: '{"zoom":1}', nodeIds: ["a"] },
  });
});

it("tells the listeners when a write kept the text of a value it could not read, and only then", async () => {
  let answer: string | null = "loops.list.unreadable";
  mockIPC((cmd) => (cmd === "set_setting" ? answer : undefined));
  const told: [string, string][] = [];
  const off = onSettingKept((key, aside) => told.push([key, aside]));
  await setSetting("loops.list", []);
  expect(told).toEqual([["loops.list", "loops.list.unreadable"]]);
  // Nothing kept (a value that read, or a text kept already): nothing said.
  answer = null;
  await setSetting("loops.list", [1]);
  expect(told).toHaveLength(1);
  off();
  answer = "loops.list.unreadable.2";
  await setSetting("loops.list", []);
  expect(told).toHaveLength(1);
});

it("asks Rust to keep the text of a value read only in part, and tells the listeners, in part or whole", async () => {
  let answer: string | null = "presets.teams.unreadable";
  const asked: unknown[] = [];
  mockIPC((cmd, args) => {
    if (cmd !== "keep_setting") return undefined;
    asked.push(args);
    return answer;
  });
  const told: [string, string, boolean][] = [];
  const off = onSettingKept((key, aside, some) => told.push([key, aside, some]));
  await keepSettingAside("presets.teams", true);
  await keepSettingAside("presets.teams", false);
  expect(asked).toEqual([{ key: "presets.teams" }, { key: "presets.teams" }]);
  expect(told).toEqual([
    ["presets.teams", "presets.teams.unreadable", true],
    ["presets.teams", "presets.teams.unreadable", false],
  ]);
  // Kept already: nothing said.
  answer = null;
  await keepSettingAside("presets.teams", true);
  expect(told).toHaveLength(2);
  off();
});
