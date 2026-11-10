// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { revealNode } from "@/canvas/arrive";
import { canvasStore } from "@/canvas/canvasStore";
import { startUnseen } from "@/nodes/terminal/registry";
import { workspacesStore } from "@/store/workspaces";
import { quietly } from "./arrivals";
import { addTerminal } from "./terminals";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { IMMEDIATELY: "i", NEVER: "n" },
  newElementWith: (e: object, patch: object) => ({ ...e, ...patch }),
}));
vi.mock("@/nodes/terminal/registry", () => ({ markForAutostart: vi.fn(), startUnseen: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/canvas/arrive", () => ({ revealNode: vi.fn(() => true) }));

let scene: { id: string }[] = [];

beforeEach(() => {
  mockIPC(() => undefined);
  vi.mocked(revealNode).mockClear();
  vi.mocked(startUnseen).mockClear();
  scene = [];
  workspacesStore.setState({ activeId: "w1" });
  canvasStore.setState({
    api: {
      getSceneElementsIncludingDeleted: () => scene,
      getSceneElements: () => scene,
      updateScene: ({ elements }: { elements?: typeof scene }) => {
        if (elements) scene = elements;
      },
    } as unknown as ExcalidrawImperativeAPI,
  });
});

it("scrolls to the agent it added: out of sight it would neither show nor start (plan B1)", async () => {
  const id = await addTerminal("w1", { title: "T", name: "T", agent: "shell", cwd: "C:/code", shell: "default", command: "" }, { x: 9000, y: 0 });
  expect(id).not.toBeNull();
  expect(revealNode).toHaveBeenCalledWith(id);
});

it("leaves the view alone for an agent that arrives on its own, and starts it all the same", async () => {
  const payload = { title: "T", name: "T", agent: "claude", cwd: "C:/code", shell: "default", command: "" } as const;
  const id = await addTerminal("w1", payload, { x: 9000, y: 0 }, null, quietly("mission"));
  expect(revealNode).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(startUnseen).toHaveBeenCalledWith(id, payload));
});

it("unfolds the group it joins: in a folded group the agent would never mount, nor start (review)", async () => {
  scene = [{ id: "g1", type: "frame", x: 0, y: 0, width: 400, height: 300, isDeleted: false, customData: { dummyplane: { kind: "group", role: "general", pantheon: "egyptian", folded: true } } } as never];
  await addTerminal("w1", { title: "T", name: "T", agent: "shell", cwd: "C:/code", shell: "default", command: "" }, { x: 10, y: 10 }, "g1");
  const frame = scene.find((e) => e.id === "g1") as unknown as { customData: { dummyplane: Record<string, unknown> } };
  expect(frame.customData.dummyplane.folded).toBeUndefined();
  expect(frame.customData.dummyplane).toMatchObject({ kind: "group", pantheon: "egyptian" });
});

it("two launches at the same center, outside any group, do not overlap one another (placement)", async () => {
  const payload = { title: "T", name: "T", agent: "shell", cwd: "C:/code", shell: "default", command: "" } as const;
  await addTerminal("w1", payload, { x: 0, y: 0 });
  await addTerminal("w1", payload, { x: 0, y: 0 });
  const [first, second] = scene as unknown as { x: number; y: number; width: number; height: number }[];
  const overlaps = first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height;
  expect(overlaps).toBe(false);
});
