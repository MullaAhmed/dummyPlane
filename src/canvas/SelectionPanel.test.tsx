// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { accountsStore } from "@/accounts/store";
import type { ClaudeExtensions, ExtensionItem } from "@/ipc/claudeExtensions";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { uiStore } from "@/store/ui";
import { canvasStore, EMPTY_VIEW } from "./canvasStore";
import { SelectionPanel } from "./SelectionPanel";

const { mutateElement } = vi.hoisted(() => ({ mutateElement: vi.fn() }));
vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "immediately" }, mutateElement }));
const { duplicateTerminal, requestClose } = vi.hoisted(() => ({ duplicateTerminal: vi.fn(async () => undefined), requestClose: vi.fn() }));
vi.mock("@/fleet/terminals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fleet/terminals")>()),
  duplicateTerminal,
  requestClose,
}));
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
  uiStore.setState({ editPanelFolded: false });
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

function mountTerminal(payload: TerminalPayload, selectedIds = ["t1"], mode: "reading" | null = null) {
  nodesStore.setState({
    nodes: {
      t1: { workspaceId: "w", kind: "terminal", payload },
      t2: { workspaceId: "w", kind: "terminal", payload: terminal({ name: "Thoth" }) },
      o1: { workspaceId: "w", kind: "orchestrator", payload: { name: "Orchestrator" } },
    },
  });
  canvasStore.setState({ drawnSelection: [], view: { ...EMPTY_VIEW, mode, selectedIds } });
  return act(async () => root.render(<SelectionPanel />));
}

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

it("stays hidden for several selected terminals, an orchestrator, and in reading mode", async () => {
  await mountTerminal(terminal(), ["t1", "t2"]);
  expect(host.innerHTML).toBe("");
  await mountTerminal(terminal(), ["o1"]);
  expect(host.innerHTML).toBe("");
  await mountTerminal(terminal(), ["t1"], "reading");
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

it("shows the folder read only, whole on hover, its end in view, and copies it", async () => {
  await mountTerminal(terminal({ cwd: "/home/ada/work/api" }));
  expect(field("Folder")).toBeNull();
  expect(host.querySelector("[data-folder] input")).toBeNull();
  expect(button("Browse")).toBeNull();
  const folder = host.querySelector<HTMLElement>("[data-folder]")!;
  expect(folder.textContent).toBe("/home/ada/work/api");
  expect(folder.title).toBe("/home/ada/work/api");
  // Cut from the start; the path itself stays left to right, its leading "/" included.
  expect(folder.style.direction).toBe("rtl");
  expect(folder.querySelector("bdi")).not.toBeNull();
  // A Claude terminal edits nothing that waits for the next launch.
  expect(host.textContent).not.toContain("next launch");
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  await act(async () => button("Copy the path")!.click());
  expect(writeText).toHaveBeenCalledWith("/home/ada/work/api");
  writeText.mockRestore();
});

it("edits the command of a custom agent only", async () => {
  await mountTerminal(terminal({ agent: "custom", command: "npm run dev" }));
  expect(field("Command")!.value).toBe("npm run dev");
  expect(host.textContent).toContain("The command applies at the next launch");
  await typeInto(field("Command")!, "npm test");
  expect(payloadOf().command).toBe("npm test");
});

it("lets a model a mission chose go back to the default", async () => {
  await mountTerminal(terminal({ model: "claude-haiku-5-5" }));
  expect(host.textContent).toContain("Model");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Default")!.click());
  expect(payloadOf().model).toBeUndefined();
});

it("folds to its title row, and stays folded for the next terminal selected", async () => {
  await mountTerminal(terminal());
  // Shown at once on selection; only an unfold eases in.
  expect(host.querySelector(".animate-in")).toBeNull();
  expect(button("Fold the panel")!.getAttribute("aria-expanded")).toBe("true");
  await act(async () => button("Fold the panel")!.click());
  expect(host.textContent).toContain("Edit Isis");
  expect(field("Name")).toBeNull();
  expect(button("Unfold the panel")!.getAttribute("aria-expanded")).toBe("false");
  // Another terminal, then none and the first again: still folded.
  await act(async () => canvasStore.setState({ view: { ...canvasStore.getState().view, selectedIds: ["t2"] } }));
  expect(host.textContent).toContain("Edit Thoth");
  expect(field("Name")).toBeNull();
  await act(async () => canvasStore.setState({ view: { ...canvasStore.getState().view, selectedIds: [] } }));
  await act(async () => canvasStore.setState({ view: { ...canvasStore.getState().view, selectedIds: ["t1"] } }));
  expect(field("Name")).toBeNull();
  await act(async () => button("Unfold the panel")!.click());
  expect(field("Name")!.value).toBe("Isis");
  expect(host.querySelector(".animate-in")).not.toBeNull();
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
