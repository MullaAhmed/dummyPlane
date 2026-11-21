// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { revealNode } from "@/canvas/arrive";
import { createGroupFrame, type Rect } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { laneStore } from "@/shell/lane";
import { LANE_ROOM } from "@/shell/layout";
import { workspacesStore } from "@/store/workspaces";
import { cellAt, groupGrid } from "./groupLayout";
import { laneCover } from "./laneCover";
import { spawnAgent } from "./spawn";
import { spawnedBy } from "./spawnTree";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { IMMEDIATELY: "i", NEVER: "n" },
  newElementWith: (e: { version: number }, patch: object) => ({ ...e, ...patch, version: e.version + 1 }),
}));
vi.mock("@/nodes/terminal/registry", () => ({
  markForAutostart: vi.fn(),
  startUnseen: vi.fn(),
  disposeTerminal: vi.fn(),
  freshText: vi.fn(() => ""),
  quietFor: vi.fn(() => 0),
}));
vi.mock("@/canvas/arrive", () => ({ revealNode: vi.fn(() => true) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/ipc/pty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/pty")>()),
  ptySendText: vi.fn(() => Promise.resolve()),
  ptyWrite: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/mission/ready", () => ({ whenReady: vi.fn(() => Promise.resolve(true)) }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));
vi.mock("./naming", () => {
  let n = 0;
  return { nameForNewAgent: vi.fn(() => Promise.resolve(`Odin${++n}`)), pantheonForNewGroup: vi.fn(() => "norse") };
});

/** The workspace's scene, stored (not on screen): addTerminal and the tree's reflow both write it. */
let scene: ExcalidrawElement[] = [];
vi.mock("./sceneAccess", () => ({
  sceneAccess: vi.fn(() => ({ shown: false, elements: () => scene, write: (elements: readonly ExcalidrawElement[]) => (scene = [...elements]) })),
}));
vi.mock("@/canvas/sceneCache", () => ({
  cachedElements: vi.fn(() => scene),
  editStoredScene: vi.fn((_id: string, elements: readonly ExcalidrawElement[]) => (scene = [...elements])),
}));

const terminal = (name: string, extra: Partial<TerminalPayload> = {}): TerminalPayload => ({
  title: name,
  name,
  agent: "claude",
  cwd: "C:/code/wt",
  shell: "pwsh",
  command: "",
  claudeSessionId: `${name}-session`,
  ...extra,
});

const node = (kind: "terminal" | "note", id: string, x: number, y: number, data: object = {}) => {
  const base = createNodeElement(kind, { x: 0, y: 0 }) as unknown as ExcalidrawElement;
  return { ...base, id, x, y, customData: { ...base.customData, ...data } } as ExcalidrawElement;
};

const rect = (e: Rect): Rect => ({ x: e.x, y: e.y, width: e.width, height: e.height });
const at = (id: string) => scene.find((e) => e.id === id)!;


/** The harness's scene of sub-agents-and-outputs 08: the group Frontend, one column (Batman, Superman, Aquaman), at 100 %. */
function frontend() {
  const grid = groupGrid(3);
  const frame = { ...createGroupFrame({ x: 0, y: 0, width: grid.width, height: grid.height }, "Frontend", { role: "general", pantheon: "norse" }), id: "frontend" } as unknown as ExcalidrawElement;
  const member = (id: string, row: number) => ({ ...node("terminal", id, cellAt(frame, 0, row).x, cellAt(frame, 0, row).y), frameId: "frontend" }) as ExcalidrawElement;
  return [member("batman", 0), member("superman", 1), member("aquaman", 2), frame];
}

/** A 1440x900 view at the scene's origin, 100 %, the Agents panel open in the lane, on the workspace w1. */
function laneOpen() {
  workspacesStore.setState({ activeId: "w1" });
  canvasStore.setState({ view: { ...EMPTY_VIEW, width: 1440, height: 900, zoom: 1, scrollX: 0, scrollY: 0 } });
  laneStore.setState({ occupants: ["agents"] });
}

const meets = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

beforeEach(async () => {
  mockIPC(() => undefined);
  vi.mocked(revealNode).mockClear();
  nodesStore.setState({ nodes: {} });
  for (const name of ["batman", "superman", "aquaman"]) await nodesStore.getState().create(name, { workspaceId: "w1", kind: "terminal", payload: terminal(name) });
  scene = frontend();
  laneStore.setState({ occupants: [] });
  canvasStore.setState({ view: EMPTY_VIEW });
});

describe("a sub-agent spawn_agent opens while the Agents panel stands in the lane (sub-agents-and-outputs 09-11)", () => {
  it("lands out from under the lane, in its parent's group", async () => {
    laneOpen();
    const lane = laneCover(canvasStore.getState().view, true)!;
    expect(lane).toEqual({ x: 1440 - LANE_ROOM, y: 0, width: LANE_ROOM, height: 900 });
    // Right of Batman, where the flowchart sets a first child, stands under the lane.
    expect(meets({ ...rect(at("batman")), x: at("batman").x + at("batman").width + 32 }, lane)).toBe(true);
    await spawnAgent("batman", { task: "Flash's task" });
    const [flash] = scene.filter((e) => spawnedBy(e.id) === "batman" && !e.isDeleted);
    expect(flash.frameId).toBe("frontend");
    expect(meets(rect(flash), lane)).toBe(false);
    // Clear of its group's members too.
    for (const id of ["batman", "superman", "aquaman"]) expect(meets(rect(flash), rect(at(id)))).toBe(false);
    // Down its parent's column, where its placement put it (freeCellClear): the layout leaves it there, pinned.
    expect({ x: flash.x, y: flash.y }).toEqual({ x: cellAt(at("frontend"), 0, 3).x, y: cellAt(at("frontend"), 0, 3).y });
    expect(flash.customData?.pinned).toBe(true);
    // It arrived quietly: the view never moved to it.
    expect(revealNode).not.toHaveBeenCalled();
  });

  it("keeps a second sub-agent out from under the lane too", async () => {
    laneOpen();
    const lane = laneCover(canvasStore.getState().view, true)!;
    await spawnAgent("batman", { task: "One" });
    await spawnAgent("batman", { task: "Two" });
    const children = scene.filter((e) => spawnedBy(e.id) === "batman" && !e.isDeleted);
    expect(children).toHaveLength(2);
    for (const child of children) expect(meets(rect(child), lane)).toBe(false);
    expect(meets(rect(children[0]), rect(children[1]))).toBe(false);
  });

  it("takes its flowchart place right of its parent, unpinned, with the lane free", async () => {
    workspacesStore.setState({ activeId: "w1" });
    canvasStore.setState({ view: { ...EMPTY_VIEW, width: 1440, height: 900, zoom: 1 } });
    await spawnAgent("batman", { task: "Flash's task" });
    const [flash] = scene.filter((e) => spawnedBy(e.id) === "batman" && !e.isDeleted);
    expect(flash.x).toBeGreaterThan(at("batman").x + at("batman").width);
    expect(flash.y).toBe(at("batman").y);
    expect(flash.customData?.pinned).not.toBe(true);
  });

  it("takes its flowchart place when its canvas is not the one on screen: the lane is another canvas's", async () => {
    laneOpen();
    workspacesStore.setState({ activeId: "w2" });
    await spawnAgent("batman", { task: "Flash's task" });
    const [flash] = scene.filter((e) => spawnedBy(e.id) === "batman" && !e.isDeleted);
    expect(flash.y).toBe(at("batman").y);
    expect(flash.customData?.pinned).not.toBe(true);
  });
});
