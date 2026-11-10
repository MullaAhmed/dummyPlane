// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { toast } from "sonner";
import { canvasStore } from "@/canvas/canvasStore";
import { forgetScene, rememberScene } from "@/canvas/sceneCache";
import { focusTerminal, startUnseen } from "@/nodes/terminal/registry";
import { workspacesStore } from "@/store/workspaces";
import { quietly } from "./arrivals";
import { addTerminal, MOUNT_WAIT_MS } from "./terminals";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { IMMEDIATELY: "i", NEVER: "n" },
  newElementWith: (e: object, patch: object) => ({ ...e, ...patch }),
}));
vi.mock("@/nodes/terminal/registry", () => ({ markForAutostart: vi.fn(), startUnseen: vi.fn(), focusTerminal: vi.fn(), expandTerminal: vi.fn() }));
vi.mock("@/nodes/terminal/minimize", () => ({ expandTerminal: vi.fn(() => false) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/commands/goToRun", () => ({ goTo: vi.fn() }));

const payload = { title: "T", name: "Storm", agent: "claude", cwd: "C:/code", shell: "default", command: "" } as const;
// Far from the view (0, 0, 1200 x 800 at 100 %): Excalidraw would mount it only once the view had moved there.
const FAR = { x: 9000, y: 0 };

let scene: { id: string }[] = [];
let app = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 1200, height: 800 };
let api: { updateScene: ReturnType<typeof vi.fn>; scrollToContent: ReturnType<typeof vi.fn> };
let field: HTMLInputElement;

beforeEach(() => {
  vi.useFakeTimers();
  mockIPC(() => undefined);
  vi.clearAllMocks();
  scene = [];
  app = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 1200, height: 800 };
  api = {
    updateScene: vi.fn(({ elements }: { elements?: typeof scene }) => {
      if (elements) scene = elements;
    }),
    scrollToContent: vi.fn(),
  };
  workspacesStore.setState({ activeId: "w1", workspaces: [{ id: "w1", name: "Main" }] as never });
  canvasStore.setState({
    api: { ...api, getSceneElementsIncludingDeleted: () => scene, getSceneElements: () => scene, getAppState: () => app } as unknown as ExcalidrawImperativeAPI,
  });
  // The user is typing in a field of the page.
  field = document.createElement("input");
  document.body.appendChild(field);
  field.focus();
});

afterEach(() => {
  // A notice still waiting for its burst to end would be lost with the fake clock, and the next test would find it pending.
  vi.runAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

it("a terminal that arrives on its own starts, and leaves the view, the keyboard and the activation alone", async () => {
  const id = await addTerminal("w1", payload, FAR, null, quietly("mission"));
  expect(id).not.toBeNull();
  expect(scene.map((e) => e.id)).toContain(id);
  // Excalidraw is given a render to mount it, which would start it sized; one still waiting then starts as in a workspace not on screen.
  expect(startUnseen).not.toHaveBeenCalled();
  vi.advanceTimersByTime(MOUNT_WAIT_MS);
  expect(startUnseen).toHaveBeenCalledWith(id, payload);
  // The view: nothing scrolled, no scene update carried an app state (view, activation, selection).
  expect(api.scrollToContent).not.toHaveBeenCalled();
  expect(api.updateScene.mock.calls.every(([update]) => !("appState" in update))).toBe(true);
  expect(app).toMatchObject({ scrollX: 0, scrollY: 0, zoom: { value: 1 } });
  // The keyboard.
  expect(document.activeElement).toBe(field);
  expect(focusTerminal).not.toHaveBeenCalled();
});

it("tells of it with a notice that holds back the focus too", async () => {
  await addTerminal("w1", payload, FAR, null, quietly("mission"));
  expect(toast).not.toHaveBeenCalled();
  vi.advanceTimersByTime(500);
  expect(toast).toHaveBeenCalledWith("Storm joined the mission", expect.objectContaining({ action: expect.objectContaining({ label: "Show" }) }));
  expect(document.activeElement).toBe(field);
});

it("starts one of a workspace not on screen at once: nothing will mount it", async () => {
  workspacesStore.setState({ activeId: "other" });
  rememberScene("w1", [], {} as never, {}, []);
  const id = await addTerminal("w1", payload, FAR, null, quietly("mission"));
  expect(startUnseen).toHaveBeenCalledWith(id, payload);
  expect(api.scrollToContent).not.toHaveBeenCalled();
  forgetScene("w1");
});

it("one launched by the user still comes into view, and says nothing", async () => {
  const id = await addTerminal("w1", payload, FAR);
  expect(api.scrollToContent).toHaveBeenCalledWith(expect.objectContaining({ id }), expect.objectContaining({ animate: true }));
  // The canvas mounts it there, which starts it.
  expect(startUnseen).not.toHaveBeenCalled();
  vi.advanceTimersByTime(500);
  expect(toast).not.toHaveBeenCalled();
});
