// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { cellAt, freeCell, groupGrid } from "@/agents/groupLayout";
import { laneCover } from "@/agents/laneCover";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { createGroupFrame, type Rect } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import { laneStore } from "@/shell/lane";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { subagentNodesStore } from "./store";
import { ensureSubagentNode } from "./sync";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { IMMEDIATELY: "i", NEVER: "n" },
  newElementWith: (e: object, patch: object) => ({ ...e, ...patch }),
}));

let scene: ExcalidrawElement[] = [];
const rect = (e: Rect): Rect => ({ x: e.x, y: e.y, width: e.width, height: e.height });
const meets = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const at = (id: string) => scene.find((e) => e.id === id)!;

/**
 * The harness's scene of sub-agents-and-outputs 11 on 09689fca: the group Frontend at 100 %, one column (Batman,
 * Superman, Aquaman, and Flash, pinned below Aquaman off the lane), its frame grown to hold the four.
 */
function frontend(): ExcalidrawElement[] {
  const grid = groupGrid(4);
  const frame = { ...createGroupFrame({ x: 0, y: 0, width: grid.width, height: grid.height }, "Frontend", { role: "general", pantheon: "norse" }), id: "frontend" } as unknown as ExcalidrawElement;
  const member = (id: string, row: number) =>
    ({ ...createNodeElement("terminal", { x: 0, y: 0 }), id, x: cellAt(frame, 0, row).x, y: cellAt(frame, 0, row).y, frameId: "frontend" }) as unknown as ExcalidrawElement;
  return [member("batman", 0), member("superman", 1), member("aquaman", 2), member("flash", 3), frame];
}

beforeEach(() => {
  scene = frontend();
  workspacesStore.setState({ activeId: "w1" });
  const payload = (name: string) => ({ title: name, name, agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "" });
  nodesStore.setState({
    nodes: Object.fromEntries(["batman", "superman", "aquaman", "flash"].map((id) => [id, { workspaceId: "w1", kind: "terminal" as const, payload: payload(id) }])),
  });
  subagentNodesStore.setState({ agents: {}, dismissed: {} });
  laneStore.setState({ occupants: [] });
  canvasStore.setState({
    view: { ...EMPTY_VIEW, width: 1440, height: 900, zoom: 1 },
    api: {
      getSceneElementsIncludingDeleted: () => scene,
      getSceneElements: () => scene.filter((e) => !e.isDeleted),
      updateScene: ({ elements }: { elements?: ExcalidrawElement[] }) => {
        if (elements) scene = elements;
      },
    } as unknown as ExcalidrawImperativeAPI,
  });
});

/** Batman's Claude opens its own sub-agent (Task: Explore); the card is made as the app makes it. */
function batmanExplores(): ExcalidrawElement {
  subagentNodesStore.getState().upsert({ nodeId: "batman", agentId: "explore", agentType: "Explore", state: "running" });
  const id = ensureSubagentNode("explore");
  return scene.find((e) => e.id === id)!;
}

describe("a Claude subagent's card while the Agents panel stands in the lane (sub-agents-and-outputs 11-13)", () => {
  it("joins its terminal's group left of the lane, not in the cell beside it under the panel", () => {
    laneStore.setState({ occupants: ["agents"] });
    const lane = laneCover(canvasStore.getState().view, true)!;
    const members = scene.filter((e) => e.frameId === "frontend");
    // The group's next cell, as it was chosen before: beside Batman, under the lane.
    expect(meets(freeCell(at("frontend"), members).cell, lane)).toBe(true);
    const card = batmanExplores();
    expect(card.frameId).toBe("frontend");
    expect(meets(rect(card), lane)).toBe(false);
    for (const id of ["batman", "superman", "aquaman", "flash"]) expect(meets(rect(card), rect(at(id)))).toBe(false);
    // Down the column: the row under Flash.
    expect({ x: card.x, y: card.y }).toEqual({ x: cellAt(at("frontend"), 0, 4).x, y: cellAt(at("frontend"), 0, 4).y });
  });

  it("takes the group's next cell as before with the lane free", () => {
    const members = scene.filter((e) => e.frameId === "frontend");
    const before = freeCell(at("frontend"), members).cell;
    const card = batmanExplores();
    expect({ x: card.x, y: card.y }).toEqual({ x: before.x, y: before.y });
  });
});
