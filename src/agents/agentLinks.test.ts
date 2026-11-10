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
  await terminal("batman", "claude");
  await terminal("cyborg", "codex");
  await terminal("sh", "shell");
});
beforeEach(() => {
  scene = [element("batman", 0), element("cyborg", 1200), element("sh", 2400)];
  updateScene.mockClear();
});

it("wires two agents in one undo step, then reads the link from both ends", () => {
  linkAgents("batman", "cyborg");
  expect(updateScene).toHaveBeenCalledTimes(1);
  expect(updateScene.mock.calls[0][0]).toMatchObject({ captureUpdate: "immediately" });
  expect(wires()).toHaveLength(1);
  expect(linkedAgentsOf("batman")).toEqual([{ nodeId: "cyborg", name: "cyborg", outgoing: true }]);
  expect(linkedAgentsOf("cyborg")).toEqual([{ nodeId: "batman", name: "batman", outgoing: false }]);
});

it("writes nothing for a pair already linked, either way round, nor for an agent and itself", () => {
  linkAgents("batman", "cyborg");
  linkAgents("cyborg", "batman");
  linkAgents("batman", "cyborg");
  linkAgents("batman", "batman");
  expect(updateScene).toHaveBeenCalledTimes(1);
  expect(wires()).toHaveLength(1);
});

it("never links a plain shell", () => {
  linkAgents("batman", "sh");
  linkAgents("sh", "batman");
  expect(updateScene).not.toHaveBeenCalled();
  expect(linkedAgentsOf("batman")).toEqual([]);
});
