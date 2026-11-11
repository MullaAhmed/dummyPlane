// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { flushAll } from "@/lib/flush";
import { nodeNameOf, nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { assignMissingNames, nameForNewAgent, namesInWorkspace, pantheonForNewGroup, pantheonsForCopiedGroups } from "./naming";

const terminal = (name?: string) =>
  JSON.stringify({ title: "t", cwd: "C:/code", agent: "claude", shell: "default", command: "", ...(name ? { name } : {}) });

let pantheonSaves: string[] = [];

beforeEach(async () => {
  pantheonSaves = [];
  mockIPC((cmd, raw) => {
    const args = raw as Record<string, string>;
    if (cmd === "list_workspaces") return [{ id: "w1", projectId: "p1", name: "A", position: 0, pantheon: null }];
    if (cmd === "set_workspace_pantheon") pantheonSaves.push(args.pantheon);
    if (cmd === "get_setting") return null;
    return undefined;
  });
  await workspacesStore.getState().load("p1");
  nodesStore.getState().forgetWorkspace("w1");
  nodesStore.getState().hydrate("w1", [
    { id: "a", kind: "terminal", payloadJson: terminal() },
    { id: "b", kind: "terminal", payloadJson: terminal("Batman") },
    { id: "c", kind: "terminal", payloadJson: terminal() },
  ]);
});

afterEach(async () => {
  canvasStore.getState().setFrames([]);
  await flushAll(); // debounced node saves must not outlive the IPC mock
  clearMocks();
});

const nameOf = (id: string) => nodeNameOf(nodesStore.getState().nodes[id]);

it("names the terminals saved before names existed, in scene order", async () => {
  await assignMissingNames("w1", ["c", "b", "a"]);
  expect([nameOf("c"), nameOf("b"), nameOf("a")]).toEqual(["Superman", "Batman", "Aquaman"]);
  expect(pantheonSaves).toEqual(["dc"]);
});

it("gives a new agent the next free name of the workspace's pantheon", async () => {
  await assignMissingNames("w1", ["a", "b", "c"]);
  expect(await nameForNewAgent("w1")).toBe("Flash");
  expect(pantheonSaves).toEqual(["dc"]);
});

it("names each terminal once when two passes run at the same time (StrictMode)", async () => {
  await Promise.all([assignMissingNames("w1", ["a", "c"]), assignMissingNames("w1", ["a", "c"])]);
  expect([nameOf("a"), nameOf("c")]).toEqual(["Superman", "Aquaman"]);
});

const groupFrame = (id: string, pantheon: string) => ({
  id,
  name: id,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  group: { role: "general" as const, pantheon },
  memberIds: [],
});

it("keeps the pantheons of the groups for their own agents", async () => {
  canvasStore.getState().setFrames([groupFrame("g", "dc")]);
  expect(await nameForNewAgent("w1")).toBe("Thor");
  expect(pantheonSaves).toEqual(["marvel"]);
});

it("names a group's agent from the group's pantheon", async () => {
  expect(await nameForNewAgent("w1", "throne-of-glass")).toBe("Celaena");
  expect(pantheonSaves).toEqual([]);
});

it("gives a new group the first pantheon nobody in the workspace uses", async () => {
  await nameForNewAgent("w1"); // the agents outside groups take "dc"
  canvasStore.getState().setFrames([groupFrame("g", "marvel")]);
  expect(pantheonForNewGroup("w1")).toBe("throne-of-glass");
});

it("counts the old mythology a saved group has as the pantheon it reads as", async () => {
  await nameForNewAgent("w1"); // "dc"
  canvasStore.getState().setFrames([groupFrame("g", "greek")]); // reads as "marvel"
  expect(pantheonForNewGroup("w1")).toBe("throne-of-glass");
});

it("gives a copied group a pantheon of its own, the original keeping its own", () => {
  const group = (id: string, pantheon: string) =>
    ({ id, type: "frame", isDeleted: false, frameId: null, customData: { dummyplane: { kind: "group", role: "backend", pantheon } } }) as unknown as import("@excalidraw/excalidraw/element/types").ExcalidrawElement;
  const member = (id: string, frameId: string) =>
    ({ id, type: "embeddable", isDeleted: false, frameId, customData: { kind: "terminal" } }) as unknown as import("@excalidraw/excalidraw/element/types").ExcalidrawElement;
  const scene = [group("g1", "dc"), member("a", "g1"), group("copy", "dc"), member("a2", "copy")];
  const remapped = pantheonsForCopiedGroups(scene, new Set(["a2"]), "marvel");
  expect([...remapped.keys()]).toEqual(["copy"]);
  // Neither the original's pantheon nor the workspace's.
  expect(remapped.get("copy")).toBe("throne-of-glass");
  // A copy made inside its own group changes nothing.
  expect(pantheonsForCopiedGroups([group("g1", "dc"), member("a", "g1"), member("a2", "g1")], new Set(["a2"]), "marvel").size).toBe(0);
  // Two old mythologies that read as one pantheon would hand out the same names.
  const legacy = [group("g1", "egyptian"), member("a", "g1"), group("copy", "hindu"), member("a2", "copy")];
  expect([...pantheonsForCopiedGroups(legacy, new Set(["a2"]), "marvel").keys()]).toEqual(["copy"]);
});

it("reuses the name of a closed terminal, whose node stays in memory only for Ctrl+Z", async () => {
  const scene = [{ id: "a" }, { id: "b", isDeleted: true }, { id: "c" }];
  canvasStore.setState({ api: { getSceneElementsIncludingDeleted: () => scene } as never });
  expect(namesInWorkspace("w1")).toEqual([]);
  canvasStore.setState({ api: null });
  expect(namesInWorkspace("w1")).toEqual(["Batman"]);
});

it("keeps the name of an agent being created, and frees that of a closed one (review)", () => {
  const scene = [{ id: "a", isDeleted: true }];
  canvasStore.setState({ api: { getSceneElements: () => [], getSceneElementsIncludingDeleted: () => scene } as never });
  // `b`, not on the scene yet: its record is written first, and a second launch must not take its name.
  expect(namesInWorkspace("w1")).toContain("Batman");
  nodesStore.getState().update("a", { name: "Superman" });
  expect(namesInWorkspace("w1")).not.toContain("Superman");
  canvasStore.setState({ api: null });
});
