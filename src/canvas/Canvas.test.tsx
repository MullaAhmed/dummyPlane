// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Canvas } from "./Canvas";

vi.mock("@excalidraw/excalidraw", () => ({}));
const { loadScene } = vi.hoisted(() => ({ loadScene: vi.fn() }));
vi.mock("./sceneCache", () => ({ loadScene, rememberScene: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  loadScene.mockReset();
  document.body.replaceChildren();
});

it("says that a workspace could not load, and tries again, the keyboard kept on the status (P2 #44)", async () => {
  // The first read fails; the second one is still under way.
  loadScene.mockRejectedValueOnce(new Error("database is locked")).mockReturnValueOnce(new Promise(() => {}));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Canvas workspaceId="w1" />));
  const status = host.querySelector<HTMLElement>("[role='status']")!;
  expect(status.textContent).toContain("Could not load this workspace: Error: database is locked");
  const retry = [...status.querySelectorAll("button")].find((button) => button.textContent === "Try again")!;
  expect(retry).toBeDefined();
  retry.focus();
  await act(async () => retry.click());
  expect(loadScene).toHaveBeenCalledTimes(2);
  expect(loadScene).toHaveBeenLastCalledWith("w1");
  // The same status, now loading: the focus did not fall to the page's body.
  expect(host.querySelector("[role='status']")).toBe(status);
  expect(status.textContent).toBe("Loading…");
  expect(document.activeElement).toBe(status);
  await act(async () => root.unmount());
});

it("says it is loading, to screen readers too", async () => {
  loadScene.mockReturnValueOnce(new Promise(() => {}));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Canvas workspaceId="w1" />));
  expect(host.querySelector("[role='status']")?.textContent).toBe("Loading…");
  await act(async () => root.unmount());
});
