// @vitest-environment happy-dom
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement } from "@/canvas/nodeElement";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { linkAgents, linkedAgentsOf } from "./agentLinks";
import { isWire } from "./wires";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "immediately" } }));

const element = (id: string, x: number) => ({ ...createNodeElement("terminal", { x, y: 0 }), id }) as unknown as ExcalidrawElement;
let scene: readonly ExcalidrawElement[] = [];
const updateScene = vi.fn(({ elements }: { elements: readonly ExcalidrawElement[] }) => void (scene = elements));
const wires = () => scene.filter((e) => !e.isDeleted && isWire(e));

beforeAll(async () => {
  mockIPC(() => undefined);
  workspacesStore.setState({ activeId: "w1" });
  canvasStore.setState({ api: { getSceneElementsIncludingDeleted: () => scene, updateScene } as never });
  const terminal = (id: string, agent: "claude" | "codex" | "shell") =>
    nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { title: "", name: id, agent, cwd: "C:/code", shell: "default", command: "" } });
  await terminal("isis", "claude");
  await terminal("thot", "codex");
  await terminal("sh", "shell");
});
beforeEach(() => {
  scene = [element("isis", 0), element("thot", 1200), element("sh", 2400)];
  updateScene.mockClear();
});

it("wires two agents in one undo step, then reads the link from both ends", () => {
  linkAgents("isis", "thot");
  expect(updateScene).toHaveBeenCalledTimes(1);
  expect(updateScene.mock.calls[0][0]).toMatchObject({ captureUpdate: "immediately" });
  expect(wires()).toHaveLength(1);
  expect(linkedAgentsOf("isis")).toEqual([{ nodeId: "thot", name: "thot", outgoing: true }]);
  expect(linkedAgentsOf("thot")).toEqual([{ nodeId: "isis", name: "isis", outgoing: false }]);
});

it("writes nothing for a pair already linked, either way round, nor for an agent and itself", () => {
  linkAgents("isis", "thot");
  linkAgents("thot", "isis");
  linkAgents("isis", "thot");
  linkAgents("isis", "isis");
  expect(updateScene).toHaveBeenCalledTimes(1);
  expect(wires()).toHaveLength(1);
});

it("never links a plain shell", () => {
  linkAgents("isis", "sh");
  linkAgents("sh", "isis");
  expect(updateScene).not.toHaveBeenCalled();
  expect(linkedAgentsOf("isis")).toEqual([]);
});
