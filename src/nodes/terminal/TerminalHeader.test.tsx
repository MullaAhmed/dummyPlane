// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { requestUi } from "@/commands/uiRequests";
import { remoteStore } from "@/agents/remoteControl";
import { canvasStore } from "@/canvas/canvasStore";
import { leaveGroup } from "@/agents/groups";
import { nodesStore } from "@/store/nodes";
import type { TerminalPayload } from "@/nodes/types";
import { quickNote } from "@/nodes/note/quickNote";
import { relaunchTerminal, stopTerminal } from "./registry";
import { TerminalHeader } from "./TerminalHeader";

vi.mock("./registry", () => ({ relaunchTerminal: vi.fn(), stopTerminal: vi.fn(), terminalText: vi.fn(() => "") }));
vi.mock("@/agents/groups", () => ({ leaveGroup: vi.fn() }));
// "Quick note": the note's text, given the keyboard once it mounts, after the menu has gone (addNote, focusNote).
vi.mock("@/nodes/note/quickNote", () => ({
  quickNote: vi.fn(async () => {
    const field = document.createElement("textarea");
    field.dataset.newNote = "";
    document.body.append(field);
    setTimeout(() => field.focus(), 100);
    return "n1";
  }),
}));

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

it("shows Remote Control on a Claude session only, as dummyPlane knows it", async () => {
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

describe("the model router's sticky switch", () => {
  const router = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="Model router"]');
  const shown = (payload: object) => <TerminalHeader nodeId="batman" payload={{ ...claude, ...payload } as TerminalPayload} status={{ state: "running" }} />;

  it("is on a Claude terminal only, never a Manager's, and keeps to the wide header with the chips", async () => {
    const view = await mount(shown({}));
    expect(router(view.host)?.getAttribute("data-router")).toBe("off");
    // One name, its state in aria-pressed: "Model router, toggle button, not pressed".
    expect(router(view.host)?.getAttribute("aria-pressed")).toBe("false");
    expect(router(view.host)?.parentElement?.className).toContain("@md/head:flex");
    await act(async () => view.root.render(shown({ agent: "shell" })));
    expect(router(view.host)).toBeNull();
    await act(async () => view.root.render(shown({ role: "manager", fleet: "chef" })));
    expect(router(view.host)).toBeNull();
    await view.unmount();
  });

  const payloadOf = () => nodesStore.getState().nodes.batman?.payload as TerminalPayload;

  it("is in its ⋯ menu too, at any width: a checked entry that writes the same switch, never a Manager's", async () => {
    mockIPC(() => undefined);
    await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: claude });
    const view = await mount(shown({}));
    await openMore(view.host);
    const entry = () => document.querySelector<HTMLElement>('[role="menuitemcheckbox"]');
    expect(entry()?.textContent).toBe("Model router");
    expect(entry()?.getAttribute("aria-checked")).toBe("false");
    await act(async () => entry()!.click());
    expect(payloadOf().router).toBe(true);
    await view.unmount();
    const manager = await mount(shown({ role: "manager", fleet: "chef" }));
    await openMore(manager.host);
    expect(entry()).toBeNull();
    await manager.unmount();
  });

  it("stays on until it is turned off, saved in the terminal's payload, and never asks for a restart", async () => {
    mockIPC(() => undefined);
    await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: { ...claude, model: "claude-haiku-5-5" } });
    const view = await mount(shown({ model: "claude-haiku-5-5" }));
    await act(async () => router(view.host)!.click());
    expect(payloadOf().router).toBe(true);
    // The model it chose stays: the router only speaks when a sub-task with a level comes.
    expect(payloadOf().model).toBe("claude-haiku-5-5");
    await act(async () => view.root.render(shown({ router: true, model: "claude-haiku-5-5" })));
    expect(router(view.host)?.getAttribute("aria-pressed")).toBe("true");
    expect(router(view.host)?.getAttribute("data-router")).toBe("on");
    expect(relaunchTerminal).not.toHaveBeenCalled();
    await act(async () => router(view.host)!.click());
    expect(payloadOf().router).toBeUndefined();
    await view.unmount();
  });
});

it("keeps the essentials on its row and the rest behind « ⋯ »: Review, Restart, Minimize and Duplicate are menu entries", async () => {
  const onDuplicate = vi.fn();
  const onClose = vi.fn();
  const view = await mount(<TerminalHeader nodeId="batman" payload={claude} status={{ state: "running" }} onDuplicate={onDuplicate} onClose={onClose} />);
  const labels = [...view.host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  // The agent, the model router (wide nodes only: `WIDE_ONLY`), Remote Control, the menu, Close: no more.
  expect(labels).toEqual(["Agent", "Model router", expect.stringContaining("Remote Control"), "More actions", "Close"]);
  const items = await openMore(view.host);
  expect(textOf(items())).toEqual(["Review changes", "Minimize", "Duplicate", "Quick note", "Resume the session", "New session", "Latest in the folder", "Stop the process"]);
  await act(async () => items()[2]!.click());
  expect(onDuplicate).toHaveBeenCalledOnce();
  await act(async () => view.host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
  expect(onClose).toHaveBeenCalledOnce();
  await view.unmount();
});

it("offers « Remove from group » in its menu when it stands in a group, and takes it out of the group", async () => {
  canvasStore.setState({ frames: [{ id: "g1", name: "Serveurs", x: 0, y: 0, width: 10, height: 10, group: { role: "backend", pantheon: "egypt" }, memberIds: ["batman"] }] });
  try {
    const view = await mount(<TerminalHeader nodeId="batman" payload={{ ...claude, agent: "shell" }} status={{ state: "stopped" }} />);
    const items = await openMore(view.host);
    expect(textOf(items())).toEqual(["Review changes", "Minimize", "Quick note", "Remove from group", "Restart"]);
    await act(async () => items()[3]!.click());
    await vi.waitFor(() => expect(leaveGroup).toHaveBeenCalledWith("batman"));
    await view.unmount();
  } finally {
    canvasStore.setState({ frames: [] });
  }
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
  expect(textOf(items())).toEqual(["Review changes", "Minimize", "Quick note", "Restart"]);
  await act(async () => items()[3]!.click());
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

it("says under a sub-agent's name what it was asked, legibly, its task in a tooltip the keyboard reaches", async () => {
  const task = "You are fixing the header of a spawned terminal. The line under the name must be readable.\n\n## Setup\n- run `pnpm i`";
  const robin = { ...claude, name: "Robin", title: "Header fix", spawnedBy: "batman", task };
  const view = await mount(<TerminalHeader nodeId="robin" payload={robin} status={{ state: "running" }} />);
  const header = view.host.querySelector("header")!;
  const stack = header.querySelector("[data-node-title]")!;
  // Two 16px lines in the 36px row; it gives way like the name, the end never shrinks.
  expect(stack.className).toContain("min-w-0");
  expect(stack.className).toContain("leading-4");
  expect(stack.firstElementChild!.textContent).toBe("Robin");
  const line = stack.querySelector<HTMLButtonElement>("[data-task-line]")!;
  expect(line.tagName).toBe("BUTTON");
  expect(line.textContent).toBe("Header fix");
  // The secondary text role (4.5:1 or more on the head in every palette), 12px, one line with an ellipsis, no opacity.
  expect(line.className).toContain("text-dp-text-2");
  expect(line.className).toContain("text-xs");
  expect(line.className).toContain("truncate");
  expect(line.className).not.toMatch(/opacity/);
  // Its tooltip says the title: no native one beside it.
  expect(header.hasAttribute("title")).toBe(false);
  await act(async () => line.focus());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
  const tip = document.querySelector('[role="tooltip"]')?.textContent ?? "";
  expect(tip).toContain("Header fix");
  expect(tip).toContain("The line under the name must be readable.");
  expect(tip).not.toContain("pnpm");
  await view.unmount();
});

it("keeps the row to the name field while it is renamed, and to the name for a terminal nobody spawned", async () => {
  const robin = { ...claude, name: "Robin", title: "Header fix", spawnedBy: "batman", task: "Fix the header" };
  const view = await mount(<TerminalHeader nodeId="robin" payload={robin} status={{ state: "running" }} />);
  await act(async () => requestUi({ kind: "renameTerminal", id: "robin" }));
  expect(view.host.querySelector("input")).not.toBeNull();
  expect(view.host.querySelector("[data-task-line]")).toBeNull();
  await view.unmount();
  const plain = await mount(<TerminalHeader nodeId="batman" payload={claude} status={{ state: "running" }} />);
  expect(plain.host.querySelector("[data-task-line]")).toBeNull();
  await plain.unmount();
});

it("shows its group's role as a named bar of the role's colour, never a second dot; nothing outside a group (P2 #56)", async () => {
  const solidDots = (host: HTMLElement) => [...host.querySelectorAll("header span")].filter((span) => span.className.includes("rounded-full") && !span.hasAttribute("data-status"));
  // In no group: no grey dot beside the agent any more.
  const loose = await mount(<TerminalHeader nodeId="batman" payload={claude} status={{ state: "running" }} />);
  expect(loose.host.querySelector("[data-role]")).toBeNull();
  expect(solidDots(loose.host)).toEqual([]);
  await loose.unmount();
  const group = { id: "g1", name: "Avengers", x: 0, y: 0, width: 100, height: 100, group: { role: "frontend", pantheon: "marvel" }, memberIds: ["batman"] };
  canvasStore.setState({ frames: [group] as never });
  try {
    const view = await mount(<TerminalHeader nodeId="batman" payload={claude} status={{ state: "running" }} />);
    const mark = view.host.querySelector<HTMLElement>("[data-role='frontend']")!;
    // Named, not by colour alone, and not a dot: the status dot is the only one in the header.
    expect(mark.getAttribute("role")).toBe("img");
    expect(mark.getAttribute("aria-label")).toBe("Frontend");
    const bar = mark.firstElementChild as HTMLElement;
    expect(bar.className).toContain("w-0.5");
    expect(bar.className).not.toContain("rounded-full");
    expect(bar.style.backgroundColor).not.toBe("");
    expect(solidDots(view.host)).toEqual([]);
    await view.unmount();
  } finally {
    canvasStore.setState({ frames: [] });
  }
});

it("keeps native titles off the header and its buttons: the terminal's title is on its name, the model's in the app's hint (P2 #20)", async () => {
  const payload = { ...claude, title: "Fixing the header", model: "claude-haiku-5-5" };
  const view = await mount(<TerminalHeader nodeId="batman" payload={payload} status={{ state: "running" }} onClose={() => {}} />);
  const header = view.host.querySelector("header")!;
  // On the header it showed over the hint of every button in it (Close, ⋯, Remote).
  expect(header.hasAttribute("title")).toBe(false);
  expect(header.querySelector("button[title]")).toBeNull();
  const name = header.querySelector("span[title]")!;
  expect(name.textContent).toBe("Batman");
  expect(name.getAttribute("title")).toBe("Fixing the header\nDouble-click to rename");
  const chip = header.querySelector<HTMLButtonElement>("[data-model]")!;
  await act(async () => chip.focus());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Model chosen by the router: claude-haiku-5-5");
  await view.unmount();
  // A title that only repeats the name adds nothing to its tooltip.
  const plain = await mount(<TerminalHeader nodeId="batman" payload={claude} status={{ state: "running" }} />);
  expect(plain.host.querySelector("header span[title]")!.getAttribute("title")).toBe("Double-click to rename");
  await plain.unmount();
});

it("writes a quick note from « ⋯ », and the closing menu leaves the keyboard in the note", async () => {
  const view = await mount(<TerminalHeader nodeId="batman" payload={claude} status={{ state: "stopped" }} />);
  const items = await openMore(view.host);
  const entry = items().find((item) => item.textContent === "Quick note")!;
  const more = view.host.querySelector('button[aria-label="More actions"]');
  await act(async () => entry.click());
  expect(quickNote).toHaveBeenCalledWith("batman");
  // The menu gone, Radix would hand the keyboard back to "⋯": the note's text is about to take it.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).not.toBe(more);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 200)));
  expect(document.activeElement).toBe(document.querySelector("[data-new-note]"));
  await view.unmount();
});
