// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement } from "@/canvas/nodeElement";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { subagentNodesStore } from "./store";
import { ensureSubagentNode, removeSubagentNodes } from "./sync";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { IMMEDIATELY: "i", NEVER: "n" },
  newElementWith: (e: object, patch: object) => ({ ...e, ...patch }),
}));

let scene: ExcalidrawElement[] = [];
const captures: unknown[] = [];
const terminal = { ...createNodeElement("terminal", { x: 0, y: 0 }), id: "n1" } as unknown as ExcalidrawElement;
const running = { nodeId: "n1", agentType: "Explore", state: "running" as const };

beforeEach(() => {
  scene = [terminal];
  captures.length = 0;
  workspacesStore.setState({ activeId: "w1" });
  nodesStore.setState({
    nodes: { n1: { workspaceId: "w1", kind: "terminal", payload: { title: "T", name: "Aquaman", agent: "claude", cwd: "C:/code", shell: "default", command: "" } } },
  });
  subagentNodesStore.setState({ agents: {}, dismissed: {} });
  canvasStore.setState({
    api: {
      getSceneElementsIncludingDeleted: () => scene,
      getSceneElements: () => scene.filter((e) => !e.isDeleted),
      updateScene: ({ elements, captureUpdate }: { elements?: ExcalidrawElement[]; captureUpdate?: unknown }) => {
        if (elements) scene = elements;
        captures.push(captureUpdate);
      },
    } as unknown as ExcalidrawImperativeAPI,
  });
});

const nodeOf = (agentId: string) => scene.find((e) => e.id === subagentNodesStore.getState().agents[agentId]?.elementId);

describe("subagent nodes on the canvas", () => {
  it("gives a subagent one node below its terminal, outside the undo history", () => {
    subagentNodesStore.getState().upsert({ ...running, agentId: "a1" });
    const id = ensureSubagentNode("a1");
    expect(id).toBeDefined();
    expect(ensureSubagentNode("a1")).toBe(id);
    expect(scene.filter((e) => e.customData?.kind === "subagent")).toHaveLength(1);
    expect(nodeOf("a1")).toMatchObject({ customData: { kind: "subagent", agentId: "a1", parentNodeId: "n1" } });
    expect(nodeOf("a1")!.y).toBeGreaterThan(terminal.y + terminal.height);
    expect(captures).toEqual(["n"]);
  });

  it("places a nested subagent below its parent subagent, the parent first if it had no node yet", () => {
    subagentNodesStore.getState().upsert({ ...running, agentId: "a1" });
    subagentNodesStore.getState().upsert({ ...running, agentId: "a2", parentAgentId: "a1" });
    ensureSubagentNode("a2");
    const parent = nodeOf("a1")!;
    const child = nodeOf("a2")!;
    expect(child.y).toBeGreaterThan(parent.y + parent.height - 1);
    expect(child.x).toBe(parent.x);
  });

  it("never places again a node the user deleted", () => {
    subagentNodesStore.getState().upsert({ ...running, agentId: "a1" });
    const id = ensureSubagentNode("a1");
    scene = scene.map((e) => (e.id === id ? { ...e, isDeleted: true } : e));
    expect(ensureSubagentNode("a1")).toBeUndefined();
    expect(subagentNodesStore.getState().dismissed.a1).toBe(true);
    expect(scene.filter((e) => e.customData?.kind === "subagent" && !e.isDeleted)).toHaveLength(0);
  });

  it("waits for its terminal's workspace to be known", () => {
    subagentNodesStore.getState().upsert({ ...running, nodeId: "elsewhere", agentId: "a1" });
    expect(ensureSubagentNode("a1")).toBeUndefined();
    expect(scene).toEqual([terminal]);
  });

  it("removes the nodes of a session that ended, and forgets them", () => {
    subagentNodesStore.getState().upsert({ ...running, agentId: "a1" });
    subagentNodesStore.getState().upsert({ ...running, agentId: "a2", state: "done" });
    ensureSubagentNode("a1");
    ensureSubagentNode("a2");
    removeSubagentNodes("n1");
    expect(scene.filter((e) => e.customData?.kind === "subagent" && !e.isDeleted)).toHaveLength(0);
    expect(scene.find((e) => e.id === "n1")?.isDeleted).toBeFalsy();
    expect(subagentNodesStore.getState().agents).toEqual({});
  });
});
