// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { returnKeyboardToCanvas } from "@/canvas/keyboardFocus";
import { canvasStore } from "@/canvas/canvasStore";
import { workspacesStore } from "@/store/workspaces";
import { closeGroup, ungroup } from "./groups";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "i" }, newElementWith: (e: object, patch: object) => ({ ...e, ...patch }) }));
vi.mock("@/nodes/terminal/registry", () => ({ markForAutostart: vi.fn() }));
vi.mock("@/canvas/keyboardFocus", () => ({ returnKeyboardToCanvas: vi.fn() }));

beforeEach(() => {
  mockIPC(() => undefined);
  vi.mocked(returnKeyboardToCanvas).mockClear();
  canvasStore.setState({
    api: {
      getSceneElements: () => [],
      getSceneElementsIncludingDeleted: () => [],
      updateScene: vi.fn(),
      getAppState: () => ({ width: 1400, height: 800 }),
      scrollToContent: vi.fn(),
    } as unknown as ExcalidrawImperativeAPI,
  });
  workspacesStore.setState({ activeId: "w1" });
});

it("gives Excalidraw its keyboard back after Dégrouper and Fermer le groupe (plan B1)", () => {
  ungroup("g");
  expect(returnKeyboardToCanvas).toHaveBeenCalledTimes(1);
  closeGroup("g");
  expect(returnKeyboardToCanvas).toHaveBeenCalledTimes(2);
});
