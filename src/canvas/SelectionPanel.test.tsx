// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { accountsStore } from "@/accounts/store";
import type { ClaudeExtensions, ExtensionItem } from "@/ipc/claudeExtensions";
import { agentsStore } from "@/agents/agentsStore";
import type { FleetPayload, TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { agentActivityStore } from "@/store/agentActivity";
import type { SessionUsage } from "@/usage/usage";
import { markLaunch, usageStore } from "@/usage/usageStore";
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
// Remote Control's flow types into Claude's terminal; here, only what is asked of it.
const { setRemoteControl } = vi.hoisted(() => ({ setRemoteControl: vi.fn(async () => null) }));
vi.mock("@/agents/remoteControl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/agents/remoteControl")>()),
  setRemoteControl,
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
  setRemoteControl.mockClear();
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
  agentActivityStore.setState({ activities: {} });
  usageStore.setState({ sessions: {}, launchedAt: {} });
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
  title: "Batman · api",
  name: "Batman",
  agent: "claude",
  cwd: "D:/work/api",
  shell: "default",
  command: "",
  ...overrides,
});

/** What t1's Claude reported in its status line (spec maj §6). */
const reported = (patch: Partial<SessionUsage> = {}): SessionUsage => ({
  sessionId: "s1",
  nodeId: "t1",
  model: { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
  effort: null,
  costUsd: 0,
  apiMs: 0,
  wallMs: 0,
  linesAdded: 0,
  linesRemoved: 0,
  inputTokens: 67_000,
  outputTokens: 785,
  contextPercent: 7,
  cache: null,
  at: 1,
  ...patch,
});

/** Selects the terminal and, unless told not to, opens its panel from its Edit tab, as most tests need. */
async function mountTerminal(payload: TerminalPayload, selectedIds = ["t1"], mode: "reading" | null = null, open = true) {
  nodesStore.setState({
    nodes: {
      t1: { workspaceId: "w", kind: "terminal", payload },
      t2: { workspaceId: "w", kind: "terminal", payload: terminal({ name: "Cyborg" }) },
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
const select = (label: string) => host.querySelector<HTMLButtonElement>(`button[role='combobox'][aria-label="${label}"]`);
/** The options a select offers, opened with the keyboard as a user does; closed again with Escape. */
async function optionsOf(label: string): Promise<string[]> {
  await act(async () => {
    select(label)!.focus();
    select(label)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  const options = [...document.body.querySelectorAll<HTMLElement>("[role='option']")].map((o) => o.textContent ?? "");
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  return options;
}
/** Opens a select with the keyboard and picks an option by its label, as a user does. */
async function pick(label: string, option: string) {
  // Radix scrolls the chosen option into view; happy-dom has no layout to do it with.
  const scrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = () => undefined;
  try {
    await act(async () => {
      select(label)!.focus();
      select(label)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    const found = [...document.body.querySelectorAll<HTMLElement>("[role='option']")].find((o) => o.textContent === option)!;
    await act(async () => {
      found.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse", button: 0 }));
      found.click();
    });
  } finally {
    Element.prototype.scrollIntoView = scrollIntoView;
  }
}
const payloadOf = () => (nodesStore.getState().nodes.t1 as { payload: TerminalPayload }).payload;

/** Types into a field and leaves it, as a user does. */
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.focus();
    input.value = value;
    input.blur();
  });
}

it("shows a terminal selected alone its General page: its name, Copy and Delete beside it, no colours", async () => {
  await mountTerminal(terminal());
  expect(host.querySelector("section[aria-label='Edit']")).not.toBeNull();
  expect(host.textContent).toContain("Edit Batman");
  expect(field("Name")!.value).toBe("Batman");
  expect(host.querySelector("[data-folder]")?.textContent).toContain("D:/work/api");
  expect(field("Command")).toBeNull();
  expect(host.querySelector("button[aria-label^='Stroke: ']")).toBeNull();
  expect(button("Duplicate")).toBeNull();
  // No row of actions on top: the Name field renames, two small buttons beside it copy and delete.
  expect(button("Rename")).toBeNull();
  expect(button("Copy the terminal")).not.toBeNull();
  expect(button("Delete the terminal")).not.toBeNull();
  // Every label is the name of its control.
  for (const label of host.querySelectorAll("label[for]")) expect(document.getElementById(label.getAttribute("for")!)).not.toBeNull();
});

it("copies and deletes the terminal from the buttons beside its name", async () => {
  await mountTerminal(terminal());
  await act(async () => button("Copy the terminal")!.click());
  expect(duplicateTerminal).toHaveBeenCalledWith("w", "t1");
  await act(async () => button("Delete the terminal")!.click());
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
  await typeInto(field("Name")!, "  Aquaman ");
  expect(payloadOf().name).toBe("Aquaman");
  await typeInto(field("Name")!, "   ");
  expect(payloadOf().name).toBe("Aquaman");
});

it("keeps the stored value when Escape ends the edit", async () => {
  await mountTerminal(terminal());
  const name = field("Name")!;
  await act(async () => {
    name.focus();
    name.value = "Shazam";
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(payloadOf().name).toBe("Batman");
  expect(name.value).toBe("Batman");
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
  // The folder waits for the next launch: its group says so, once, and no note repeats it.
  expect(host.querySelector("[role='group'] > .dp-label")?.textContent).toBe("Next launch");
  expect(host.textContent).not.toContain("apply at the next launch");
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  await act(async () => button("Copy the path")!.click());
  expect(writeText).toHaveBeenCalledWith("/home/ada/work/api");
  writeText.mockRestore();
});

it("edits the command of a custom agent only", async () => {
  await mountTerminal(terminal({ agent: "custom", command: "npm run dev" }));
  expect(field("Command")!.value).toBe("npm run dev");
  await typeInto(field("Command")!, "npm test");
  expect(payloadOf().command).toBe("npm test");
});

it("picks the model of the next launch, Claude's own pick included, and keeps a model a mission chose on offer", async () => {
  await mountTerminal(terminal({ model: "claude-fable-5-1" }));
  expect(select("Model")!.textContent).toBe("Fable 5.1");
  expect(await optionsOf("Model")).toEqual(["Your plan's default model", "Fable 5.1", "Haiku 5.5", "Sonnet 5.5", "Opus 5.5", "Fable 5.2"]);
  await pick("Model", "Opus 5.5");
  expect(payloadOf().model).toBe("claude-opus-5-5");
  await pick("Model", "Your plan's default model");
  expect(payloadOf().model).toBeUndefined();
  // Never a bare "Default": no model given, Claude picks, and the choice says which.
  expect(select("Model")!.textContent).toBe("Your plan's default model");
});

/** Answers `claude_launch_defaults` with these settings (the other commands, a node's save, get nothing). */
let defaultsCalls: unknown[] = [];
function serveLaunchDefaults(answer: { model?: string }) {
  defaultsCalls = [];
  mockIPC((cmd, args) => {
    if (cmd !== "claude_launch_defaults") return undefined;
    defaultsCalls.push(args);
    return answer;
  });
}
/** Lets an answer of a command arrive. */
const answered = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

it("names the model Claude picks itself from the terminal's settings, an alias as written, and reads them for its folder", async () => {
  serveLaunchDefaults({ model: "opus" });
  await mountTerminal(terminal());
  await answered();
  expect(defaultsCalls).toEqual([{ cwd: "D:/work/api", configDir: null }]);
  expect(select("Model")!.textContent).toBe("Opus · your settings");
  // Distinct from choosing Opus 5.5 outright, which the same list offers.
  expect(await optionsOf("Model")).toContain("Opus 5.5");
  // A full name its settings give reads as dummyPlane names it.
  serveLaunchDefaults({ model: "claude-haiku-5-5" });
  await mountTerminal(terminal({ cwd: "D:/work/web" }));
  await answered();
  expect(select("Model")!.textContent).toBe("Haiku 5.5 · your settings");
});

it("names the model a session running on Claude's own pick reports, not the one it was started with otherwise", async () => {
  serveLaunchDefaults({});
  terminalStatusStore.getState().set("t1", { state: "running" });
  usageStore.setState({ sessions: { s1: reported({ model: { id: "claude-opus-5-5", name: "Opus 5.5" }, effort: "xhigh" }) } });
  await mountTerminal(terminal());
  await answered();
  expect(select("Model")!.textContent).toBe("Opus 5.5 · plan default");
  serveLaunchDefaults({ model: "opus" });
  await mountTerminal(terminal({ cwd: "D:/work/web" }));
  await answered();
  expect(select("Model")!.textContent).toBe("Opus 5.5 · your settings");
  // Started with `--model`: what it reports is that model's, not what Claude would pick.
  await mountTerminal(terminal({ cwd: "D:/work/web", model: "claude-haiku-5-5" }));
  await answered();
  expect(select("Model")!.textContent).toBe("Haiku 5.5");
  expect(await optionsOf("Model")).toContain("Opus · your settings");
});

it("says which model and effort the running session really uses, from its status line, and offers to restart on another", async () => {
  terminalStatusStore.getState().set("t1", { state: "running" });
  await mountTerminal(terminal());
  expect(host.querySelector("[data-running-model]")).toBeNull();
  expect(host.querySelector("[data-running-effort]")).toBeNull();
  await act(async () => usageStore.setState({ sessions: { s1: reported({ model: { id: "claude-opus-5-5", name: "Opus 5.5" }, effort: "high" }) } }));
  expect(host.querySelector("[data-running-model]")?.textContent).toBe("Running Opus 5.5");
  expect(host.querySelector("[data-running-effort]")?.textContent).toBe("Running at High");
  expect(restartNow()).toBeUndefined();
  await pick("Model", "Haiku 5.5");
  expect(host.textContent).toContain("Running with the old launch settings");
  // Not running: what it last reported is no longer what it uses.
  await act(async () => terminalStatusStore.getState().set("t1", { state: "stopped" }));
  expect(host.querySelector("[data-running-model]")).toBeNull();
  expect(host.querySelector("[data-running-effort]")).toBeNull();
});

const effortThumb = () => host.querySelector<HTMLElement>("[role='slider'][aria-label='Effort']");
/** Presses a key on the effort slider's thumb, as a user does once it has the focus. */
async function pressOnEffort(key: string) {
  await act(async () => {
    effortThumb()!.focus();
    effortThumb()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

it("sets the effort of the next launch on a slider of Claude's levels, Auto giving none", async () => {
  await mountTerminal(terminal());
  expect(effortThumb()!.getAttribute("aria-valuetext")).toBe("Auto");
  expect(host.querySelector("[data-effort]")?.textContent).toBe("Auto");
  expect(host.textContent).toContain("Your settings, else the model's default");
  await pressOnEffort("ArrowRight");
  expect(payloadOf().effort).toBe("low");
  expect(effortThumb()!.getAttribute("aria-valuetext")).toBe("Low");
  expect(host.textContent).not.toContain("Your settings, else the model's default");
  await pressOnEffort("End");
  expect(payloadOf().effort).toBe("max");
  expect(host.querySelector("[data-effort]")?.textContent).toBe("Max");
  await pressOnEffort("ArrowLeft");
  expect(payloadOf().effort).toBe("xhigh");
  expect(host.querySelector("[data-effort]")?.textContent).toBe("Extra high");
  await pressOnEffort("Home");
  expect(payloadOf().effort).toBeUndefined();
  expect(effortThumb()!.getAttribute("aria-valuetext")).toBe("Auto");
});

it("keeps the effort thumb on the stored level after a key's step: an undo moves it back, another terminal shows its own", async () => {
  await mountTerminal(terminal());
  await pressOnEffort("ArrowRight");
  await pressOnEffort("ArrowRight");
  expect(payloadOf().effort).toBe("medium");
  // An undo puts the stored level back to what the last step left.
  await act(async () => nodesStore.getState().update("t1", { effort: "low" }));
  expect(effortThumb()!.getAttribute("aria-valuetext")).toBe("Low");
  expect(host.querySelector("[data-effort]")?.textContent).toBe("Low");
  await act(async () => nodesStore.getState().update("t1", { effort: undefined }));
  expect(effortThumb()!.getAttribute("aria-valuetext")).toBe("Auto");
  // Another terminal selected: its own level, whatever the last one's thumb did.
  await pressOnEffort("End");
  await act(async () => nodesStore.getState().update("t2", { effort: "high" }));
  await act(async () => canvasStore.setState({ view: { ...canvasStore.getState().view, selectedIds: ["t2"] } }));
  const tab = editTab();
  if (tab) await act(async () => tab.click());
  expect(effortThumb()!.getAttribute("aria-valuetext")).toBe("High");
});

it("offers a running terminal a restart once its effort changes, and gives a fleet's session its own", async () => {
  terminalStatusStore.getState().set("t1", { state: "running" });
  await mountTerminal(terminal({ effort: "high" }));
  expect(effortThumb()!.getAttribute("aria-valuetext")).toBe("High");
  expect(restartNow()).toBeUndefined();
  await pressOnEffort("ArrowRight");
  expect(payloadOf().effort).toBe("xhigh");
  expect(restartNow()).not.toBeUndefined();
  // No effort slider for an agent Claude's levels mean nothing to.
  await mountTerminal(terminal({ agent: "codex" }));
  expect(effortThumb()).toBeNull();
  await mountFleet();
  await pressOnEffort("ArrowRight");
  expect(fleetOf().session?.effort).toBe("low");
  expect("effort" in fleetOf()).toBe(false);
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
  expect(tab.getAttribute("aria-label")).toBe("Edit Batman");
  expect([tab.style.left, tab.style.top]).toEqual(["512px", "100px"]);
  // Filled with the ink: it reads beside the selection's own outline.
  expect(tab.className).toContain("bg-dp-accent");
  expect(host.querySelector("section[aria-label='Edit']")).toBeNull();
  expect(field("Name")).toBeNull();
  await act(async () => tab.click());
  expect(editTab()).toBeNull();
  expect(field("Name")!.value).toBe("Batman");
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
  expect(editTab()!.getAttribute("aria-label")).toBe("Edit Batman");
  // Opened again, then another terminal selected: its tab only.
  await act(async () => editTab()!.click());
  expect(field("Name")).not.toBeNull();
  await act(async () => canvasStore.setState({ view: { ...canvasStore.getState().view, selectedIds: ["t2"] } }));
  expect(editTab()!.getAttribute("aria-label")).toBe("Edit Cyborg");
  expect(field("Name")).toBeNull();
  // The first one again, after none: its tab too.
  await act(async () => editTab()!.click());
  await act(async () => canvasStore.setState({ view: { ...canvasStore.getState().view, selectedIds: [] } }));
  expect(host.innerHTML).toBe("");
  await act(async () => canvasStore.setState({ view: { ...canvasStore.getState().view, selectedIds: ["t1"] } }));
  expect(editTab()!.getAttribute("aria-label")).toBe("Edit Batman");
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
  expect(field("Name")!.value).toBe("Batman");
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
  // Its session's folder and model, shown; no copy of a fleet,
  // and neither permissions nor an account: a fleet is the manager, its own rules come with its role.
  expect(host.querySelector("[data-folder]")?.textContent).toBe("D:/work/api");
  expect(select("Model")!.textContent).toBe("Your plan's default model");
  expect(select("Shell")).not.toBeNull();
  expect(select("Permissions")).toBeNull();
  expect(button("Delete the fleet")).not.toBeNull();
  expect(button("Copy the terminal")).toBeNull();
  expect(host.textContent).toContain("Next launch");
  // Said in the fleet's words, never the code's.
  expect(host.textContent?.toLowerCase()).not.toContain("orchestrator");
  expect(tabs().map((b) => b.textContent)).toEqual(["General", "Skills", "Plugins", "MCP", "Subagents"]);
});

it("renames a fleet on its node and deletes it with its own request", async () => {
  await mountFleet();
  await typeInto(field("Name")!, "  Atlas ");
  expect(fleetOf().name).toBe("Atlas");
  // Its session keeps the name it had: only the node was renamed.
  expect(fleetOf().session?.name).toBe("Fleet");
  await typeInto(field("Name")!, "   ");
  expect(fleetOf().name).toBe("Atlas");
  await act(async () => button("Delete the fleet")!.click());
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
  expect(select("Model")!.textContent).toBe("Haiku 5.5");
  await pick("Model", "Your plan's default model");
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

/** dummyPlane's own server, as Rust lists it: once, fixed. */
const OWN_SERVER_ROW = item("dummyplane", { source: "app", fixed: "own" });

it("lists the mission's own MCP server once, fixed and on, so it cannot be switched off from the MCP tab", async () => {
  serveExtensions(() => ({ ...EXTENSIONS, mcp: [OWN_SERVER_ROW, item("dummyplane", { description: "http · 127.0.0.1" }), item("DummyPlane"), item("github")] }));
  await mountFleet();
  await openTab("MCP");
  expect([...host.querySelectorAll("[data-extension]")].map((row) => row.getAttribute("data-extension"))).toEqual(["dummyplane", "github"]);
  const own = checkbox("dummyplane")!;
  expect(own.disabled).toBe(true);
  expect(own.getAttribute("aria-checked")).toBe("true");
  expect(document.getElementById(own.getAttribute("aria-describedby")!)?.textContent).toBe("The fleet's mission server is always on");
  expect(host.querySelector("[data-extension='dummyplane']")?.textContent).toContain("dummyPlane");
  // "Unselect all" turns off what can be switched: the mission's server is not.
  await act(async () => buttonText("Unselect all")!.click());
  expect(fleetOf().session?.extensions).toEqual({ mcpOff: ["github"] });
  expect(onCount()).toBe("1 of 2 on");
});

it("shows a terminal's own dummyPlane server in its words, not the fleet's", async () => {
  serveExtensions(() => ({ ...EXTENSIONS, mcp: [OWN_SERVER_ROW, item("dummyplane"), item("github")] }));
  await mountTerminal(terminal());
  await openTab("MCP");
  expect([...host.querySelectorAll("[data-extension]")].map((row) => row.getAttribute("data-extension"))).toEqual(["dummyplane", "github"]);
  expect(host.querySelector("[data-extension='dummyplane']")?.textContent).toContain("dummyPlane's tools: always on");
  expect(host.textContent).not.toContain("mission server");
});

it("lists claude.ai skills, commands and a plugin's skills, the plugin's fixed to its plugin, and says what isn't listed", async () => {
  serveExtensions(() => ({
    ...EXTENSIONS,
    skills: [
      item("anthropic-skills:pdf", { name: "pdf", source: "synced" }),
      item("chatlog", { source: "project", description: "Saves the chat log" }),
      item("codex:rescue", { source: "plugin", fixed: "plugin", plugin: "codex@openai" }),
    ],
    plugins: [item("codex@openai", { name: "codex" })],
  }));
  await mountTerminal(terminal());
  await openTab("Skills");
  expect(host.querySelector("[data-extension='anthropic-skills:pdf']")?.textContent).toContain("claude.ai");
  expect(host.textContent).toContain("Claude Code's bundled skills aren't listed here");
  const rescue = checkbox("codex:rescue")!;
  expect(rescue.disabled).toBe(true);
  expect(rescue.getAttribute("aria-checked")).toBe("true");
  expect(document.getElementById(rescue.getAttribute("aria-describedby")!)?.textContent).toBe("Comes with its plugin: switch the plugin in Plugins");
  // A claude.ai skill turns off under the name Claude's overrides take.
  await act(async () => checkbox("pdf")!.click());
  expect(payloadOf().extensions).toEqual({ skillsOff: ["anthropic-skills:pdf"] });
  // The plugin turned off for this terminal takes its skills with it.
  await openTab("Plugins");
  expect(host.textContent).toContain("run /plugin in the terminal to see them");
  await act(async () => checkbox("codex")!.click());
  await openTab("Skills");
  expect(checkbox("codex:rescue")!.getAttribute("aria-checked")).toBe("false");
});

it("renames and deletes a fleet that has no session yet, with nothing else to edit", async () => {
  serveExtensions();
  await mountFleet({ name: "Fleet" });
  expect(tabs()).toHaveLength(0);
  expect(host.querySelector("[data-folder]")).toBeNull();
  expect(host.textContent).not.toContain("Skills, plugins and MCP servers can be chosen");
  await typeInto(field("Name")!, "Atlas");
  expect(fleetOf().name).toBe("Atlas");
  expect(host.textContent).not.toContain("Next launch");
  await act(async () => button("Delete the fleet")!.click());
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
  expect(payloadOf()).toMatchObject({ model: "claude-haiku-5-5", permission: "edits", name: "Batman", title: "Batman · api" });
});

it("starts a new conversation for a Claude terminal in a new folder, and says so when it moves", async () => {
  const info = vi.spyOn(toast, "info");
  await mountTerminal(terminal({ claudeSessionId: "old-conversation", steps: [{ title: "Plan", state: "fait" }] }));
  // Not a standing note under the path: said once, when it happens.
  expect(host.textContent).not.toContain("New folder, new conversation");
  await pickFolder("D:/work/web");
  const { claudeSessionId, steps } = payloadOf();
  expect(claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(claudeSessionId).not.toBe("old-conversation");
  expect(steps).toBeUndefined();
  expect(info).toHaveBeenCalledWith("New folder, new conversation: Claude keeps each conversation with its folder");
  info.mockRestore();
});

it("moves another agent without a conversation, and has nothing to say about one", async () => {
  const info = vi.spyOn(toast, "info");
  await mountTerminal(terminal({ agent: "codex" }));
  await pickFolder("D:/work/web");
  expect(payloadOf().cwd).toBe("D:/work/web");
  expect("claudeSessionId" in payloadOf()).toBe(false);
  expect(info).not.toHaveBeenCalled();
  info.mockRestore();
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
  members: [{ nodeId: "t1", name: "Batman", task: "", budgetMin: 10, linked: false, branch: "m/batman", worktree: "D:/wt/batman" }],
});
async function inMission(state: "en_cours" | "terminee") {
  await act(async () => nodesStore.setState({ nodes: { ...nodesStore.getState().nodes, o1: { workspaceId: "w", kind: "fleet", payload: { name: "Fleet", mission: mission(state) } } } }));
}

it("keeps the folder of an agent whose mission is running in its worktree, and frees it when the mission ends", async () => {
  await mountTerminal(terminal({ cwd: "D:/wt/batman" }));
  await inMission("en_cours");
  expect(changeButton()).toBeNull();
  expect(host.textContent).toContain("Fixed while its mission runs: this agent works in its own worktree");
  expect(host.textContent).not.toContain("New folder, new conversation");
  await inMission("terminee");
  expect(changeButton()).not.toBeNull();
});

it("edits the agent's name only: no session name or title field, and the stored title is kept", async () => {
  terminalStatusStore.getState().set("t1", { state: "running" });
  await mountTerminal(terminal());
  expect(field("Name")!.value).toBe("Batman");
  expect(host.querySelectorAll("input")).toHaveLength(1);
  expect(host.textContent).not.toContain("Session name");
  expect(host.textContent).not.toContain("Title");
  // Claude still gets the stored title when a new conversation starts (`-n`).
  expect(payloadOf().title).toBe("Batman · api");
});

it("shows the shell a terminal will start with, among the ones the machine has", async () => {
  agentsStore.setState({ shells: ["default", "powershell", "gitbash"] });
  await mountTerminal(terminal({ shell: "gitbash" }));
  const shell = host.querySelector<HTMLElement>("button[role='combobox'][aria-label='Shell']")!;
  expect(shell.textContent).toBe("Git Bash");
  agentsStore.setState({ shells: [] });
});

/** Opens the Shell dropdown with the keyboard and picks a shell by its label, as a user does. */
const pickShell = (label: string) => pick("Shell", label);

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

const statusGroup = () => host.querySelector<HTMLElement>("[role='group'][aria-label='Status']")!;

it("says where the agent stands now: its dot and word, the step under way, its last report and what it spent", async () => {
  terminalStatusStore.getState().set("t1", { state: "running" });
  agentActivityStore.setState({ activities: { t1: { activity: "working", since: Date.now() } } });
  usageStore.setState({ sessions: { s1: reported() } });
  const steps = [
    { title: "Plan", state: "fait" as const },
    { title: "Build", state: "en_cours" as const },
    { title: "Ship", state: "a_venir" as const },
  ];
  await mountTerminal(terminal({ steps, lastReport: { status: "blocked", summary: "Waiting for the API key" } }));
  // The same dot and word as its header's.
  expect(statusGroup().querySelector("[data-status='working']")).not.toBeNull();
  expect(statusGroup().textContent).toContain("Working");
  expect(host.querySelector("[data-step]")?.textContent).toBe("Step 2 of 3: Build");
  expect(host.querySelector("[data-report-summary]")?.textContent).toBe("Last report · Waiting for the API key");
  expect(statusGroup().textContent).toContain("67.8 k tokens · 7 % context");
});

it("counts the steps done once none is under way, and shows no spending for a stopped agent", async () => {
  usageStore.setState({ sessions: { s1: reported() } });
  await mountTerminal(terminal({ steps: [{ title: "Plan", state: "fait" }, { title: "Ship", state: "a_venir" }] }));
  expect(host.querySelector("[data-step]")?.textContent).toBe("1 of 2 steps done");
  expect(statusGroup().textContent).toContain("Stopped");
  expect(statusGroup().textContent).not.toContain("tokens");
  expect(host.querySelector("[data-report-summary]")).toBeNull();
});

it("picks what Claude may do unasked at the next launch, and says what it opens", async () => {
  terminalStatusStore.getState().set("t1", { state: "running" });
  await mountTerminal(terminal());
  // None given: Claude as the user set it up, nothing to say.
  expect(select("Permissions")!.textContent).toBe("Claude's settings");
  expect(await optionsOf("Permissions")).toEqual(["Claude's settings", "Ask first", "Files unasked", "Files and commands unasked"]);
  expect(host.textContent).not.toContain("git push blocked");
  await pick("Permissions", "Files and commands unasked");
  expect(payloadOf().permission).toBe("work");
  expect(host.textContent).toContain("Commands, the network and this PC's logged-in accounts are open to it · git push blocked");
  expect(restartNow()).toBeDefined();
  await pick("Permissions", "Files unasked");
  expect(payloadOf().permission).toBe("edits");
  expect(host.textContent).toContain("Asks before a command · git push blocked");
  // And back: none given again, the push block gone with it, and nothing left to restart.
  await pick("Permissions", "Claude's settings");
  expect("permission" in payloadOf() ? payloadOf().permission : undefined).toBeUndefined();
  expect(host.textContent).not.toContain("git push blocked");
  expect(restartNow()).toBeUndefined();
  // Another agent has no such setting.
  await mountTerminal(terminal({ agent: "codex" }));
  expect(select("Permissions")).toBeNull();
  expect(select("Model")).toBeNull();
});

it("picks the account of the next launch, with a new conversation, once there are profiles to pick from", async () => {
  await mountTerminal(terminal({ claudeSessionId: "old-conversation" }));
  expect(select("Account")).toBeNull();
  const info = vi.spyOn(toast, "info");
  await act(async () => accountsStore.setState({ profiles: [{ id: "work", name: "Work", configDir: "C:/claude-work" }], loaded: true }));
  expect(select("Account")!.textContent).toBe("Default");
  await pick("Account", "Work");
  expect(payloadOf().accountId).toBe("work");
  expect(payloadOf().claudeSessionId).not.toBe("old-conversation");
  expect(info).toHaveBeenCalledWith("New account, new conversation: Claude keeps each conversation with its account");
  await pick("Account", "Default");
  expect(payloadOf().accountId).toBeUndefined();
  info.mockRestore();
});

it("keeps the account and the permissions of an agent whose mission is running: they are its mission's", async () => {
  accountsStore.setState({ profiles: [{ id: "work", name: "Work", configDir: "C:/claude-work" }], loaded: true });
  await mountTerminal(terminal({ cwd: "D:/wt/batman", permission: "edits" }));
  await inMission("en_cours");
  expect(select("Account")!.disabled).toBe(true);
  expect(select("Permissions")!.disabled).toBe(true);
  await inMission("terminee");
  expect(select("Permissions")!.disabled).toBe(false);
});

it("says nothing of what an earlier run reported once the terminal starts Claude again", async () => {
  usageStore.setState({ sessions: { s1: reported({ model: { id: "claude-opus-5-5", name: "Opus 5.5" }, at: 10 }) } });
  terminalStatusStore.getState().set("t1", { state: "running" });
  await act(async () => markLaunch("t1", 20));
  await mountTerminal(terminal());
  expect(host.querySelector("[data-running-model]")).toBeNull();
  expect(statusGroup().textContent).not.toContain("tokens");
  // Its own first status line.
  await act(async () => usageStore.setState({ sessions: { ...usageStore.getState().sessions, s2: reported({ sessionId: "s2", at: 30 }) } }));
  expect(host.querySelector("[data-running-model]")?.textContent).toBe("Running Sonnet 5.5");
  expect(statusGroup().textContent).toContain("67.8 k tokens");
});

it("turns Remote Control on and off from its box, the same switch as the header's phone", async () => {
  await mountTerminal(terminal());
  const box = () => host.querySelector<HTMLButtonElement>("button[role='checkbox'][aria-label='Remote Control']")!;
  expect(box().getAttribute("aria-checked")).toBe("false");
  await act(async () => box().click());
  expect(setRemoteControl).toHaveBeenCalledWith("t1", true);
  await act(async () => nodesStore.getState().update("t1", { remoteControl: true }));
  expect(box().getAttribute("aria-checked")).toBe("true");
  // A stopped session gets it when it starts.
  expect(host.textContent).toContain("At next start");
  await act(async () => box().click());
  expect(setRemoteControl).toHaveBeenLastCalledWith("t1", false);
  // Only Claude has it.
  await mountTerminal(terminal({ agent: "codex" }));
  expect(host.querySelector("button[aria-label='Remote Control']")).toBeNull();
});
