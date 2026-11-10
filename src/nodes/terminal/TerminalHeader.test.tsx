// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { requestUi } from "@/commands/uiRequests";
import { remoteStore } from "@/agents/remoteControl";
import { nodesStore } from "@/store/nodes";
import { relaunchTerminal, stopTerminal } from "./registry";
import { TerminalHeader } from "./TerminalHeader";

vi.mock("./registry", () => ({ relaunchTerminal: vi.fn(), stopTerminal: vi.fn(), terminalText: vi.fn(() => "") }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.clearAllMocks();
  clearMocks();
  document.body.innerHTML = "";
});

const claude = { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" } as const;

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root, unmount: () => act(async () => root.unmount()) };
}

/** Opens the header's "⋯" the way the keyboard does; the entries of its menu, in order. */
async function openMore(host: HTMLElement) {
  const more = host.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!;
  await act(async () => more.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  return () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

const textOf = (items: HTMLElement[]) => items.map((item) => item.textContent);

it("opens its name editor on request, with the keyboard (« Rename » of the palette)", async () => {
  const view = await mount(<TerminalHeader nodeId="batman" payload={claude} status={{ state: "stopped" }} />);
  expect(view.host.querySelector("input")).toBeNull();
  await act(async () => requestUi({ kind: "renameTerminal", id: "cyborg" }));
  expect(view.host.querySelector("input")).toBeNull();
  await act(async () => requestUi({ kind: "renameTerminal", id: "batman" }));
  const field = view.host.querySelector("input")!;
  expect(field.value).toBe("Batman");
  expect(document.activeElement).toBe(field);
  await view.unmount();
});

/** Types into a React-controlled field the way the browser does. */
function type(field: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

async function rename() {
  mockIPC(() => undefined);
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: { ...claude } });
  const canvas = vi.fn();
  const view = await mount(<TerminalHeader nodeId="batman" payload={claude} status={{ state: "stopped" }} />);
  // What Excalidraw hears, on its container above the node: no key of the field may get there.
  view.host.addEventListener("keydown", canvas);
  await act(async () => requestUi({ kind: "renameTerminal", id: "batman" }));
  return { ...view, canvas, field: view.host.querySelector("input")! };
}

const nameOf = () => (nodesStore.getState().nodes.batman?.payload as { name: string }).name;

it("renames on Enter, trimmed, and keeps its keys from the canvas: Backspace there would delete the node", async () => {
  const { field, canvas, host, unmount } = await rename();
  for (const key of ["a", "Backspace", "Delete"]) await act(async () => void press(field, key));
  type(field, "  Cyborg ");
  await act(async () => void press(field, "Enter"));
  expect(canvas).not.toHaveBeenCalled();
  expect(host.querySelector("input")).toBeNull();
  expect(nameOf()).toBe("Cyborg");
  await unmount();
});

it("cancels a rename on Escape: the name stays, and Escape does not reach the canvas, which would deactivate the node", async () => {
  const { field, canvas, host, unmount } = await rename();
  type(field, "Cyborg");
  await act(async () => void press(field, "Escape"));
  expect(canvas).not.toHaveBeenCalled();
  expect(host.querySelector("input")).toBeNull();
  expect(nameOf()).toBe("Batman");
  await unmount();
});

it("keeps the name when the field is left empty or unchanged", async () => {
  const { field, host, unmount } = await rename();
  type(field, "   ");
  await act(async () => void press(field, "Enter"));
  expect(host.querySelector("input")).toBeNull();
  expect(nameOf()).toBe("Batman");
  await unmount();
});

it("shows Remote Control on a Claude session only, as dummyPlane knows it (spec maj §2)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const phone = () => host.querySelector("[data-remote]");
  await act(async () => root.render(<TerminalHeader nodeId="batman" payload={{ ...claude, agent: "shell" }} status={{ state: "running" }} />));
  expect(phone()).toBeNull();
  await act(async () => root.render(<TerminalHeader nodeId="batman" payload={claude} status={{ state: "running" }} />));
  expect(phone()?.getAttribute("data-remote")).toBe("off");
  await act(async () => root.render(<TerminalHeader nodeId="batman" payload={{ ...claude, remoteControl: true }} status={{ state: "stopped" }} />));
  expect(phone()?.getAttribute("aria-label")).toBe("Remote Control at next start");
  await act(async () => remoteStore.getState().set("batman", { state: "on", url: "https://claude.ai/code/session_1" }));
  expect(phone()?.getAttribute("aria-label")).toBe("Remote Control on");
  await act(async () => root.unmount());
  host.remove();
});

it("shows the model a mission's router gave the agent, which outlives the mission otherwise unseen (final review maj §3)", async () => {
  const view = await mount(<TerminalHeader nodeId="batman" payload={claude} status={{ state: "running" }} />);
  expect(view.host.querySelector("[data-model]")).toBeNull();
  await act(async () => view.root.render(<TerminalHeader nodeId="batman" payload={{ ...claude, model: "claude-haiku-5-5" }} status={{ state: "running" }} />));
  expect(view.host.querySelector("[data-model]")?.textContent).toBe("Haiku 5.5");
  await view.unmount();
});

it("names the model in its menu too, and clears it there: a narrow header hides the chip", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: { ...claude, model: "claude-haiku-5-5" } });
  const view = await mount(<TerminalHeader nodeId="batman" payload={{ ...claude, model: "claude-haiku-5-5" }} status={{ state: "stopped" }} />);
  const items = await openMore(view.host);
  expect(document.querySelector('[role="menu"]')!.textContent).toContain("Model chosen by the router: Haiku 5.5");
  const clear = items().find((item) => item.textContent === "Default model at next start")!;
  await act(async () => clear.click());
  expect((nodesStore.getState().nodes.batman?.payload as { model?: string }).model).toBeUndefined();
  await view.unmount();
});

it("keeps the essentials on its row and the rest behind « ⋯ »: Review, Restart, Minimize and Duplicate are menu entries", async () => {
  const onDuplicate = vi.fn();
  const onClose = vi.fn();
  const view = await mount(<TerminalHeader nodeId="batman" payload={claude} status={{ state: "running" }} onDuplicate={onDuplicate} onClose={onClose} />);
  const labels = [...view.host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  // The agent, Remote Control, the menu, Close: no more.
  expect(labels).toEqual(["Agent", expect.stringContaining("Remote Control"), "More actions", "Close"]);
  const items = await openMore(view.host);
  expect(textOf(items())).toEqual(["Review changes", "Minimize", "Duplicate", "Resume the session", "New session", "Latest in the folder", "Stop the process"]);
  await act(async () => items()[2]!.click());
  expect(onDuplicate).toHaveBeenCalledOnce();
  await act(async () => view.host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
  expect(onClose).toHaveBeenCalledOnce();
  await view.unmount();
});

it("restarts a Claude session three ways, and stops the process, from its menu", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: { ...claude } });
  const view = await mount(<TerminalHeader nodeId="batman" payload={claude} status={{ state: "running" }} />);
  const pick = async (text: string) => {
    const items = await openMore(view.host);
    await act(async () => items().find((item) => item.textContent === text)!.click());
  };
  await pick("Resume the session");
  expect(relaunchTerminal).toHaveBeenLastCalledWith("batman", claude, "resume");
  await pick("Latest in the folder");
  expect(relaunchTerminal).toHaveBeenLastCalledWith("batman", claude, "continue");
  await pick("New session");
  expect(relaunchTerminal).toHaveBeenLastCalledWith("batman", expect.objectContaining({ agent: "claude", claudeSessionId: expect.any(String) }), "new");
  await pick("Stop the process");
  expect(stopTerminal).toHaveBeenCalledWith("batman");
  await view.unmount();
});

it("restarts any other agent with one entry, and offers no Stop once nothing runs", async () => {
  const view = await mount(<TerminalHeader nodeId="batman" payload={{ ...claude, agent: "shell" }} status={{ state: "stopped" }} />);
  const items = await openMore(view.host);
  expect(textOf(items())).toEqual(["Review changes", "Minimize", "Restart"]);
  await act(async () => items()[2]!.click());
  expect(relaunchTerminal).toHaveBeenCalledWith("batman", expect.objectContaining({ agent: "shell" }), "new");
  await view.unmount();
});

it("gives way to its name on a narrow node: the chips hide below 28rem, the status word goes to the screen readers below 20rem", async () => {
  const view = await mount(
    <TerminalHeader nodeId="batman" payload={{ ...claude, agent: "shell", model: "claude-haiku-5-5" }} status={{ state: "stopped" }} />,
  );
  const header = view.host.querySelector("header")!;
  // Its own container: the node's width decides, not the window's.
  expect(header.className).toContain("@container/head");
  const chips = view.host.querySelector("[data-model]")!.parentElement!;
  expect(chips.className).toMatch(/\bhidden\b/);
  expect(chips.className).toContain("@md/head:flex");
  const word = view.host.querySelector("[data-status]")!.nextElementSibling!;
  expect(word.textContent).toBe("Stopped");
  expect(word.className).toContain("@max-xs/head:sr-only");
  // The name is the one thing that shrinks.
  const name = view.host.querySelector("header > span[title]")!;
  expect(name.className).toContain("min-w-0");
  expect(name.className).toContain("truncate");
  expect(view.host.querySelector("header > div")!.className).toContain("shrink-0");
  await view.unmount();
});

it("names its menu « More actions », with the same tooltip as the header's other buttons, never over its menu nor when the menu hands the focus back", async () => {
  const view = await mount(<TerminalHeader nodeId="batman" payload={claude} status={{ state: "running" }} />);
  const more = view.host.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!;
  // No native title: the system's own tooltip would show beside the app's.
  expect(more.hasAttribute("title")).toBe(false);
  const tooltip = () => document.querySelector('[role="tooltip"]')?.textContent ?? null;
  const later = () => act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
  await act(async () => more.focus());
  await later();
  expect(tooltip()).toBe("More actions");
  // The menu opens: the tooltip goes.
  await act(async () => more.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  expect(tooltip()).toBeNull();
  // Escape closes it and gives the focus back to the button: still no tooltip.
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await later();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(tooltip()).toBeNull();
  await view.unmount();
});
