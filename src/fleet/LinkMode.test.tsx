// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { createNodeElement } from "@/canvas/nodeElement";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { linkAgents } from "./agentLinks";
import { LinkMode } from "./LinkMode";
import { linkOrchestrator } from "./orchestrators";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./orchestrators", () => ({ linkOrchestrator: vi.fn() }));
vi.mock("./agentLinks", async (importOriginal) => ({ ...(await importOriginal<typeof import("./agentLinks")>()), linkAgents: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const toggle = vi.fn();

beforeEach(async () => {
  document.body.innerHTML = '<button data-link-toggle="chef" id="finish">Terminer</button>';
  document.getElementById("finish")!.addEventListener("click", toggle);
  toggle.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  uiStore.setState({ linking: "chef" });
  await act(async () => root.render(<LinkMode />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  uiStore.setState({ linking: null });
  document.body.replaceChildren();
});

it("passes a click on Finish through the layer that covers it (plan B3)", async () => {
  Object.defineProperty(document, "elementsFromPoint", { value: () => [document.getElementById("finish")], configurable: true });
  const layer = host.ownerDocument.querySelector<HTMLElement>(".cursor-crosshair")!;
  await act(async () => layer.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 5 })));
  expect(toggle).toHaveBeenCalledTimes(1);
  // The mode is left to the button, not ended twice by the layer's own click-in-the-void rule.
  expect(uiStore.getState().linking).toBe("chef");
});

it("runs the other way from an agent's foot: a click on an orchestrator wires the agent to it, then the mode ends", async () => {
  mockIPC(() => undefined);
  Object.defineProperty(document, "elementsFromPoint", { value: () => [], configurable: true });
  const atlas = { ...createNodeElement("orchestrator", { x: 400, y: 400 }), id: "atlas" } as unknown as ExcalidrawElement;
  const isis = { ...createNodeElement("terminal", { x: 1600, y: 400 }), id: "isis" } as unknown as ExcalidrawElement;
  await nodesStore.getState().create("isis", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Isis", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  await act(async () => {
    canvasStore.setState({ api: { getSceneElements: () => [atlas, isis] } as never, view: EMPTY_VIEW, frames: [], links: { atlas: { nodeIds: [], groupIds: [] } } });
    uiStore.setState({ linking: "isis" });
  });
  expect(document.body.textContent).toContain("Click another agent or a fleet to link this agent");
  const layer = host.ownerDocument.querySelector<HTMLElement>(".cursor-crosshair")!;
  // A click on the agent itself designates nothing from its end: it ends the mode without a wire.
  await act(async () => layer.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: isis.x + 10, clientY: isis.y + 10 })));
  expect(linkOrchestrator).not.toHaveBeenCalled();
  expect(uiStore.getState().linking).toBeNull();
  await act(async () => uiStore.setState({ linking: "isis" }));
  const layerAgain = host.ownerDocument.querySelector<HTMLElement>(".cursor-crosshair")!;
  await act(async () => layerAgain.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: atlas.x + 10, clientY: atlas.y + 10 })));
  expect(linkOrchestrator).toHaveBeenCalledWith("atlas", "isis");
  expect(linkAgents).not.toHaveBeenCalled();
  expect(uiStore.getState().linking).toBeNull();
  await act(async () => canvasStore.setState({ api: null, links: {} }));
});

it("links two agents from an agent's foot with no orchestrator on the canvas, and never to a plain shell", async () => {
  mockIPC(() => undefined);
  vi.mocked(linkOrchestrator).mockClear();
  vi.mocked(linkAgents).mockClear();
  Object.defineProperty(document, "elementsFromPoint", { value: () => [], configurable: true });
  const isis = { ...createNodeElement("terminal", { x: 400, y: 400 }), id: "isis" } as unknown as ExcalidrawElement;
  const thot = { ...createNodeElement("terminal", { x: 1600, y: 400 }), id: "thot" } as unknown as ExcalidrawElement;
  const sh = { ...createNodeElement("terminal", { x: 400, y: 1600 }), id: "sh" } as unknown as ExcalidrawElement;
  const terminal = (id: string, agent: "claude" | "shell") =>
    nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { title: id, name: id, agent, cwd: "C:/code", shell: "default", command: "" } });
  await terminal("isis", "claude");
  await terminal("thot", "claude");
  await terminal("sh", "shell");
  await act(async () => {
    canvasStore.setState({ api: { getSceneElements: () => [isis, thot, sh] } as never, view: EMPTY_VIEW, frames: [], links: {} });
    uiStore.setState({ linking: "isis" });
  });
  const click = async (at: ExcalidrawElement) => {
    const layer = host.ownerDocument.querySelector<HTMLElement>(".cursor-crosshair")!;
    await act(async () => layer.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: at.x + 10, clientY: at.y + 10 })));
  };
  // A shell would run the linked agent's messages as commands: it designates nothing, the mode ends.
  await click(sh);
  expect(linkAgents).not.toHaveBeenCalled();
  expect(uiStore.getState().linking).toBeNull();
  await act(async () => uiStore.setState({ linking: "isis" }));
  await click(thot);
  expect(linkAgents).toHaveBeenCalledWith("isis", "thot");
  expect(linkOrchestrator).not.toHaveBeenCalled();
  expect(uiStore.getState().linking).toBeNull();
  await act(async () => canvasStore.setState({ api: null, links: {} }));
});

it("takes another node's Link for a place on that node, not for the linker's Done", async () => {
  mockIPC(() => undefined);
  vi.mocked(linkOrchestrator).mockClear();
  const atlas = { ...createNodeElement("orchestrator", { x: 400, y: 400 }), id: "atlas" } as unknown as ExcalidrawElement;
  await nodesStore.getState().create("isis", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Isis", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  // The orchestrator's "+ Link" lies under the pointer, inside the orchestrator.
  const atlasLink = document.createElement("button");
  atlasLink.setAttribute("data-link-toggle", "atlas");
  atlasLink.addEventListener("click", toggle);
  document.body.append(atlasLink);
  Object.defineProperty(document, "elementsFromPoint", { value: () => [atlasLink], configurable: true });
  await act(async () => {
    canvasStore.setState({ api: { getSceneElements: () => [atlas] } as never, view: EMPTY_VIEW, frames: [], links: { atlas: { nodeIds: [], groupIds: [] } } });
    uiStore.setState({ linking: "isis" });
  });
  const layer = host.ownerDocument.querySelector<HTMLElement>(".cursor-crosshair")!;
  await act(async () => layer.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: atlas.x + 10, clientY: atlas.y + 10 })));
  expect(toggle).not.toHaveBeenCalled();
  expect(linkOrchestrator).toHaveBeenCalledWith("atlas", "isis");
  await act(async () => canvasStore.setState({ api: null, links: {} }));
});

it("ends on Escape even from a Link button whose foot keeps every key from bubbling", async () => {
  const foot = document.createElement("footer");
  foot.addEventListener("keydown", (e) => e.stopPropagation());
  const button = document.createElement("button");
  foot.append(button);
  document.body.append(foot);
  button.focus();
  await act(async () => void button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(uiStore.getState().linking).toBeNull();
});
