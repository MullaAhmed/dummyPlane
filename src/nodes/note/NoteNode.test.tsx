// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { nodesStore } from "@/store/nodes";
import { NoteNode } from "./NoteNode";
import { deleteNote } from "./notes";

vi.mock("./notes", () => ({ deleteNote: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const claude = { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" } as const;

beforeEach(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: { ...claude } });
  await nodesStore.getState().create("n1", { workspaceId: "w1", kind: "note", payload: { text: "check the migration" } });
  canvasStore.setState({ noteHosts: { n1: "batman" }, frames: [] });
});

afterEach(() => {
  vi.clearAllMocks();
  clearMocks();
  document.body.innerHTML = "";
  canvasStore.setState({ noteHosts: {}, frames: [] });
});

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<NoteNode nodeId="n1" />));
  return { host, unmount: () => act(async () => root.unmount()) };
}

/** Types into a React-controlled field the way the browser does. */
function type(field: HTMLTextAreaElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

it("shows its text under a title naming its terminal, and saves what is typed", async () => {
  const view = await mount();
  const field = view.host.querySelector("textarea")!;
  expect(field.value).toBe("check the migration");
  expect(field.getAttribute("aria-label")).toBe("Note on Batman");
  expect(view.host.querySelector("header")?.textContent).toBe("Note · Batman");
  await act(async () => type(field, "check the migration\nthen the tests"));
  expect(nodesStore.getState().nodes.n1).toMatchObject({ kind: "note", payload: { text: "check the migration\nthen the tests" } });
  await view.unmount();
});

it("deletes itself from its ✕", async () => {
  const view = await mount();
  await act(async () => view.host.querySelector<HTMLButtonElement>('button[aria-label="Delete the note"]')!.click());
  expect(deleteNote).toHaveBeenCalledWith("n1");
  await view.unmount();
});

it("says it stands alone once its terminal has closed", async () => {
  canvasStore.setState({ noteHosts: {} });
  const view = await mount();
  expect(view.host.querySelector("[data-alone]")?.textContent).toBe("Note");
  expect(view.host.querySelector("textarea")?.getAttribute("aria-label")).toBe("Note");
  await view.unmount();
});

it("goes off the screen with its terminal's folded group", async () => {
  canvasStore.setState({
    frames: [{ id: "g1", name: "Olympus", x: 0, y: 0, width: 10, height: 10, group: { role: "general", pantheon: "greek", folded: true }, memberIds: ["batman"] }],
  });
  const view = await mount();
  expect(view.host.querySelector("[data-note]")).toBeNull();
  await view.unmount();
});

it("draws on the panels' surface with their inks, never on a terminal's", async () => {
  const view = await mount();
  const card = view.host.querySelector<HTMLElement>("[data-note]")!;
  expect(card.className).toContain("bg-dp-surface");
  expect(view.host.innerHTML).not.toMatch(/dp-terminal/);
  await view.unmount();
});

it("keeps its keys from the canvas: Delete, Backspace or Ctrl+Z act on the text, not on the note", async () => {
  const updateScene = vi.fn();
  canvasStore.setState({ api: { updateScene } as never });
  const view = await mount();
  // What Excalidraw hears, on its container above the node: no key of the note may get there.
  const canvas = vi.fn();
  view.host.addEventListener("keydown", canvas);
  const field = view.host.querySelector("textarea")!;
  field.focus();
  for (const init of [{ key: "a" }, { key: "Backspace" }, { key: "Delete" }, { key: "z", ctrlKey: true }]) {
    await act(async () => void field.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true })));
  }
  expect(canvas).not.toHaveBeenCalled();
  // Escape leaves it: the note let go and unselected, the keyboard out of it.
  await act(async () => void field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(canvas).not.toHaveBeenCalled();
  expect(document.activeElement).not.toBe(field);
  expect(updateScene).toHaveBeenCalledWith({ appState: { activeEmbeddable: null, selectedElementIds: {}, selectedGroupIds: {} } });
  canvasStore.setState({ api: null });
  await view.unmount();
});
