// @vitest-environment happy-dom
import { STORED_FLEET_KIND } from "@/canvas/nodeElement";
import { beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { markForAutostart } from "@/nodes/terminal/registry";
import { nodesStore, sessionOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { uiStore } from "@/store/ui";
import { agentsStore } from "@/agents/agentsStore";
import { addFleet, addFleetToGroup, requestCloseFleet } from "./fleets";
import { adoptCopies } from "@/agents/terminals";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "i", NEVER: "n" }, newElementWith: (e: object, patch: object) => ({ ...e, ...patch }) }));
vi.mock("@/nodes/terminal/registry", () => ({ markForAutostart: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

let scene: { id: string; isDeleted?: boolean; link?: string; customData?: object; type?: string; frameId?: string | null }[] = [];
beforeEach(() => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  agentsStore.setState({ agents: [{ id: "claude", available: true }], shells: [], loaded: true });
  scene = [];
  const api = {
    getSceneElementsIncludingDeleted: () => scene,
    getSceneElements: () => scene,
    updateScene: ({ elements }: { elements?: typeof scene }) => {
      if (elements) scene = elements;
    },
  };
  canvasStore.setState({ api: api as unknown as ExcalidrawImperativeAPI });
});

it("places a fleet with its Claude session, started when shown", async () => {
  await addFleet("w1", { x: 0, y: 0 });
  const id = scene[0].id;
  expect(sessionOf(nodesStore.getState().nodes[id])).toMatchObject({ agent: "claude", role: "orchestrator", name: "Fleet" });
  expect(markForAutostart).toHaveBeenCalledWith(id);
});

it("starts the Fleet's session in the folder of its workspace, else in the project's", async () => {
  const { projectsStore } = await import("@/store/projects");
  const { workspacesStore } = await import("@/store/workspaces");
  projectsStore.setState({ projects: [{ id: "p1", name: "api", path: "C:/code/api", lastOpenedAt: 0, missing: false } as never], activeId: "p1" });
  const own = (id: string, folder: string | null) => ({ id, projectId: "p1", name: id, position: 0, pantheon: null, kind: "canvas" as const, folder });
  workspacesStore.setState({ projectId: "p1", workspaces: [own("w1", "D:/work/lib"), own("w2", null)], activeId: "w2", status: "ready" });
  // Named: the Fleet belongs to the workspace it is placed in, not to the active one.
  await addFleet("w1", { x: 0, y: 0 });
  expect(sessionOf(nodesStore.getState().nodes[scene[0].id])?.cwd).toBe("D:/work/lib");
  await addFleet("w2", { x: 500, y: 0 });
  expect(sessionOf(nodesStore.getState().nodes[scene[1].id])?.cwd).toBe("C:/code/api");
  projectsStore.setState({ projects: [], activeId: null });
  workspacesStore.setState({ workspaces: [], activeId: null });
});

it("refuses a fleet without Claude Code, and creates nothing", async () => {
  agentsStore.setState({ agents: [{ id: "claude", available: false }], shells: [], loaded: true });
  await addFleet("w1", { x: 0, y: 0 });
  expect(scene).toEqual([]);
  expect(markForAutostart).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(
    'Claude Code is not installed: a fleet needs it. Install it (see "Getting started" on the home screen), then try again.',
  );
});

it("looks for the agents first when they were never listed", async () => {
  agentsStore.setState({ agents: [], shells: [], loaded: false });
  mockIPC((cmd) => (cmd === "list_agents" ? [{ id: "claude", available: false }] : cmd === "list_shells" ? [] : undefined));
  await addFleet("w1", { x: 0, y: 0 });
  expect(scene).toEqual([]);
  expect(toast.error).toHaveBeenCalled();
});

it("gives a copied fleet a session of its own, created when shown", async () => {
  const session = { title: "Chef", name: "Chef", agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "", claudeSessionId: "s1", role: "orchestrator" as const };
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", session } });
  scene = [{ id: "copie", type: "embeddable", customData: { kind: STORED_FLEET_KIND }, frameId: null }];
  await adoptCopies("w1", [{ id: "copie", sourceId: "chef" }]);
  expect(nodesStore.getState().nodes.copie.payload).toEqual({ name: "Chef" });
});

it("takes back a copied fleet when Claude Code is not installed", async () => {
  agentsStore.setState({ agents: [{ id: "claude", available: false }], shells: [], loaded: true });
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
  scene = [{ id: "copie-refusee", type: "embeddable", customData: { kind: STORED_FLEET_KIND }, frameId: null }];
  await adoptCopies("w1", [{ id: "copie-refusee", sourceId: "chef" }]);
  expect(nodesStore.getState().nodes["copie-refusee"]).toBeUndefined();
  expect(scene[0].isDeleted).toBe(true);
  expect(toast.error).toHaveBeenCalled();
});

it("asks before closing a working fleet, with its wires; a stopped one goes at once", () => {
  const wire = { id: "fil", type: "arrow", startBinding: { elementId: "chef" }, endBinding: { elementId: "batman" } };
  scene = [{ id: "chef", type: "embeddable" }, wire as (typeof scene)[number], { id: "batman", type: "embeddable" }];
  terminalStatusStore.getState().set("chef", { state: "running" });
  requestCloseFleet("chef");
  expect(uiStore.getState().closing).toEqual({ agents: ["chef"], remove: ["chef", "fil"] });
  expect(scene.some((e) => e.isDeleted)).toBe(false);
  uiStore.getState().setClosing(null);
  terminalStatusStore.getState().set("chef", { state: "stopped" });
  requestCloseFleet("chef");
  expect(uiStore.getState().closing).toBeNull();
  expect(scene.filter((e) => e.isDeleted).map((e) => e.id)).toEqual(["chef", "fil"]);
});

it("puts a second fleet of the same group clear of the first", async () => {
  const frame = { id: "g1", type: "frame", x: 1000, y: 0, width: 600, height: 400, isDeleted: false, frameId: null, customData: { dummyplane: { kind: "group", role: "backend", pantheon: "egypt" } } };
  scene = [frame];
  canvasStore.setState({
    frames: [{ id: "g1", name: "G", x: 1000, y: 0, width: 600, height: 400, group: { role: "backend", pantheon: "egypt" }, memberIds: [] }],
  });
  const { workspacesStore } = await import("@/store/workspaces");
  workspacesStore.setState({ activeId: "w1" } as never);
  await addFleetToGroup("g1");
  await addFleetToGroup("g1");
  const chefs = scene.filter((e) => e.type === "embeddable") as unknown as { x: number; y: number; width: number; height: number }[];
  expect(chefs).toHaveLength(2);
  const [a, b] = chefs;
  const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps).toBe(false);
});

it("tells which fleet it posed, and null when Claude Code is missing (plan presets)", async () => {
  const frame = { id: "g1", type: "frame", x: 1000, y: 0, width: 600, height: 400, isDeleted: false, frameId: null, customData: { dummyplane: { kind: "group", role: "backend", pantheon: "egypt" } } };
  scene = [frame];
  canvasStore.setState({
    frames: [{ id: "g1", name: "G", x: 1000, y: 0, width: 600, height: 400, group: { role: "backend", pantheon: "egypt" }, memberIds: [] }],
  });
  const { workspacesStore } = await import("@/store/workspaces");
  workspacesStore.setState({ activeId: "w1" } as never);
  const id = await addFleetToGroup("g1");
  expect(id).toBe((scene.find((e) => e.type === "embeddable") as { id: string }).id);
  agentsStore.setState({ agents: [{ id: "claude", available: false }], shells: [], loaded: true });
  expect(await addFleetToGroup("g1")).toBeNull();
  expect(await addFleetToGroup("nope")).toBeNull();
});
