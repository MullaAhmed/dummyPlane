// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { accountsStore } from "@/accounts/store";
import type { ClaudeExtensions, ExtensionItem } from "@/ipc/claudeExtensions";
import { agentsStore } from "@/agents/agentsStore";
import type { FleetPayload, TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { canvasStore, EMPTY_VIEW } from "./canvasStore";
import { SelectionPanel } from "./SelectionPanel";

const { mutateElement } = vi.hoisted(() => ({ mutateElement: vi.fn() }));
vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "immediately" }, mutateElement }));
const { duplicateTerminal, requestClose } = vi.hoisted(() => ({ duplicateTerminal: vi.fn(async () => undefined), requestClose: vi.fn() }));
vi.mock("@/agents/terminals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/agents/terminals")>()),
  duplicateTerminal,
  requestClose,
}));
// A fleet closes through its own request; its rename is the real one.
const { requestCloseFleet } = vi.hoisted(() => ({ requestCloseFleet: vi.fn() }));
vi.mock("@/fleet/fleets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fleet/fleets")>()),
  requestCloseFleet,
}));
// The native folder picker.
const { open } = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));
const { resumeTerminal } = vi.hoisted(() => ({ resumeTerminal: vi.fn() }));
vi.mock("@/nodes/terminal/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/nodes/terminal/registry")>()),
  resumeTerminal,
}));
// Watched, not replaced: a running terminal still keeps the choice it started with.
const { noteChoiceChange } = vi.hoisted(() => ({ noteChoiceChange: vi.fn() }));
vi.mock("./startedChoice", async (importOriginal) => {
  const real = await importOriginal<typeof import("./startedChoice")>();
  noteChoiceChange.mockImplementation(real.noteChoiceChange);
  return { ...real, noteChoiceChange };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const box = (id: string, type = "rectangle") =>
  ({
    id,
    type,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: "#29261B",
    backgroundColor: "transparent",
    groupIds: [],
    frameId: null,
    boundElements: null,
    version: 1,
    versionNonce: 1,
    updated: 1,
    index: "a0",
    isDeleted: false,
  }) as unknown as ExcalidrawElement;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  // A change to a node is saved a moment later; the save has nowhere to go in a test.
  mockIPC(() => undefined);
  mutateElement.mockClear();
  duplicateTerminal.mockClear();
  requestClose.mockClear();
  requestCloseFleet.mockClear();
  open.mockReset();
  resumeTerminal.mockClear();
  noteChoiceChange.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  canvasStore.setState({ api: null, drawnSelection: [], view: EMPTY_VIEW, nodeRects: {} });
  nodesStore.setState({ nodes: {} });
  accountsStore.setState({ profiles: [], active: null, loaded: false, unread: false, open: false });
  terminalStatusStore.setState({ statuses: {} });
});

function mount(api: Partial<ExcalidrawImperativeAPI>, elements: ExcalidrawElement[], mode: "reading" | null = null) {
  canvasStore.setState({ api: api as ExcalidrawImperativeAPI, drawnSelection: elements, view: { ...EMPTY_VIEW, mode } });
  return act(async () => root.render(<SelectionPanel />));
}

const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

it("stays hidden when nothing drawn is selected", async () => {
  await mount({}, []);
  expect(host.innerHTML).toBe("");
});

it("stays hidden in reading mode, where nothing can change", async () => {
  await mount({}, [box("a")], "reading");
  expect(host.innerHTML).toBe("");
});

it("shows only the stroke and background colours and the Duplicate and Delete actions", async () => {
  await mount({}, [box("a")]);
  expect(host.querySelectorAll(".dp-label")).toHaveLength(2);
  expect(host.querySelector("button[aria-label='Stroke: Ink']")).not.toBeNull();
  expect(host.querySelector("button[aria-label='Background: Transparent']")).not.toBeNull();
  expect(host.querySelectorAll("button[aria-label^='Stroke: ']")).toHaveLength(8);
  expect(host.querySelectorAll("button[aria-label^='Background: ']")).toHaveLength(9);
  expect(host.textContent).toContain("Duplicate");
  expect(host.textContent).toContain("Delete");
});

it("restyles the selected drawn elements' stroke colour in one undoable update", async () => {
  const updateScene = vi.fn();
  const scene = [box("a"), box("b")];
  await mount({ updateScene, getSceneElementsIncludingDeleted: () => scene, getAppState: () => ({ selectedElementIds: { a: true } }) } as unknown as Partial<ExcalidrawImperativeAPI>, [scene[0]]);
  await act(async () => button("Stroke: Red")!.click());
  expect(updateScene).toHaveBeenCalledTimes(1);
  const [{ elements, captureUpdate }] = updateScene.mock.calls[0];
  expect(captureUpdate).toBe("immediately");
  expect(elements[0].strokeColor).toBe("#C93C37");
  expect(elements[1]).toBe(scene[1]);
});

it("sets the background colour, transparent included", async () => {
  const updateScene = vi.fn();
  const scene = [box("a")];
  await mount({ updateScene, getSceneElementsIncludingDeleted: () => scene, getAppState: () => ({ selectedElementIds: { a: true } }) } as unknown as Partial<ExcalidrawImperativeAPI>, scene);
  await act(async () => button("Background: Transparent")!.click());
  expect(updateScene.mock.calls[0][0].elements[0].backgroundColor).toBe("transparent");
});

it("duplicates the selection and selects the copy", async () => {
  const updateScene = vi.fn();
  const scene = [box("a")];
  await mount({ updateScene, getSceneElementsIncludingDeleted: () => scene, getAppState: () => ({ selectedElementIds: { a: true } }) } as unknown as Partial<ExcalidrawImperativeAPI>, scene);
  await act(async () => button("Duplicate")!.click());
  const [{ elements, appState }] = updateScene.mock.calls[0];
  expect(elements).toHaveLength(2);
  expect(Object.keys(appState.selectedElementIds)).toEqual([elements[1].id]);
});

it("deletes the selected drawn elements and clears the selection", async () => {
  const updateScene = vi.fn();
  const scene = [box("a")];
  await mount({ updateScene, getSceneElementsIncludingDeleted: () => scene, getAppState: () => ({ selectedElementIds: { a: true } }) } as unknown as Partial<ExcalidrawImperativeAPI>, scene);
  await act(async () => button("Delete")!.click());
  const [{ elements, appState }] = updateScene.mock.calls[0];
  expect(elements[0].isDeleted).toBe(true);
  expect(appState).toEqual({ selectedElementIds: {}, selectedGroupIds: {} });
});

it("keeps the keyboard on the canvas when a button is pressed", async () => {
  await mount({}, [box("a")]);
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    button("Stroke: Ink")!.dispatchEvent(down);
  });
  expect(down.defaultPrevented).toBe(true);
});

// The sloppiness and arrow type of a connection stroke.
const stroke = (id: string, type: "arrow" | "line", extra: Record<string, unknown> = {}) =>
  ({
    ...box(id, type),
    roughness: 1,
    roundness: null,
    elbowed: false,
    points: [
      [0, 0],
      [100, 40],
    ],
    startBinding: null,
    endBinding: null,
    ...extra,
  }) as unknown as ExcalidrawElement;

const group = (label: string) => host.querySelector(`[role="radiogroup"][aria-label="${label}"]`);
const choice = (label: string, text: string) =>
  [...(group(label)?.querySelectorAll("button") ?? [])].find((b) => b.textContent === text) as HTMLButtonElement | undefined;
const apiOf = (scene: ExcalidrawElement[], selected: Record<string, true>) => {
  const updateScene = vi.fn();
  const api = { updateScene, getSceneElementsIncludingDeleted: () => scene, getAppState: () => ({ selectedElementIds: selected }) };
  return { updateScene, api: api as unknown as Partial<ExcalidrawImperativeAPI> };
};

it("offers no sloppiness or arrow type for a plain shape", async () => {
  await mount({}, [box("a")]);
  expect(group("Sloppiness")).toBeNull();
  expect(group("Arrow type")).toBeNull();
});

it("offers sloppiness for a line, and the arrow type too for an arrow", async () => {
  await mount({}, [stroke("l", "line")]);
  expect(group("Sloppiness")?.querySelectorAll("button")).toHaveLength(3);
  expect(group("Arrow type")).toBeNull();
  await mount({}, [stroke("r", "arrow")]);
  expect(group("Arrow type")?.querySelectorAll("button")).toHaveLength(3);
  expect(choice("Sloppiness", "Sketchy")?.getAttribute("aria-checked")).toBe("true");
  expect(choice("Arrow type", "Sharp")?.getAttribute("aria-checked")).toBe("true");
});

it("sets the sloppiness of the selected connection strokes only", async () => {
  const scene = [stroke("a", "arrow"), box("b")];
  const { updateScene, api } = apiOf(scene, { a: true, b: true });
  await mount(api, scene);
  await act(async () => choice("Sloppiness", "Clean")!.click());
  const [{ elements, captureUpdate }] = updateScene.mock.calls[0];
  expect(captureUpdate).toBe("immediately");
  expect(elements[0].roughness).toBe(0);
  expect(elements[1]).toBe(scene[1]);
});

it("applies the sloppiness shown, pressed again, to a mixed selection, and keeps it chosen", async () => {
  const scene = [stroke("a", "line"), stroke("b", "line", { roughness: 2 })];
  const { updateScene, api } = apiOf(scene, { a: true, b: true });
  await mount(api, scene);
  await act(async () => choice("Sloppiness", "Sketchy")!.click());
  expect(updateScene.mock.calls[0][0].elements.map((e: { roughness: number }) => e.roughness)).toEqual([1, 1]);
  expect(choice("Sloppiness", "Sketchy")?.getAttribute("aria-checked")).toBe("true");
});

it("makes an arrow elbowed in one undoable update, then has Excalidraw route it", async () => {
  const scene = [
    stroke("a", "arrow", {
      points: [
        [0, 0],
        [50, 10],
        [100, 40],
      ],
    }),
  ];
  const { updateScene, api } = apiOf(scene, { a: true });
  await mount(api, scene);
  await act(async () => choice("Arrow type", "Elbow")!.click());
  const [{ elements }] = updateScene.mock.calls[0];
  expect(elements[0]).toMatchObject({
    elbowed: true,
    roundness: null,
    points: [
      [0, 0],
      [100, 40],
    ],
  });
  expect(mutateElement).toHaveBeenCalledWith(scene[0], {});
});

it("does not route anything for the other arrow types", async () => {
  const scene = [stroke("a", "arrow")];
  const { updateScene, api } = apiOf(scene, { a: true });
  await mount(api, scene);
  await act(async () => choice("Arrow type", "Round")!.click());
  expect(updateScene.mock.calls[0][0].elements[0]).toMatchObject({ elbowed: false, roundness: { type: 2 } });
  expect(mutateElement).not.toHaveBeenCalled();
});

// The Edit section of a terminal selected alone.
const terminal = (overrides: Partial<TerminalPayload> = {}): TerminalPayload => ({
  title: "Isis · api",
  name: "Isis",
  agent: "claude",
  cwd: "D:/work/api",
  shell: "default",
  command: "",
  ...overrides,
});

/** Selects the terminal and, unless told not to, opens its panel from its Edit tab, as most tests need. */
async function mountTerminal(payload: TerminalPayload, selectedIds = ["t1"], mode: "reading" | null = null, open = true) {
  nodesStore.setState({
    nodes: {
      t1: { workspaceId: "w", kind: "terminal", payload },
      t2: { workspaceId: "w", kind: "terminal", payload: terminal({ name: "Thoth" }) },
      o1: { workspaceId: "w", kind: "fleet", payload: { name: "Fleet" } },
    },
  });
  canvasStore.setState({ drawnSelection: [], view: { ...EMPTY_VIEW, mode, selectedIds } });
  await act(async () => root.render(<SelectionPanel />));
  const tab = editTab();
  if (open && tab) await act(async () => tab.click());
}

/** The folded panel: its Edit tab, named after the terminal. */
const editTab = () => host.querySelector<HTMLButtonElement>('button[aria-label^="Edit "][aria-expanded="false"]');

const field = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
const payloadOf = () => (nodesStore.getState().nodes.t1 as { payload: TerminalPayload }).payload;

/** Types into a field and leaves it, as a user does. */
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.focus();
    input.value = value;
    input.blur();
  });
}

it("shows a short Edit section for a terminal selected alone: Rename, Copy and Delete, no colours", async () => {
  await mountTerminal(terminal());
  expect(host.querySelector("section[aria-label='Edit']")).not.toBeNull();
  expect(host.textContent).toContain("Edit Isis");
  expect(field("Name")!.value).toBe("Isis");
  expect(host.querySelector("[data-folder]")?.textContent).toContain("D:/work/api");
  expect(field("Command")).toBeNull();
  expect(host.querySelector("button[aria-label^='Stroke: ']")).toBeNull();
  expect(button("Duplicate")).toBeNull();
  expect(button("Rename")).not.toBeNull();
  expect(button("Copy")).not.toBeNull();
  expect(button("Delete")).not.toBeNull();
});

it("renames, copies and deletes the terminal from its actions", async () => {
  await mountTerminal(terminal());
  await act(async () => button("Rename")!.click());
  expect(document.activeElement).toBe(field("Name"));
  await act(async () => button("Copy")!.click());
  expect(duplicateTerminal).toHaveBeenCalledWith("w", "t1");
  await act(async () => button("Delete")!.click());
  expect(requestClose).toHaveBeenCalledWith("t1");
});

it("sits beside the selected terminal, and follows it when the view moves", async () => {
  await mountTerminal(terminal());
  await act(async () =>
    canvasStore.setState({
      nodeRects: { t1: { x: 100, y: 100, width: 400, height: 300 } },
      view: { ...canvasStore.getState().view, width: 1200, height: 800, scrollX: 0, scrollY: 0, zoom: 1 },
    }),
  );
  const panel = host.firstElementChild as HTMLElement;
  expect([panel.style.left, panel.style.top]).toEqual(["512px", "100px"]);
  expect(panel.className).not.toContain("left-[70px]");
  await act(async () => canvasStore.setState({ view: { ...canvasStore.getState().view, scrollX: 100, scrollY: 20 } }));
  expect([panel.style.left, panel.style.top]).toEqual(["612px", "120px"]);
});

it("stays hidden for several selected nodes, and in reading mode", async () => {
  await mountTerminal(terminal(), ["t1", "t2"]);
  expect(host.innerHTML).toBe("");
  await mountTerminal(terminal(), ["t1", "o1"]);
  expect(host.innerHTML).toBe("");
  await mountTerminal(terminal(), ["t1"], "reading");
  expect(host.innerHTML).toBe("");
  await mountTerminal(terminal(), ["o1"], "reading");
  expect(host.innerHTML).toBe("");
});

it("renames the terminal when the Name field is left, and ignores an empty name", async () => {
  await mountTerminal(terminal());
  await typeInto(field("Name")!, "  Horus ");
  expect(payloadOf().name).toBe("Horus");
  await typeInto(field("Name")!, "   ");
  expect(payloadOf().name).toBe("Horus");
});

it("keeps the stored value when Escape ends the edit", async () => {
  await mountTerminal(terminal());
  const name = field("Name")!;
  await act(async () => {
    name.focus();
    name.value = "Seth";
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(payloadOf().name).toBe("Isis");
  expect(name.value).toBe("Isis");
});

it("shows the folder as a path, whole on hover, its end in view, and copies it", async () => {
  await mountTerminal(terminal({ cwd: "/home/ada/work/api" }));
  // Changed with the picker, never typed into.
  expect(field("Folder")).toBeNull();
  expect(host.querySelector("[data-folder] input")).toBeNull();
  const folder = host.querySelector<HTMLElement>("[data-folder]")!;
  expect(folder.textContent).toBe("/home/ada/work/api");
  expect(folder.title).toBe("/home/ada/work/api");
  // Cut from the start; the path itself stays left to right, its leading "/" included.
  expect(folder.style.direction).toBe("rtl");
  expect(folder.querySelector("bdi")).not.toBeNull();
  // The folder, shell and title wait for the next launch, and the panel says so.
  expect(host.textContent).toContain("Folder, shell and title apply at the next launch");
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  await act(async () => button("Copy the path")!.click());
  expect(writeText).toHaveBeenCalledWith("/home/ada/work/api");
  writeText.mockRestore();
});

it("edits the command of a custom agent only", async () => {
  await mountTerminal(terminal({ agent: "custom", command: "npm run dev" }));
  expect(field("Command")!.value).toBe("npm run dev");
  expect(host.textContent).toContain("Command, folder, shell and title apply at the next launch");
  await typeInto(field("Command")!, "npm test");
  expect(payloadOf().command).toBe("npm test");
});

it("lets a model a mission chose go back to the default, and says Default when none is chosen", async () => {
  await mountTerminal(terminal({ model: "claude-haiku-5-5" }));
  expect(host.textContent).toContain("Model");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Use default")!.click());
  expect(payloadOf().model).toBeUndefined();
  expect(host.textContent).toContain("Default");
  expect([...host.querySelectorAll("button")].find((b) => b.textContent === "Use default")).toBeUndefined();
});

it("starts on a small Edit tab beside the terminal, in the panel's place, and opens the panel there on a click", async () => {
  await mountTerminal(terminal(), ["t1"], null, false);
  await act(async () =>
    canvasStore.setState({
      nodeRects: { t1: { x: 100, y: 100, width: 400, height: 300 } },
      view: { ...canvasStore.getState().view, width: 1200, height: 800, scrollX: 0, scrollY: 0, zoom: 1 },
    }),
  );
  const tab = editTab()!;
  expect(tab.textContent).toBe("Edit");
  expect(tab.getAttribute("aria-label")).toBe("Edit Isis");
  expect([tab.style.left, tab.style.top]).toEqual(["512px", "100px"]);
  // Filled with the ink: it reads beside the selection's own outline.
  expect(tab.className).toContain("bg-dp-accent");
  expect(host.querySelector("section[aria-label='Edit']")).toBeNull();
  expect(field("Name")).toBeNull();
  await act(async () => tab.click());
  expect(editTab()).toBeNull();
  expect(field("Name")!.value).toBe("Isis");
  const panel = host.firstElementChild as HTMLElement;
  expect([panel.style.left, panel.style.top]).toEqual(["512px", "100px"]);
  expect(panel.className).toContain("animate-in");
});

it("puts the tab on the terminal's left when its right has no room", async () => {
  await mountTerminal(terminal(), ["t1"], null, false);
  await act(async () =>
    canvasStore.setState({
      nodeRects: { t1: { x: 700, y: 100, width: 420, height: 300 } },
      view: { ...canvasStore.getState().view, width: 1200, height: 800, scrollX: 0, scrollY: 0, zoom: 1 },
    }),
  );
  expect(editTab()!.style.left).toBe("616px");
});

it("folds back to its tab, and every terminal selected starts on its tab", async () => {
  await mountTerminal(terminal());
  expect(button("Fold the panel")!.getAttribute("aria-expanded")).toBe("true");
  await act(async () => button("Fold the panel")!.click());
  expect(field("Name")).toBeNull();
  expect(editTab()!.getAttribute("aria-label")).toBe("Edit Isis");
  // Opened again, then another terminal selected: its tab only.
  await act(async () => editTab()!.click());
  expect(field("Name")).not.toBeNull();
  await act(async () => canvasStore.setState({ view: { ...canvasStore.getState().view, selectedIds: ["t2"] } }));
  expect(editTab()!.getAttribute("aria-label")).toBe("Edit Thoth");
  expect(field("Name")).toBeNull();
  // The first one again, after none: its tab too.
  await act(async () => editTab()!.click());
  await act(async () => canvasStore.setState({ view: { ...canvasStore.getState().view, selectedIds: [] } }));
  expect(host.innerHTML).toBe("");
  await act(async () => canvasStore.setState({ view: { ...canvasStore.getState().view, selectedIds: ["t1"] } }));
  expect(editTab()!.getAttribute("aria-label")).toBe("Edit Isis");
  expect(field("Name")).toBeNull();
});

it("keeps the keyboard where it was when its tab is pressed", async () => {
  await mountTerminal(terminal(), ["t1"], null, false);
  const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  editTab()!.dispatchEvent(press);
  expect(press.defaultPrevented).toBe(true);
});

// The lists of a Claude terminal: skills, plugins, MCP servers, subagents.
const item = (id: string, extra: Partial<ExtensionItem> = {}): ExtensionItem => ({ id, name: id, source: "user", enabled: true, ...extra });
const EXTENSIONS: ClaudeExtensions = {
  skills: [item("commit", { description: "Write the commit message" }), item("review", { enabled: false })],
  plugins: [item("figma@claude", { name: "figma", enabled: false })],
  mcp: [item("github", { description: "http · api.github.com", source: "project" })],
  agents: [item("planner", { source: "local" })],
};

let listCalls: unknown[] = [];
/** Answers `claude_extensions` (the other commands, a node's save, get nothing). */
function serveExtensions(answer: () => ClaudeExtensions = () => EXTENSIONS) {
  listCalls = [];
  mockIPC((cmd, args) => {
    if (cmd !== "claude_extensions") return undefined;
    listCalls.push(args);
    return answer();
  });
}

const tabs = () => [...host.querySelectorAll<HTMLButtonElement>("[role='tab']")];
const tab = (name: string) => tabs().find((b) => b.textContent === name);
const checkbox = (name: string) => host.querySelector<HTMLButtonElement>(`button[role='checkbox'][aria-label="${name}"]`);
const restartNow = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Restart now");
/** Lets the answer of a command arrive. */
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function openTab(name: string) {
  await act(async () => tab(name)!.click());
  await settle();
}

it("offers a terminal other than Claude its General page only", async () => {
  serveExtensions();
  await mountTerminal(terminal({ agent: "codex" }));
  expect(tabs()).toHaveLength(0);
  expect(field("Name")!.value).toBe("Isis");
  expect(host.querySelector("[data-folder]")).not.toBeNull();
  expect(host.textContent).toContain("Skills, plugins and MCP servers can be chosen for Claude terminals");
  await settle();
  expect(listCalls).toEqual([]);
});

it("reads a Claude terminal's lists once a list tab opens, from its folder and its profile's", async () => {
  serveExtensions();
  accountsStore.setState({ profiles: [{ id: "p1", name: "Work", configDir: "C:/profiles/work" }], loaded: true });
  await mountTerminal(terminal({ accountId: "p1" }));
  expect(tabs().map((b) => b.textContent)).toEqual(["General", "Skills", "Plugins", "MCP", "Subagents"]);
  // The five fit the panel: their strip never scrolls (a scroller drew a scrollbar beside them).
  expect(host.querySelector("[role='tablist']")!.className).not.toMatch(/overflow/);
  await settle();
  expect(listCalls).toEqual([]);
  await openTab("Skills");
  expect(listCalls).toEqual([{ cwd: "D:/work/api", configDir: "C:/profiles/work" }]);
  const commit = host.querySelector("[data-extension='commit']")!;
  expect(commit.textContent).toContain("Write the commit message");
  expect(commit.textContent).toContain("user");
  // One call brings the four lists.
  await openTab("MCP");
  expect(listCalls).toHaveLength(1);
  expect(host.querySelector("[data-extension='github']")?.textContent).toContain("http · api.github.com");
  expect(host.querySelector("[data-extension='github']")?.textContent).toContain("project");
});

it("reads the lists again when the terminal's folder or profile changes", async () => {
  serveExtensions();
  accountsStore.setState({ profiles: [{ id: "p1", name: "Work", configDir: "C:/profiles/work" }], loaded: true });
  await mountTerminal(terminal());
  await openTab("Skills");
  await act(async () => nodesStore.getState().update("t1", { cwd: "D:/work/web" }));
  await settle();
  await act(async () => nodesStore.getState().update("t1", { accountId: "p1" }));
  await settle();
  expect(listCalls).toEqual([
    { cwd: "D:/work/api", configDir: null },
    { cwd: "D:/work/web", configDir: null },
    { cwd: "D:/work/web", configDir: "C:/profiles/work" },
  ]);
});

it("turns a skill off for this terminal alone, and a plugin the user's settings leave off on", async () => {
  serveExtensions();
  await mountTerminal(terminal());
  await openTab("Skills");
  // No profile: the default Claude folder.
  expect(listCalls).toEqual([{ cwd: "D:/work/api", configDir: null }]);
  expect(host.querySelector("input[aria-label='Search skills']")).toBeNull();
  expect(checkbox("commit")!.getAttribute("aria-checked")).toBe("true");
  await act(async () => checkbox("commit")!.click());
  expect(payloadOf().extensions).toEqual({ skillsOff: ["commit"] });
  expect(checkbox("commit")!.getAttribute("aria-checked")).toBe("false");
  await act(async () => checkbox("commit")!.click());
  expect(payloadOf().extensions).toBeUndefined();
  await openTab("Plugins");
  expect(checkbox("figma")!.getAttribute("aria-checked")).toBe("false");
  await act(async () => checkbox("figma")!.click());
  expect(payloadOf().extensions).toEqual({ plugins: { "figma@claude": true } });
  expect(host.textContent).toContain("Changes apply when the terminal restarts");
  // A stopped terminal starts with the choice anyway: nothing to restart.
  expect(restartNow()).toBeUndefined();
});

it("keeps an item the user's own settings turn off, off and disabled, and says why", async () => {
  serveExtensions();
  await mountTerminal(terminal());
  await openTab("Skills");
  const review = checkbox("review")!;
  expect(review.disabled).toBe(true);
  expect(review.getAttribute("aria-checked")).toBe("false");
  expect(document.getElementById(review.getAttribute("aria-describedby")!)?.textContent).toBe("Off in your Claude settings");
  // Said in the row itself, not only on hover.
  expect(host.querySelector("[data-extension='review']")?.textContent).toContain("Off in your Claude settings");
  await act(async () => review.click());
  expect(payloadOf().extensions).toBeUndefined();
});

it("lists a plugin's MCP server, off with its plugin, and says connectors aren't listed", async () => {
  serveExtensions(() => ({
    ...EXTENSIONS,
    mcp: [
      item("plugin_stripe_stripe", { name: "stripe", source: "plugin", description: "stripe · http · mcp.stripe.com" }),
      item("plugin_figma_figma", { name: "figma", source: "plugin", enabled: false }),
    ],
  }));
  await mountTerminal(terminal());
  await openTab("MCP");
  expect(host.textContent).toContain("claude.ai connectors aren't listed here");
  const figma = checkbox("figma")!;
  expect(figma.disabled).toBe(true);
  expect(document.getElementById(figma.getAttribute("aria-describedby")!)?.textContent).toBe("Its plugin is off: turn it on in Plugins first");
  // Turned off, it is stored under its tools' prefix, the name its deny rule takes.
  await act(async () => checkbox("stripe")!.click());
  expect(payloadOf().extensions).toEqual({ mcpOff: ["plugin_stripe_stripe"] });
});

it("searches a long list, and keeps the keys typed there from the canvas", async () => {
  const skills = Array.from({ length: 9 }, (_, i) => item(`skill-${i + 1}`));
  serveExtensions(() => ({ ...EXTENSIONS, skills }));
  await mountTerminal(terminal());
  await openTab("Skills");
  const search = host.querySelector<HTMLInputElement>("input[aria-label='Search skills']")!;
  const seen: string[] = [];
  host.addEventListener("keydown", (e) => seen.push(e.key));
  // Backspace on the canvas would delete the terminal.
  for (const key of ["Backspace", "Delete", "a"]) search.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  expect(seen).toEqual([]);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "skill-3");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect([...host.querySelectorAll("[data-extension]")].map((row) => row.getAttribute("data-extension"))).toEqual(["skill-3"]);
  // Escape clears the search, and stays in the field too.
  await act(async () => search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(seen).toEqual([]);
  expect(host.querySelectorAll("[data-extension]")).toHaveLength(9);
  expect(nodesStore.getState().nodes.t1).toBeDefined();
});

const buttonText = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);
const onCount = () => host.querySelector("[role='tabpanel'][data-state='active'] p[role='status']")?.textContent;
/** The terminal's changes stored from now on, one entry each. */
function watchStores() {
  const stored: unknown[] = [];
  const stop = nodesStore.subscribe((state, previous) => {
    if (state.nodes.t1 !== previous.nodes.t1) stored.push(state.nodes.t1);
  });
  return { stored, stop };
}
/** Types into a list's search, as the field's own input event does. */
async function search(value: string) {
  const field = host.querySelector<HTMLInputElement>("input[aria-label^='Search']")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("turns every skill off, then on, in one change each, leaving one the user's settings turn off as it is", async () => {
  serveExtensions(() => ({ ...EXTENSIONS, skills: [item("commit"), item("deploy"), item("review", { enabled: false })] }));
  await mountTerminal(terminal());
  await openTab("Skills");
  expect(onCount()).toBe("2 of 3 on");
  // Everything a choice can turn on is on: nothing to select.
  expect(buttonText("Select all")!.disabled).toBe(true);
  expect(buttonText("Unselect all")!.disabled).toBe(false);
  // Its icon is drawn, not read: the button's name is its text.
  expect(buttonText("Unselect all")!.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");

  const { stored, stop } = watchStores();
  await act(async () => buttonText("Unselect all")!.click());
  expect(payloadOf().extensions).toEqual({ skillsOff: ["commit", "deploy"] });
  expect(stored).toHaveLength(1);
  expect(noteChoiceChange).toHaveBeenCalledTimes(1);
  expect(noteChoiceChange).toHaveBeenCalledWith("t1", undefined);
  expect(onCount()).toBe("0 of 3 on");
  expect(buttonText("Unselect all")!.disabled).toBe(true);
  expect(checkbox("review")!.getAttribute("aria-checked")).toBe("false");

  await act(async () => buttonText("Select all")!.click());
  // Back to the user's setup: nothing stored, and "review" still off.
  expect(payloadOf().extensions).toBeUndefined();
  expect(stored).toHaveLength(2);
  expect(noteChoiceChange).toHaveBeenCalledTimes(2);
  expect(noteChoiceChange).toHaveBeenLastCalledWith("t1", { skillsOff: ["commit", "deploy"] });
  expect(checkbox("review")!.getAttribute("aria-checked")).toBe("false");
  expect(onCount()).toBe("2 of 3 on");
  stop();
});

it("turns every plugin on or off, one the user's settings leave off included", async () => {
  serveExtensions(() => ({ ...EXTENSIONS, plugins: [item("codex@openai", { name: "codex" }), item("figma@claude", { name: "figma", enabled: false })] }));
  await mountTerminal(terminal());
  await openTab("Plugins");
  expect(onCount()).toBe("1 of 2 on");
  await act(async () => buttonText("Select all")!.click());
  expect(payloadOf().extensions).toEqual({ plugins: { "figma@claude": true } });
  expect(onCount()).toBe("2 of 2 on");
  expect(buttonText("Select all")!.disabled).toBe(true);
  // figma goes back to what the settings give, and drops out of the choice.
  await act(async () => buttonText("Unselect all")!.click());
  expect(payloadOf().extensions).toEqual({ plugins: { "codex@openai": false } });
  expect(checkbox("codex")!.getAttribute("aria-checked")).toBe("false");
  expect(checkbox("figma")!.getAttribute("aria-checked")).toBe("false");
  expect(buttonText("Unselect all")!.disabled).toBe(true);
  expect(noteChoiceChange).toHaveBeenCalledTimes(2);
});

it("switches only the items a search shows, and counts those", async () => {
  const skills = Array.from({ length: 9 }, (_, i) => item(`skill-${i + 1}`));
  serveExtensions(() => ({ ...EXTENSIONS, skills }));
  await mountTerminal(terminal({ extensions: { skillsOff: ["skill-5"] } }));
  await openTab("Skills");
  expect(onCount()).toBe("8 of 9 on");
  await search("skill-3");
  expect(onCount()).toBe("1 shown, 1 on");
  await act(async () => buttonText("Unselect all")!.click());
  expect(payloadOf().extensions).toEqual({ skillsOff: ["skill-5", "skill-3"] });
  expect(onCount()).toBe("1 shown, 0 on");
  expect(buttonText("Unselect all")!.disabled).toBe(true);
  // Nothing shown: nothing to count or switch.
  await search("nothing like it");
  expect(buttonText("Select all")).toBeUndefined();
  await search("");
  expect(onCount()).toBe("7 of 9 on");
  expect(buttonText("Select all")!.disabled).toBe(false);
});

it("disables both when a choice can switch nothing shown, and keeps the keyboard on the canvas", async () => {
  serveExtensions(() => ({ ...EXTENSIONS, skills: [item("commit", { enabled: false }), item("review", { enabled: false })] }));
  await mountTerminal(terminal());
  await openTab("Skills");
  expect(onCount()).toBe("0 of 2 on");
  expect(buttonText("Select all")!.disabled).toBe(true);
  expect(buttonText("Unselect all")!.disabled).toBe(true);
  // A press on the toolbar, a disabled button's included, doesn't take the focus.
  const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  buttonText("Select all")!.dispatchEvent(press);
  expect(press.defaultPrevented).toBe(true);
  await act(async () => buttonText("Select all")!.click());
  expect(payloadOf().extensions).toBeUndefined();
  expect(noteChoiceChange).not.toHaveBeenCalled();
});

it("scrolls a list under the wheel rather than the canvas, unless Ctrl zooms", async () => {
  serveExtensions();
  await mountTerminal(terminal());
  await openTab("Skills");
  const wheels: WheelEvent[] = [];
  host.addEventListener("wheel", (e) => wheels.push(e));
  const row = host.querySelector("[data-extension='commit']")!;
  row.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, bubbles: true }));
  expect(wheels).toHaveLength(0);
  // happy-dom's WheelEvent is no MouseEvent: it drops ctrlKey from its init.
  const zoom = new WheelEvent("wheel", { deltaY: 40, bubbles: true });
  Object.defineProperty(zoom, "ctrlKey", { value: true });
  row.dispatchEvent(zoom);
  expect(wheels).toHaveLength(1);
});

it("says when a list cannot be read, reads it again, and says when it is empty", async () => {
  let fail = true;
  serveExtensions(() => {
    if (fail) throw new Error("no access");
    return { ...EXTENSIONS, agents: [] };
  });
  await mountTerminal(terminal());
  await openTab("Subagents");
  expect(host.querySelector("[role='alert']")?.textContent).toContain("Could not read the list");
  fail = false;
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again")!.click());
  await settle();
  expect(listCalls).toHaveLength(2);
  expect(host.textContent).toContain("No subagents in api or your Claude folder");
  expect(host.textContent).not.toContain("Changes apply");
});

it("offers to restart a running terminal whose choice is no longer the one it started with", async () => {
  serveExtensions();
  terminalStatusStore.getState().set("t1", { state: "running" });
  await mountTerminal(terminal());
  await openTab("Skills");
  expect(restartNow()).toBeUndefined();
  await act(async () => checkbox("commit")!.click());
  expect(restartNow()).toBeDefined();
  expect(host.textContent).toContain("Running with the old choices");
  // Back to what it started with: nothing to restart.
  await act(async () => checkbox("commit")!.click());
  expect(restartNow()).toBeUndefined();
  await act(async () => checkbox("commit")!.click());
  await act(async () => restartNow()!.click());
  expect(resumeTerminal).toHaveBeenCalledWith("t1");
  expect(restartNow()).toBeUndefined();
});

// The fleet: a node of its own, its Claude session nested in its payload.
const fleetSession = (overrides: Partial<TerminalPayload> = {}): TerminalPayload =>
  terminal({ name: "Fleet", title: "Fleet", role: "orchestrator", cwd: "D:/work/api", ...overrides });
const fleetOf = () => (nodesStore.getState().nodes.f1 as { payload: FleetPayload }).payload;

/** Selects the fleet alone and, unless told not to, opens its panel from its Edit tab. */
async function mountFleet(payload: FleetPayload = { name: "Fleet", session: fleetSession() }, opened = true) {
  nodesStore.setState({
    nodes: {
      f1: { workspaceId: "w", kind: "fleet", payload },
      t1: { workspaceId: "w", kind: "terminal", payload: terminal() },
    },
  });
  canvasStore.setState({ drawnSelection: [], view: { ...EMPTY_VIEW, mode: null, selectedIds: ["f1"] } });
  await act(async () => root.render(<SelectionPanel />));
  if (opened) await act(async () => editTab()!.click());
}

it("gives a selected Fleet the Edit tab, named after it, and opens its panel from there", async () => {
  await mountFleet(undefined, false);
  expect(editTab()!.getAttribute("aria-label")).toBe("Edit Fleet");
  expect(field("Name")).toBeNull();
  await act(async () => editTab()!.click());
  expect(host.textContent).toContain("Edit Fleet");
  expect(field("Name")!.value).toBe("Fleet");
  // Its session's folder and model, shown; no copy of a fleet, no title of its own (it is its name).
  expect(host.querySelector("[data-folder]")?.textContent).toBe("D:/work/api");
  expect(host.textContent).toContain("Model");
  expect(host.textContent).toContain("Default");
  expect(button("Rename")).not.toBeNull();
  expect(button("Delete")).not.toBeNull();
  expect(button("Copy")).toBeNull();
  expect(field("Title")).toBeNull();
  expect(host.textContent).toContain("The shell applies at the next launch");
  // Said in the fleet's words, never the code's.
  expect(host.textContent?.toLowerCase()).not.toContain("orchestrator");
  expect(tabs().map((b) => b.textContent)).toEqual(["General", "Skills", "Plugins", "MCP", "Subagents"]);
});

it("renames a fleet on its node and deletes it with its own request", async () => {
  await mountFleet();
  await act(async () => button("Rename")!.click());
  expect(document.activeElement).toBe(field("Name"));
  await typeInto(field("Name")!, "  Atlas ");
  expect(fleetOf().name).toBe("Atlas");
  // Its session keeps the name it had: only the node was renamed.
  expect(fleetOf().session?.name).toBe("Fleet");
  await typeInto(field("Name")!, "   ");
  expect(fleetOf().name).toBe("Atlas");
  await act(async () => button("Delete")!.click());
  expect(requestCloseFleet).toHaveBeenCalledWith("f1");
  expect(requestClose).not.toHaveBeenCalled();
});

it("keeps a fleet in its project: its folder has no Change button, and says why", async () => {
  await mountFleet();
  expect(button("Change the folder")).toBeNull();
  expect(host.textContent).toContain("A fleet stays in the project: its missions branch from it");
  expect(button("Copy the path")).not.toBeNull();
  await act(async () => canvasStore.setState({ view: { ...canvasStore.getState().view, selectedIds: ["t1"] } }));
  await act(async () => editTab()!.click());
  expect(button("Change the folder")).not.toBeNull();
});

it("sends a fleet's model back to the default on its session, not on the node", async () => {
  await mountFleet({ name: "Fleet", session: fleetSession({ model: "claude-haiku-5-5" }) });
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Use default")!.click());
  expect(fleetOf().session?.model).toBeUndefined();
  expect("model" in fleetOf()).toBe(false);
  expect(fleetOf().name).toBe("Fleet");
});

it("keeps a fleet's extension choices in its session, each toggle on top of the last", async () => {
  serveExtensions(() => ({ ...EXTENSIONS, skills: [item("commit"), item("deploy"), item("review")] }));
  await mountFleet();
  await openTab("Skills");
  // Read from the fleet's session: its folder, and its profile's.
  expect(listCalls).toEqual([{ cwd: "D:/work/api", configDir: null }]);
  await act(async () => checkbox("commit")!.click());
  await act(async () => checkbox("deploy")!.click());
  expect(fleetOf().session?.extensions).toEqual({ skillsOff: ["commit", "deploy"] });
  // Nothing lands on the node itself, and the rest of the node is as it was.
  expect("extensions" in fleetOf()).toBe(false);
  expect(fleetOf().name).toBe("Fleet");
  expect(fleetOf().session).toMatchObject({ cwd: "D:/work/api", role: "orchestrator", agent: "claude" });
  expect(noteChoiceChange).toHaveBeenNthCalledWith(1, "f1", undefined);
  expect(checkbox("commit")!.getAttribute("aria-checked")).toBe("false");
  // A choice already stored in the session is the one a toggle starts from.
  await act(async () => checkbox("commit")!.click());
  expect(fleetOf().session?.extensions).toEqual({ skillsOff: ["deploy"] });
  await act(async () => checkbox("deploy")!.click());
  expect(fleetOf().session?.extensions).toBeUndefined();
});

it("never lists the mission's own MCP server, so it cannot be switched off from the MCP tab", async () => {
  serveExtensions(() => ({ ...EXTENSIONS, mcp: [item("dummyplane", { description: "http · 127.0.0.1" }), item("DummyPlane"), item("github")] }));
  await mountFleet();
  await openTab("MCP");
  expect([...host.querySelectorAll("[data-extension]")].map((row) => row.getAttribute("data-extension"))).toEqual(["github"]);
  expect(checkbox("dummyplane")).toBeNull();
  expect(host.textContent).toContain("The fleet's mission server is always on");
  // "Unselect all" turns off what is listed: the mission's server is not.
  await act(async () => buttonText("Unselect all")!.click());
  expect(fleetOf().session?.extensions).toEqual({ mcpOff: ["github"] });
  expect(onCount()).toBe("0 of 1 on");
});

it("shows a terminal's MCP tab without the mission server, and without the fleet's note", async () => {
  serveExtensions(() => ({ ...EXTENSIONS, mcp: [item("dummyplane"), item("github")] }));
  await mountTerminal(terminal());
  await openTab("MCP");
  expect([...host.querySelectorAll("[data-extension]")].map((row) => row.getAttribute("data-extension"))).toEqual(["github"]);
  expect(host.textContent).not.toContain("mission server");
});

it("renames and deletes a fleet that has no session yet, with nothing else to edit", async () => {
  serveExtensions();
  await mountFleet({ name: "Fleet" });
  expect(tabs()).toHaveLength(0);
  expect(host.querySelector("[data-folder]")).toBeNull();
  expect(host.textContent).not.toContain("Skills, plugins and MCP servers can be chosen");
  await typeInto(field("Name")!, "Atlas");
  expect(fleetOf().name).toBe("Atlas");
  await act(async () => button("Delete")!.click());
  expect(requestCloseFleet).toHaveBeenCalledWith("f1");
  await settle();
  expect(listCalls).toEqual([]);
});

it("offers a running Fleet to restart on the choice it was changed to, in its own words", async () => {
  serveExtensions();
  terminalStatusStore.getState().set("f1", { state: "running" });
  await mountFleet();
  await openTab("Skills");
  expect(host.textContent).toContain("Changes apply when the fleet restarts");
  await act(async () => checkbox("commit")!.click());
  await act(async () => restartNow()!.click());
  expect(resumeTerminal).toHaveBeenCalledWith("f1");
});

const changeButton = () => button("Change the folder");
/** Presses "Change…" and lets the picker answer. */
async function pickFolder(answer: string | null) {
  open.mockResolvedValue(answer);
  await act(async () => changeButton()!.click());
}

it("changes a terminal's folder with the native picker, from where it is now", async () => {
  await mountTerminal(terminal({ model: "claude-haiku-5-5", permission: "edits", claudeSessionId: "old-conversation" }));
  expect(changeButton()!.textContent).toBe("Change…");
  await pickFolder("D:\\work\\web");
  expect(open).toHaveBeenCalledWith({ directory: true, defaultPath: "D:/work/api", title: "Working folder" });
  expect(payloadOf().cwd).toBe("D:\\work\\web");
  expect(host.querySelector("[data-folder]")?.textContent).toBe("D:\\work\\web");
  // The model and what it may do are still its own: only the folder, and the conversation that went with it, changed.
  expect(payloadOf()).toMatchObject({ model: "claude-haiku-5-5", permission: "edits", name: "Isis", title: "Isis · api" });
});

it("starts a new conversation for a Claude terminal in a new folder, and says so", async () => {
  await mountTerminal(terminal({ claudeSessionId: "old-conversation", steps: [{ title: "Plan", state: "fait" }] }));
  // Said before the choice, under the path.
  expect(host.textContent).toContain("New folder, new conversation: Claude keeps each conversation with its folder");
  await pickFolder("D:/work/web");
  const { claudeSessionId, steps } = payloadOf();
  expect(claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(claudeSessionId).not.toBe("old-conversation");
  expect(steps).toBeUndefined();
});

it("moves another agent without a conversation, and has nothing to say about one", async () => {
  await mountTerminal(terminal({ agent: "codex" }));
  expect(host.textContent).not.toContain("New folder, new conversation");
  await pickFolder("D:/work/web");
  expect(payloadOf().cwd).toBe("D:/work/web");
  expect("claudeSessionId" in payloadOf()).toBe(false);
});

it("keeps the conversation when the folder picked is the one it is in, whatever the slashes or the case", async () => {
  await mountTerminal(terminal({ claudeSessionId: "old-conversation" }));
  await pickFolder("d:\\WORK\\api\\");
  expect(payloadOf().cwd).toBe("D:/work/api");
  expect(payloadOf().claudeSessionId).toBe("old-conversation");
  // A cancelled picker answers nothing.
  await pickFolder(null);
  expect(payloadOf().cwd).toBe("D:/work/api");
  expect(payloadOf().claudeSessionId).toBe("old-conversation");
});

it("offers to restart a running terminal that was moved, and not a stopped one", async () => {
  await mountTerminal(terminal({ claudeSessionId: "old-conversation" }));
  await pickFolder("D:/work/web");
  expect(restartNow()).toBeUndefined();
  terminalStatusStore.getState().set("t1", { state: "running" });
  await pickFolder("D:/work/docs");
  expect(host.textContent).toContain("Running with the old launch settings");
  await act(async () => restartNow()!.click());
  expect(resumeTerminal).toHaveBeenCalledWith("t1");
  expect(restartNow()).toBeUndefined();
});

const mission = (state: "en_cours" | "terminee") => ({
  state,
  maxAgents: 3,
  members: [{ nodeId: "t1", name: "Isis", task: "", budgetMin: 10, linked: false, branch: "m/isis", worktree: "D:/wt/isis" }],
});
async function inMission(state: "en_cours" | "terminee") {
  await act(async () => nodesStore.setState({ nodes: { ...nodesStore.getState().nodes, o1: { workspaceId: "w", kind: "fleet", payload: { name: "Fleet", mission: mission(state) } } } }));
}

it("keeps the folder of an agent whose mission is running in its worktree, and frees it when the mission ends", async () => {
  await mountTerminal(terminal({ cwd: "D:/wt/isis" }));
  await inMission("en_cours");
  expect(changeButton()).toBeNull();
  expect(host.textContent).toContain("Fixed while its mission runs: this agent works in its own worktree");
  expect(host.textContent).not.toContain("New folder, new conversation");
  await inMission("terminee");
  expect(changeButton()).not.toBeNull();
});

it("sets the title of a terminal, a blank one keeping the stored title", async () => {
  await mountTerminal(terminal());
  expect(field("Title")!.value).toBe("Isis · api");
  await typeInto(field("Title")!, "  Review of api ");
  expect(payloadOf().title).toBe("Review of api");
  await typeInto(field("Title")!, "   ");
  expect(payloadOf().title).toBe("Review of api");
  expect(field("Title")!.value).toBe("Review of api");
});

it("shows the shell a terminal will start with, among the ones the machine has", async () => {
  agentsStore.setState({ shells: ["default", "powershell", "gitbash"] });
  await mountTerminal(terminal({ shell: "gitbash" }));
  const shell = host.querySelector<HTMLElement>("button[role='combobox'][aria-label='Shell']")!;
  expect(shell.textContent).toBe("Git Bash");
  agentsStore.setState({ shells: [] });
});

/** Opens the Shell dropdown with the keyboard and picks a shell by its label, as a user does. */
async function pickShell(label: string) {
  const trigger = host.querySelector<HTMLElement>("button[role='combobox'][aria-label='Shell']")!;
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  const option = [...document.body.querySelectorAll<HTMLElement>("[role='option']")].find((o) => o.textContent === label)!;
  await act(async () => {
    option.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse", button: 0 }));
    option.click();
  });
}

it("picks the shell of the next launch, on a terminal and on a fleet's session", async () => {
  // Radix scrolls the chosen option into view; happy-dom has no layout to do it with.
  const scrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = () => undefined;
  agentsStore.setState({ shells: ["default", "powershell", "gitbash"] });
  try {
    await mountTerminal(terminal({ shell: "default" }));
    await pickShell("PowerShell");
    expect(payloadOf().shell).toBe("powershell");
    await mountFleet();
    await pickShell("Git Bash");
    expect(fleetOf().session?.shell).toBe("gitbash");
    expect("shell" in fleetOf()).toBe(false);
  } finally {
    Element.prototype.scrollIntoView = scrollIntoView;
    agentsStore.setState({ shells: [] });
  }
});

it("offers a restart when the title of a running terminal changes", async () => {
  terminalStatusStore.getState().set("t1", { state: "running" });
  await mountTerminal(terminal());
  expect(host.textContent).not.toContain("Running with the old launch settings");
  await typeInto(field("Title")!, "Review of api");
  expect(host.textContent).toContain("Running with the old launch settings");
  // Back to what it started with: nothing to restart.
  await typeInto(field("Title")!, "Isis · api");
  expect(restartNow()).toBeUndefined();
});
