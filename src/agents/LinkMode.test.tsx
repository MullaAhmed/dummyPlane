// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { createNodeElement } from "@/canvas/nodeElement";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { linkAgents } from "./agentLinks";
import { linkAgentToBoard } from "./boardLinks";
import { LinkMode } from "./LinkMode";
import { withBoardLink } from "./wires";
import { linkFleet } from "@/fleet/fleets";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/fleet/fleets", () => ({ linkFleet: vi.fn() }));
vi.mock("./agentLinks", async (importOriginal) => ({ ...(await importOriginal<typeof import("./agentLinks")>()), linkAgents: vi.fn() }));
vi.mock("./boardLinks", async (importOriginal) => ({ ...(await importOriginal<typeof import("./boardLinks")>()), linkAgentToBoard: vi.fn() }));

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

it("passes a click on Finish through the layer that covers it", async () => {
  Object.defineProperty(document, "elementsFromPoint", { value: () => [document.getElementById("finish")], configurable: true });
  const layer = host.ownerDocument.querySelector<HTMLElement>(".cursor-crosshair")!;
  await act(async () => layer.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 5 })));
  expect(toggle).toHaveBeenCalledTimes(1);
  // The mode is left to the button, not ended twice by the layer's own click-in-the-void rule.
  expect(uiStore.getState().linking).toBe("chef");
});

it("runs the other way from an agent's foot: a click on a fleet wires the agent to it, then the mode ends", async () => {
  mockIPC(() => undefined);
  Object.defineProperty(document, "elementsFromPoint", { value: () => [], configurable: true });
  const atlas = { ...createNodeElement("fleet", { x: 400, y: 400 }), id: "atlas" } as unknown as ExcalidrawElement;
  const batman = { ...createNodeElement("terminal", { x: 1600, y: 400 }), id: "batman" } as unknown as ExcalidrawElement;
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  await act(async () => {
    canvasStore.setState({ api: { getSceneElements: () => [atlas, batman] } as never, view: EMPTY_VIEW, frames: [], links: { atlas: { nodeIds: [], groupIds: [] } } });
    uiStore.setState({ linking: "batman" });
  });
  expect(document.body.textContent).toContain("Click another agent, a fleet or a board to link this agent");
  const layer = host.ownerDocument.querySelector<HTMLElement>(".cursor-crosshair")!;
  // A click on the agent itself designates nothing from its end: it ends the mode without a wire.
  await act(async () => layer.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: batman.x + 10, clientY: batman.y + 10 })));
  expect(linkFleet).not.toHaveBeenCalled();
  expect(uiStore.getState().linking).toBeNull();
  await act(async () => uiStore.setState({ linking: "batman" }));
  const layerAgain = host.ownerDocument.querySelector<HTMLElement>(".cursor-crosshair")!;
  await act(async () => layerAgain.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: atlas.x + 10, clientY: atlas.y + 10 })));
  expect(linkFleet).toHaveBeenCalledWith("atlas", "batman");
  expect(linkAgents).not.toHaveBeenCalled();
  expect(uiStore.getState().linking).toBeNull();
  await act(async () => canvasStore.setState({ api: null, links: {} }));
});

it("links two agents from an agent's foot with no fleet on the canvas, and never to a plain shell", async () => {
  mockIPC(() => undefined);
  vi.mocked(linkFleet).mockClear();
  vi.mocked(linkAgents).mockClear();
  Object.defineProperty(document, "elementsFromPoint", { value: () => [], configurable: true });
  const batman = { ...createNodeElement("terminal", { x: 400, y: 400 }), id: "batman" } as unknown as ExcalidrawElement;
  const cyborg = { ...createNodeElement("terminal", { x: 1600, y: 400 }), id: "cyborg" } as unknown as ExcalidrawElement;
  const sh = { ...createNodeElement("terminal", { x: 400, y: 1600 }), id: "sh" } as unknown as ExcalidrawElement;
  const terminal = (id: string, agent: "claude" | "shell") =>
    nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { title: id, name: id, agent, cwd: "C:/code", shell: "default", command: "" } });
  await terminal("batman", "claude");
  await terminal("cyborg", "claude");
  await terminal("sh", "shell");
  await act(async () => {
    canvasStore.setState({ api: { getSceneElements: () => [batman, cyborg, sh] } as never, view: EMPTY_VIEW, frames: [], links: {} });
    uiStore.setState({ linking: "batman" });
  });
  const click = async (at: ExcalidrawElement) => {
    const layer = host.ownerDocument.querySelector<HTMLElement>(".cursor-crosshair")!;
    await act(async () => layer.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: at.x + 10, clientY: at.y + 10 })));
  };
  // A shell would run the linked agent's messages as commands: it designates nothing, the mode ends.
  await click(sh);
  expect(linkAgents).not.toHaveBeenCalled();
  expect(uiStore.getState().linking).toBeNull();
  await act(async () => uiStore.setState({ linking: "batman" }));
  await click(cyborg);
  expect(linkAgents).toHaveBeenCalledWith("batman", "cyborg");
  expect(linkFleet).not.toHaveBeenCalled();
  expect(uiStore.getState().linking).toBeNull();
  await act(async () => canvasStore.setState({ api: null, links: {} }));
});

it("takes another node's Link for a place on that node, not for the linker's Done", async () => {
  mockIPC(() => undefined);
  vi.mocked(linkFleet).mockClear();
  const atlas = { ...createNodeElement("fleet", { x: 400, y: 400 }), id: "atlas" } as unknown as ExcalidrawElement;
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  // The fleet's "+ Link" lies under the pointer, inside the fleet.
  const atlasLink = document.createElement("button");
  atlasLink.setAttribute("data-link-toggle", "atlas");
  atlasLink.addEventListener("click", toggle);
  document.body.append(atlasLink);
  Object.defineProperty(document, "elementsFromPoint", { value: () => [atlasLink], configurable: true });
  await act(async () => {
    canvasStore.setState({ api: { getSceneElements: () => [atlas] } as never, view: EMPTY_VIEW, frames: [], links: { atlas: { nodeIds: [], groupIds: [] } } });
    uiStore.setState({ linking: "batman" });
  });
  const layer = host.ownerDocument.querySelector<HTMLElement>(".cursor-crosshair")!;
  await act(async () => layer.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: atlas.x + 10, clientY: atlas.y + 10 })));
  expect(toggle).not.toHaveBeenCalled();
  expect(linkFleet).toHaveBeenCalledWith("atlas", "batman");
  await act(async () => canvasStore.setState({ api: null, links: {} }));
});

/** A key pressed on `target`: a native keydown that bubbles and can be cancelled, as the webview sends it. */
async function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => void target.dispatchEvent(event));
  return event;
}

const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]');
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const activeName = () => document.getElementById(listbox()!.getAttribute("aria-activedescendant") ?? "")?.textContent ?? null;
const outline = () => document.querySelector(".border-dashed");

async function terminal(id: string, agent: "claude" | "shell") {
  await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { title: id, name: id[0].toUpperCase() + id.slice(1), agent, cwd: "C:/code", shell: "default", command: "" } });
}

const at = (kind: "terminal" | "fleet", id: string, x: number, y: number) => ({ ...createNodeElement(kind, { x, y }), id }) as unknown as ExcalidrawElement;

it("takes no focus and shows no list when nothing on the canvas can be linked", () => {
  expect(listbox()).toBeNull();
  expect(document.body.textContent).toContain("Click a group, an agent or a board to link");
});

it("links two agents from the keyboard: the list takes the focus, the arrows and Tab walk the targets outlined on the canvas, Enter links (P1-9)", async () => {
  mockIPC(() => undefined);
  vi.mocked(linkFleet).mockClear();
  vi.mocked(linkAgents).mockClear();
  await terminal("batman", "claude");
  await terminal("cyborg", "claude");
  await terminal("sh", "shell");
  await nodesStore.getState().create("atlas", { workspaceId: "w1", kind: "fleet", payload: { name: "Atlas" } });
  const scene = [at("terminal", "batman", 2800, 400), at("terminal", "cyborg", 1600, 400), at("terminal", "sh", 400, 1600), at("fleet", "atlas", 400, 400)];
  const link = document.createElement("button");
  link.setAttribute("data-link-toggle", "batman");
  document.body.append(link);
  link.focus();
  await act(async () => {
    uiStore.setState({ linking: null });
    canvasStore.setState({ api: { getSceneElements: () => scene } as never, view: EMPTY_VIEW, frames: [], links: { atlas: { nodeIds: [], groupIds: [] } } });
  });
  await act(async () => uiStore.setState({ linking: "batman" }));

  // The list has the keyboard; the hint names it.
  expect(document.activeElement).toBe(listbox());
  expect(document.getElementById(listbox()!.getAttribute("aria-labelledby")!)?.textContent).toContain("or pick one below");
  // In the canvas's reading order; not the agent itself, not a plain shell.
  expect(options().map((o) => o.textContent)).toEqual(["AtlasFleet", "CyborgAgent"]);
  expect(listbox()!.hasAttribute("aria-activedescendant")).toBe(false);
  expect(outline()).toBeNull();

  const down = await press(listbox()!, "ArrowDown");
  expect(down.defaultPrevented).toBe(true);
  expect(activeName()).toBe("AtlasFleet");
  expect(options()[0].getAttribute("aria-selected")).toBe("true");
  // The target the keyboard is on is outlined on the canvas, as the pointer's is.
  expect(outline()).not.toBeNull();
  await press(listbox()!, "ArrowDown");
  expect(activeName()).toBe("CyborgAgent");
  await press(listbox()!, "ArrowDown");
  expect(activeName()).toBe("AtlasFleet");
  await press(listbox()!, "ArrowUp");
  expect(activeName()).toBe("CyborgAgent");
  const tab = await press(listbox()!, "Tab");
  expect(tab.defaultPrevented).toBe(true);
  expect(activeName()).toBe("AtlasFleet");
  await press(listbox()!, "Tab", { shiftKey: true });
  expect(activeName()).toBe("CyborgAgent");

  await press(listbox()!, "Enter");
  expect(linkAgents).toHaveBeenCalledWith("batman", "cyborg");
  expect(linkFleet).not.toHaveBeenCalled();
  expect(uiStore.getState().linking).toBeNull();
  // The keyboard is back on the agent's Link, not lost on the page.
  expect(document.activeElement).toBe(link);
  await act(async () => canvasStore.setState({ api: null, links: {} }));
});

it("wires a fleet to each target picked and stays on, a grouped agent standing for its group, a wired one marked (P1-9)", async () => {
  mockIPC(() => undefined);
  vi.mocked(linkFleet).mockClear();
  await terminal("member", "claude");
  await terminal("solo", "claude");
  const group = { id: "g1", name: "Backend", group: { role: "builder", pantheon: "dc" } as never, memberIds: ["member"], x: 0, y: 0, width: 900, height: 900 };
  const scene = [at("terminal", "member", 100, 100), at("terminal", "solo", 1600, 3000)];
  document.getElementById("finish")!.focus();
  await act(async () => {
    uiStore.setState({ linking: null });
    canvasStore.setState({ api: { getSceneElements: () => scene } as never, view: EMPTY_VIEW, frames: [group], links: { chef: { nodeIds: ["solo"], groupIds: [] } } });
  });
  await act(async () => uiStore.setState({ linking: "chef" }));
  expect(options().map((o) => o.textContent)).toEqual(["BackendGroup", "SoloLinked"]);
  expect(options()[1].getAttribute("aria-disabled")).toBe("true");

  await press(listbox()!, "ArrowDown");
  await press(listbox()!, "Enter");
  expect(linkFleet).toHaveBeenCalledWith("chef", "g1");
  // From a fleet the mode goes on, the keyboard still in the list, for the next wire.
  expect(uiStore.getState().linking).toBe("chef");
  expect(document.activeElement).toBe(listbox());
  // Already wired: Enter adds nothing.
  await press(listbox()!, "End");
  await press(listbox()!, "Enter");
  expect(linkFleet).toHaveBeenCalledTimes(1);

  // Escape ends it, and gives the keyboard back to the fleet's Link.
  await press(listbox()!, "Escape");
  expect(uiStore.getState().linking).toBeNull();
  expect(document.activeElement).toBe(document.getElementById("finish"));
  await act(async () => canvasStore.setState({ api: null, frames: [], links: {} }));
});

it("links a target clicked in the list, a click the canvas layer under it never sees (P1-9)", async () => {
  mockIPC(() => undefined);
  vi.mocked(linkFleet).mockClear();
  vi.mocked(linkAgents).mockClear();
  await terminal("batman", "claude");
  await terminal("cyborg", "claude");
  const scene = [at("terminal", "batman", 400, 400), at("terminal", "cyborg", 1600, 400)];
  await act(async () => {
    uiStore.setState({ linking: null });
    canvasStore.setState({ api: { getSceneElements: () => scene } as never, view: EMPTY_VIEW, frames: [], links: {} });
  });
  await act(async () => uiStore.setState({ linking: "batman" }));
  await act(async () => options()[0].click());
  expect(linkAgents).toHaveBeenCalledTimes(1);
  expect(linkAgents).toHaveBeenCalledWith("batman", "cyborg");
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

describe("Kanban boards in the link mode", () => {
  const board = (id: string, x: number, y: number) => ({ ...createNodeElement("kanban", { x, y }), id }) as unknown as ExcalidrawElement;
  const click = async (target: ExcalidrawElement) => {
    const layer = host.ownerDocument.querySelector<HTMLElement>(".cursor-crosshair")!;
    await act(async () => layer.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: target.x + 10, clientY: target.y + 10 })));
  };
  const show = async (scene: ExcalidrawElement[], linking: string) => {
    await act(async () => {
      uiStore.setState({ linking: null });
      canvasStore.setState({ api: { getSceneElements: () => scene } as never, view: EMPTY_VIEW, frames: [], links: {} });
    });
    await act(async () => uiStore.setState({ linking }));
  };
  const hint = () => document.querySelector("[data-link-targets] p")!.textContent;

  beforeEach(async () => {
    mockIPC(() => undefined);
    Object.defineProperty(document, "elementsFromPoint", { value: () => [], configurable: true });
    vi.mocked(linkFleet).mockClear();
    vi.mocked(linkAgents).mockClear();
    vi.mocked(linkAgentToBoard).mockClear();
    await terminal("batman", "claude");
    await terminal("cyborg", "claude");
    await terminal("sh", "shell");
    await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: { title: "Boss", name: "Boss", agent: "claude", cwd: "C:/code", shell: "default", command: "", role: "manager", fleet: "atlas" } });
    await nodesStore.getState().create("atlas", { workspaceId: "w1", kind: "fleet", payload: { name: "Atlas" } });
    await nodesStore.getState().create("tasks", { workspaceId: "w1", kind: "kanban", payload: { columns: [{ id: "todo", title: "To do", cardIds: ["c1", "c2"] }], cards: { c1: { id: "c1", title: "A", notes: "", priority: "none" }, c2: { id: "c2", title: "B", notes: "", priority: "none" } } } });
    await nodesStore.getState().create("synced", { workspaceId: "w1", kind: "kanban", payload: { columns: [], cards: {}, github: { repo: "o/r" } as never } });
  });
  afterEach(async () => {
    await act(async () => canvasStore.setState({ api: null, links: {} }));
  });

  it("wires an agent to the board it clicks from its own end, and ends the mode", async () => {
    const batman = at("terminal", "batman", 400, 400);
    const tasks = board("tasks", 2400, 400);
    await show([batman, tasks], "batman");
    expect(hint()).toContain("a board to link this agent");
    expect(options().map((o) => o.textContent)).toEqual(["Kanban board · 2 cardsBoard"]);
    await click(tasks);
    expect(linkAgentToBoard).toHaveBeenCalledWith("batman", "tasks");
    expect(linkAgents).not.toHaveBeenCalled();
    expect(linkFleet).not.toHaveBeenCalled();
    expect(uiStore.getState().linking).toBeNull();
  });

  it("wires an agent to a board picked in the list, a board it is already wired to marked", async () => {
    const batman = at("terminal", "batman", 400, 400);
    await show([batman, board("tasks", 2400, 400), board("synced", 2400, 2000)], "batman");
    expect(options().map((o) => o.textContent)).toEqual(["Kanban board · 2 cardsBoard", "Kanban board · o/rBoard"]);
    await press(listbox()!, "ArrowDown");
    await press(listbox()!, "Enter");
    expect(linkAgentToBoard).toHaveBeenCalledWith("batman", "tasks");
    expect(uiStore.getState().linking).toBeNull();
  });

  it("gives a plain shell, or a mission's Manager, no board to click: nothing a wire would give them", async () => {
    const tasks = board("tasks", 2400, 400);
    for (const id of ["sh", "boss"]) {
      await show([at("terminal", id, 400, 400), tasks], id);
      expect(options().filter((o) => o.textContent?.endsWith("Board"))).toEqual([]);
      await click(tasks);
      expect(linkAgentToBoard).not.toHaveBeenCalled();
      expect(uiStore.getState().linking).toBeNull();
    }
  });

  it("wires a fleet to each board clicked and stays on, as it does for a group", async () => {
    const atlas = at("fleet", "atlas", 400, 400);
    const tasks = board("tasks", 2400, 400);
    await show([atlas, tasks], "atlas");
    expect(hint()).toContain("an agent or a board to link");
    expect(options().map((o) => o.textContent)).toEqual(["Kanban board · 2 cardsBoard"]);
    await click(tasks);
    expect(linkAgentToBoard).toHaveBeenCalledWith("atlas", "tasks");
    expect(linkFleet).not.toHaveBeenCalled();
    expect(uiStore.getState().linking).toBe("atlas");
  });

  it("starts from a board: it lists the agents that take instructions and the fleets, and a click wires one to it", async () => {
    const tasks = board("tasks", 400, 400);
    const batman = at("terminal", "batman", 2400, 400);
    await show([tasks, batman, at("terminal", "sh", 2400, 1600), at("terminal", "boss", 2400, 2800), at("fleet", "atlas", 400, 2800), board("synced", 4400, 400)], "tasks");
    expect(hint()).toContain("link it to this board");
    // Not the other board, a plain shell or the Manager.
    expect(options().map((o) => o.textContent)).toEqual(["BatmanAgent", "AtlasFleet"]);
    await click(batman);
    expect(linkAgentToBoard).toHaveBeenCalledWith("batman", "tasks");
    expect(linkAgents).not.toHaveBeenCalled();
    expect(linkFleet).not.toHaveBeenCalled();
    expect(uiStore.getState().linking).toBeNull();
  });

  it("wires a fleet clicked from a board, and takes a click on a shell, a Manager or the void for none", async () => {
    const tasks = board("tasks", 400, 400);
    const atlas = at("fleet", "atlas", 2400, 400);
    const scene = [tasks, atlas, at("terminal", "sh", 2400, 1600), at("terminal", "boss", 2400, 2800)];
    await show(scene, "tasks");
    await click(scene[2]);
    expect(linkAgentToBoard).not.toHaveBeenCalled();
    expect(uiStore.getState().linking).toBeNull();
    await show(scene, "tasks");
    await click(scene[3]);
    expect(linkAgentToBoard).not.toHaveBeenCalled();
    await show(scene, "tasks");
    await click(atlas);
    expect(linkAgentToBoard).toHaveBeenCalledWith("atlas", "tasks");
    expect(uiStore.getState().linking).toBeNull();
  });

  it("marks an agent already wired to the board, and wires nothing for it from the list", async () => {
    const tasks = board("tasks", 400, 400);
    const batman = at("terminal", "batman", 2400, 400);
    // The wire the user drew, as the scene holds it: bound to both ends.
    const wire = withBoardLink([tasks, batman], "batman", "tasks").find((e) => e.type === "arrow")!;
    await show([tasks, batman, wire], "tasks");
    expect(options().map((o) => o.textContent)).toEqual(["BatmanLinked"]);
    expect(options()[0].getAttribute("aria-disabled")).toBe("true");
    await press(listbox()!, "ArrowDown");
    await press(listbox()!, "Enter");
    expect(linkAgentToBoard).not.toHaveBeenCalled();
    expect(uiStore.getState().linking).toBe("tasks");
  });
});
