// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { revealNode } from "@/canvas/arrive";
import { groupInfoOf, type Rect } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { frameAround, GROUP_GAP, ROW_GAP } from "./groupLayout";
import { spawnAgent } from "./spawn";
import { withFamilyGroup } from "./spawnGroup";
import { layoutSpawnTree } from "./spawnLayout";
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
const options = { label: () => "Batman's sub-agents", pantheon: "norse", isManager: () => false, fullRect: rect };

beforeEach(async () => {
  mockIPC(() => undefined);
  vi.mocked(revealNode).mockClear();
  nodesStore.setState({ nodes: {} });
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: terminal("Batman") });
  scene = [node("terminal", "batman", 0, 0)];
});

describe("withFamilyGroup", () => {
  it("frames the parent and the spot its first sub-agent takes right of it, the parent in the frame, the frame last", () => {
    const parent = at("batman");
    const result = withFamilyGroup(scene, "batman", () => null, options)!;
    const frame = result.elements[result.elements.length - 1];
    expect(frame.id).toBe(result.frameId);
    expect(groupInfoOf(frame)).toEqual({ role: "general", pantheon: "norse" });
    const spot = { x: parent.x + parent.width + GROUP_GAP, y: parent.y, width: parent.width, height: parent.height };
    expect(rect(frame)).toEqual(frameAround([rect(parent), spot]));
    expect(result.elements.find((e) => e.id === "batman")!.frameId).toBe(frame.id);
  });

  it("lets its quick note stand where it is, and gives no group to a parent in a frame", () => {
    const note = node("note", "note", 736, 0, { note: { of: "batman", x: "right", dx: 16, y: "top", dy: 0 } });
    expect(withFamilyGroup([...scene, note], "batman", () => null, options)).not.toBeNull();
    const framed = scene.map((e) => ({ ...e, frameId: "plain" }));
    expect(withFamilyGroup(framed, "batman", () => null, options)).toBeNull();
  });
});

describe("a family's group as spawn_agent leaves it", () => {
  it("holds the parent and its sub-agents laid out as their flowchart, the frame fitted to them, after one sub-agent and after two", async () => {
    await spawnAgent("batman", { task: "One" });
    const frames = () => scene.filter((e) => e.type === "frame" && !e.isDeleted);
    expect(frames()).toHaveLength(1);
    const [frame] = frames();
    expect(frame).toMatchObject({ name: "Batman's sub-agents" });
    const batman = at("batman");
    const [first] = scene.filter((e) => spawnedBy(e.id) === "batman");
    expect({ x: first.x, y: first.y }).toEqual({ x: batman.x + batman.width + GROUP_GAP, y: batman.y });
    const members = () => scene.filter((e) => !e.isDeleted && e.frameId === frame.id);
    expect(members().map((e) => e.id).sort()).toEqual(["batman", first.id].sort());
    expect(rect(at(frame.id))).toEqual(frameAround(members().map(rect)));

    await spawnAgent("batman", { task: "Two" });
    expect(frames()).toHaveLength(1);
    const second = scene.find((e) => spawnedBy(e.id) === "batman" && e.id !== first.id)!;
    expect(second.frameId).toBe(frame.id);
    expect({ x: second.x, y: second.y }).toEqual({ x: first.x, y: first.y + first.height + ROW_GAP });
    expect(rect(at(frame.id))).toEqual(frameAround(members().map(rect)));
    // Laid out already: the next reflow moves nothing. And it arrived quietly: the view never moved to it.
    expect(layoutSpawnTree(scene, spawnedBy, "batman")).toBeNull();
    expect(revealNode).not.toHaveBeenCalled();
  });
});
