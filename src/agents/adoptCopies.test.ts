// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { framesFromScene } from "@/canvas/groups";
import { nodesStore, terminalOf } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { adoptCopies } from "./terminals";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { IMMEDIATELY: "i", NEVER: "n" },
  newElementWith: (e: object, patch: object) => ({ ...e, ...patch }),
}));
vi.mock("@/nodes/terminal/registry", () => ({ markForAutostart: vi.fn() }));
vi.mock("@/canvas/arrive", () => ({ revealNode: vi.fn() }));

const group = (id: string, pantheon: string) =>
  ({ id, type: "frame", x: 0, y: 0, width: 800, height: 400, isDeleted: false, frameId: null, groupIds: [], customData: { dummyplane: { kind: "group", role: "backend", pantheon } } }) as unknown as ExcalidrawElement;
const terminal = (id: string, frameId: string, link: string | null) =>
  ({ id, type: "embeddable", x: 0, y: 0, width: 300, height: 200, isDeleted: false, frameId, groupIds: [], link, customData: { kind: "terminal" } }) as unknown as ExcalidrawElement;

let scene: ExcalidrawElement[] = [];

beforeEach(async () => {
  mockIPC(() => undefined);
  nodesStore.getState().forgetWorkspace("w1");
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "shell", cwd: "C:/code", shell: "default", command: "" },
  });
  scene = [group("g1", "egyptian"), terminal("batman", "g1", "dummyplane://terminal/batman"), group("copy", "egyptian"), terminal("batman2", "copy", "dummyplane://terminal/batman")];
  canvasStore.setState({
    api: {
      getSceneElementsIncludingDeleted: () => scene,
      getSceneElements: () => scene,
      updateScene: ({ elements }: { elements?: ExcalidrawElement[] }) => {
        if (elements) scene = elements;
      },
    } as unknown as ExcalidrawImperativeAPI,
    frames: framesFromScene(scene),
  });
  workspacesStore.setState({ workspaces: [{ id: "w1", projectId: "p1", name: "A", position: 0, pantheon: "greek" }] } as never);
});

it("gives a group copied whole a pantheon of its own and names its agents from it", async () => {
  await adoptCopies("w1", [{ id: "batman2", sourceId: "batman" }]);
  const pantheonOf = (id: string) => (scene.find((e) => e.id === id)!.customData!.dummyplane as { pantheon: string }).pantheon;
  expect(pantheonOf("g1")).toBe("egyptian");
  const copied = pantheonOf("copy");
  expect(["egyptian", "greek"]).not.toContain(copied);
  // The copy's agent is named from the new pantheon, not Batman again or another Egyptian name.
  const name = terminalOf(nodesStore.getState().nodes.batman2)!.name;
  expect(name).not.toBe("Batman");
  expect(name).toMatch(/\S/);
  const egyptianNames = ["Batman", "Superman", "Aquaman", "Flash", "Robin", "Cyborg", "Shazam", "Batgirl"];
  expect(egyptianNames.some((n) => name === n || name.startsWith(`${n} `))).toBe(false);
});

it("unfolds a folded group copied whole: its copies would never mount, nor start (review)", async () => {
  const folded = group("copy", "egyptian");
  scene = [group("g1", "egyptian"), terminal("batman", "g1", "dummyplane://terminal/batman"), { ...folded, customData: { dummyplane: { ...(folded.customData!.dummyplane as object), folded: true } } } as ExcalidrawElement, terminal("batman2", "copy", "dummyplane://terminal/batman")];
  canvasStore.setState({ frames: framesFromScene(scene) });
  await adoptCopies("w1", [{ id: "batman2", sourceId: "batman" }]);
  const copy = scene.find((e) => e.id === "copy")!;
  expect((copy.customData!.dummyplane as Record<string, unknown>).folded).toBeUndefined();
});

it("gives a minimized terminal's copy the height its card stood for: the copy starts open", async () => {
  nodesStore.getState().update("batman", { minimized: true, expandedHeight: 520 });
  scene = scene.map((e) => (e.id === "batman" || e.id === "batman2" ? ({ ...e, height: 68 } as ExcalidrawElement) : e));
  await adoptCopies("w1", [{ id: "batman2", sourceId: "batman" }]);
  expect(scene.find((e) => e.id === "batman2")!.height).toBe(520);
  expect(scene.find((e) => e.id === "batman")!.height).toBe(68);
  expect(terminalOf(nodesStore.getState().nodes.batman2)?.minimized).toBeUndefined();
});

it("gives a copied output a node of its own, with the same content, its link pointed at it", async () => {
  const output = { title: "Tests", source: "batman", ui: 'root = Stack([Text("ok")])', updatedAt: 1 };
  await nodesStore.getState().create("o1", { workspaceId: "w1", kind: "output", payload: output });
  const element = (id: string) => ({ id, type: "embeddable", x: 0, y: 0, width: 560, height: 520, isDeleted: false, frameId: null, groupIds: [], link: "dummyplane://output/o1", customData: { kind: "output" } }) as unknown as ExcalidrawElement;
  scene = [element("o1"), element("o2")];
  await adoptCopies("w1", [{ id: "o2", sourceId: "o1" }]);
  expect(nodesStore.getState().nodes.o2).toEqual({ workspaceId: "w1", kind: "output", payload: output });
  expect(scene.find((e) => e.id === "o2")!.link).toBe("dummyplane://output/o2");
  // Each its own: changing the copy leaves the first as it was.
  nodesStore.getState().update("o2", { title: "Copy" });
  expect(nodesStore.getState().nodes.o1).toMatchObject({ payload: { title: "Tests" } });
});
