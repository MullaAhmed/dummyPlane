// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { workspacesStore } from "@/store/workspaces";
import { exportCurrentPng, exportCurrentScene, importIntoScene } from "./sceneActions";
import { exportPng, exportScene, importScene } from "./sceneFiles";

vi.mock("./sceneFiles", () => ({
  exportScene: vi.fn(() => Promise.resolve(true)),
  importScene: vi.fn(() => Promise.reject(new Error("unreadable file"))),
  exportPng: vi.fn(() => Promise.resolve(true)),
}));

const api = {} as ExcalidrawImperativeAPI;

beforeEach(() => {
  canvasStore.setState({ api });
  workspacesStore.setState({ workspaces: [{ id: "w1", name: "Backend" }], activeId: "w1" } as never);
});
afterEach(() => vi.restoreAllMocks());

it("exports the scene on screen under its workspace's name, as the settings menu did", async () => {
  exportCurrentScene();
  exportCurrentPng();
  expect(exportScene).toHaveBeenCalledWith(api, "Backend");
  expect(vi.mocked(exportPng).mock.calls[0].slice(0, 2)).toEqual([api, "Backend"]);
});

it("says so when an import fails", async () => {
  const error = vi.spyOn(toast, "error").mockImplementation(() => "");
  importIntoScene();
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Import failed: .*unreadable file/)));
  expect(importScene).toHaveBeenCalledWith(api);
});
