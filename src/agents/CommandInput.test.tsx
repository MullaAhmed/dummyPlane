// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { sendCommand } from "./broadcast";
import { historyStore } from "./history";
import { CommandInput } from "./CommandInput";
import type { TargetAgent } from "./targets";

vi.mock("./broadcast", () => ({ sendCommand: vi.fn(() => Promise.resolve()) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const agents: TargetAgent[] = [
  { id: "b", name: "Thoth", groupName: null },
  { id: "d", name: "Zeus", groupName: null },
  { id: "h", name: "Hera", groupName: null },
];

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  mockIPC(() => undefined);
  vi.mocked(sendCommand).mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<CommandInput agents={agents} groups={[]} fallback={[]} placeholder="Consigne" emptyHint="Tape @" />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  clearMocks();
  document.body.replaceChildren();
});

const field = () => host.querySelector("textarea")!;
const options = () => [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent);
const chips = () => [...host.querySelectorAll("[data-target-chip]")].map((c) => c.textContent);

async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(field(), value);
    field().setSelectionRange(value.length, value.length);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(key: string) {
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

it("suggests Claude Code's commands after the targets, and Tab completes one", async () => {
  await type("@thoth /ef");
  expect(options()).toEqual([expect.stringContaining("/effort")]);
  await press("Tab");
  expect(field().value).toBe("@thoth /effort ");
  expect(options()).toEqual([]);
});

it("completes the last name of @thoth/ze, the names before it becoming targets too", async () => {
  await type("@thoth/ze");
  expect(options()).toEqual([expect.stringContaining("@zeus")]);
  await press("Tab");
  expect(chips()).toEqual(["@thoth", "@zeus"]);
  expect(field().value).toBe("");
});

it("sends a /command to every agent of @thoth/zeus/hera", async () => {
  await type("@thoth/zeus/hera /effort ultracode");
  await press("Enter");
  expect(sendCommand).toHaveBeenCalledWith(["b", "d", "h"], "/effort ultracode");
});

it("sends a command typed in full on Enter, instead of completing it (final review maj §1)", async () => {
  await type("@thoth /clear");
  await press("Enter");
  expect(sendCommand).toHaveBeenCalledWith(["b"], "/clear");
});

it("goes on through the history past a command, its list closed (final review maj §1)", async () => {
  await act(async () => historyStore.setState({ entries: ["@zeus lance les tests", "@thoth/zeus /compact"] }));
  await press("ArrowUp");
  expect(field().value).toBe("@thoth/zeus /compact");
  expect(options()).toEqual([]);
  await press("ArrowUp");
  expect(field().value).toBe("@zeus lance les tests");
});

it("does not send a /command whose target is unknown to the selection instead (final review maj §1)", async () => {
  await act(async () => root.render(<CommandInput agents={agents} groups={[]} fallback={["d"]} placeholder="Consigne" emptyHint="Tape @" />));
  await type("/clear @thoth/zues");
  await press("Enter");
  expect(sendCommand).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Unknown target: @thoth/zues");
  // The command stays in the field, to be corrected.
  expect(field().value).toBe("/clear @thoth/zues");
});


it("keeps an unknown name of @nobody/ze when Tab completes the last one (backlog 27 oct)", async () => {
  await type("@nobody/ze");
  await press("Tab");
  expect(field().value).toBe("@nobody/zeus");
  expect(chips()).toEqual([]);
});

it("keeps Escape for the kind of list it closed: @ does not close / (backlog 27 oct)", async () => {
  await type("@");
  await press("Escape");
  expect(options()).toEqual([]);
  await type("/");
  expect(options().length).toBeGreaterThan(0);
});

it("leaves one space when a command is completed before the text (backlog 27 oct)", async () => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field(), "/ef lance");
    field().setSelectionRange(3, 3);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await press("Tab");
  expect(field().value).toBe("/effort lance");
});

it("does not send a command after an unfinished mention (@thoth/ /clear, backlog 27 oct)", async () => {
  await act(async () => root.render(<CommandInput agents={agents} groups={[]} fallback={["d"]} placeholder="Consigne" emptyHint="Tape @" />));
  await type("@thoth/ /clear");
  await press("Enter");
  expect(sendCommand).not.toHaveBeenCalled();
});

it("starts the highlight again at the top when the caret moves (backlog 27 oct)", async () => {
  await type("/c");
  await press("ArrowDown");
  await press("ArrowDown");
  const selected = () => [...host.querySelectorAll('[role="option"]')].findIndex((o) => o.getAttribute("aria-selected") === "true");
  expect(selected()).toBe(2);
  await act(async () => {
    field().focus();
    field().setSelectionRange(1, 1);
    field().dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }));
  });
  expect(selected()).toBe(0);
});

it("does not send on the Enter that ends an IME composition (plan B3)", async () => {
  await type("@thoth lance");
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }));
  });
  expect(sendCommand).not.toHaveBeenCalled();
  await press("Enter");
  expect(sendCommand).toHaveBeenCalledTimes(1);
});

it("says why Send is grey when the chosen group has no agent, not Write an instruction (plan B3)", async () => {
  const empty = { id: "g1", name: "Vide", x: 0, y: 0, width: 10, height: 10, group: { role: "general", pantheon: "egypt" }, memberIds: [] };
  await act(async () => root.render(<CommandInput agents={agents} groups={[empty] as never} fallback={[]} placeholder="Consigne" emptyHint="Tape @" />));
  await type("@vide run the tests");
  const send = host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
  expect(send.disabled).toBe(true);
  expect(send.title).toBe("No agent in this target");
  expect(host.textContent).toContain("No agent in this target");
});

// --- When Send is grey: only when nothing is targeted (fallback empty and no known @mention). ---

const sendButton = () => host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;

async function renderWith(props: { agents?: TargetAgent[]; groups?: unknown[]; fallback?: string[] }) {
  await act(async () =>
    root.render(
      <CommandInput
        agents={props.agents ?? agents}
        groups={(props.groups ?? []) as never}
        fallback={props.fallback ?? []}
        placeholder="Consigne"
        emptyHint="Tape @"
      />,
    ),
  );
}

it("enables Send for a selected agent (fallback) and a plain instruction, and sends to it on click", async () => {
  await renderWith({ fallback: ["b"] });
  expect(sendButton().disabled).toBe(true);
  await type("run tests");
  expect(sendButton().disabled).toBe(false);
  expect(sendButton().title).toBe("Send");
  expect(host.textContent).not.toContain("Tape @");
  await act(async () => sendButton().click());
  expect(sendCommand).toHaveBeenCalledWith(["b"], "run tests");
});

it("enables Send with nothing selected when an @agent is typed, and sends to that agent", async () => {
  await type("@thoth run tests");
  expect(sendButton().disabled).toBe(false);
  await act(async () => sendButton().click());
  expect(sendCommand).toHaveBeenCalledWith(["b"], "run tests");
});

it("matches an @agent whatever its capitals (@Thoth)", async () => {
  await type("@Thoth run tests");
  expect(sendButton().disabled).toBe(false);
  await act(async () => sendButton().click());
  expect(sendCommand).toHaveBeenCalledWith(["b"], "run tests");
});

it("matches an @agent whatever its accents (@HÉRA)", async () => {
  await type("@HÉRA run tests");
  expect(sendButton().disabled).toBe(false);
  await act(async () => sendButton().click());
  expect(sendCommand).toHaveBeenCalledWith(["h"], "run tests");
});

it("keeps the targets of a send as chips: the next instruction is enabled without @", async () => {
  await type("@thoth run tests");
  await act(async () => sendButton().click());
  expect(chips()).toEqual(["@thoth"]);
  await type("run lint");
  expect(sendButton().disabled).toBe(false);
  await act(async () => sendButton().click());
  expect(sendCommand).toHaveBeenLastCalledWith(["b"], "run lint");
});

it("matches an agent whose name has spaces by its slug (@TeamBack)", async () => {
  await renderWith({ agents: [...agents, { id: "t", name: "Team Back", groupName: null }] });
  await type("@TeamBack run tests");
  expect(sendButton().disabled).toBe(false);
  await act(async () => sendButton().click());
  expect(sendCommand).toHaveBeenCalledWith(["t"], "run tests");
});

it("does not match an agent whose name has spaces when typed with the space (@Team Back, current behaviour)", async () => {
  await renderWith({ agents: [...agents, { id: "t", name: "Team Back", groupName: null }] });
  // "@Team" is no known mention: nothing is targeted and the generic hint shows.
  await type("@Team Back run tests");
  expect(sendButton().disabled).toBe(true);
  expect(sendButton().title).toBe("Tape @");
  expect(host.textContent).toContain("Tape @");
});

it("enables Send for an @group with nothing selected, and sends to its members", async () => {
  const group = { id: "g1", name: "Team Back", x: 0, y: 0, width: 10, height: 10, group: { role: "general", pantheon: "egypt" }, memberIds: ["b", "d"] };
  await renderWith({ groups: [group] });
  await type("@teamback run tests");
  expect(sendButton().disabled).toBe(false);
  await act(async () => sendButton().click());
  expect(sendCommand).toHaveBeenCalledWith(["b", "d"], "run tests");
});

it("keeps Send grey with nothing targeted; in an unfocused field the hint shows once text is typed, the title always", async () => {
  expect(sendButton().disabled).toBe(true);
  expect(sendButton().title).toBe("Tape @");
  expect(host.textContent).not.toContain("Tape @");
  await type("run tests");
  expect(sendButton().disabled).toBe(true);
  expect(sendButton().title).toBe("Tape @");
  expect(host.textContent).toContain("Tape @");
  await act(async () => sendButton().click());
  expect(sendCommand).not.toHaveBeenCalled();
});

it("shows how to target as soon as the field has the keyboard with nothing targeted, before any text", async () => {
  await act(async () => field().focus());
  expect(field().value).toBe("");
  expect(host.textContent).toContain("Tape @");
  await act(async () => field().blur());
  expect(host.textContent).not.toContain("Tape @");
});

it("keeps the hint away from a focused field that already has a target", async () => {
  await renderWith({ fallback: ["b"] });
  await act(async () => field().focus());
  expect(host.textContent).not.toContain("Tape @");
});

it("treats an @name shared by two agents as ambiguous: with nothing selected, Send stays grey (current behaviour)", async () => {
  await renderWith({
    agents: [
      { id: "c1", name: "Claude Code", groupName: null },
      { id: "c2", name: "Claude Code", groupName: null },
    ],
  });
  await type("@claudecode run tests");
  expect(sendButton().disabled).toBe(true);
  expect(sendButton().title).toBe("Tape @");
});

// --- The field is assistant-ui's composer; its keys stay this field's. ---

it("is an assistant-ui composer: its form, its field, its Send", () => {
  const form = host.querySelector('form[data-aui-composer-type="thread"]');
  expect(form).not.toBeNull();
  expect(form!.contains(field())).toBe(true);
  expect(form!.contains(sendButton())).toBe(true);
});

it("empties the field once sent, and keeps the command in the history as typed", async () => {
  await act(async () => historyStore.setState({ entries: [] }));
  await type("@thoth run tests");
  await press("Enter");
  expect(sendCommand).toHaveBeenCalledWith(["b"], "run tests");
  expect(field().value).toBe("");
  expect(historyStore.getState().entries.slice(-1)).toEqual(["@thoth run tests"]);
});

it("sends one command after another: nothing waits for an answer", async () => {
  await renderWith({ fallback: ["b"] });
  for (const command of ["run tests", "run lint"]) {
    await type(command);
    await press("Enter");
  }
  expect(vi.mocked(sendCommand).mock.calls).toEqual([
    [["b"], "run tests"],
    [["b"], "run lint"],
  ]);
});

it("keeps the text on Escape with no list open, and does not send on Shift+Enter", async () => {
  await renderWith({ fallback: ["b"] });
  await type("run tests");
  await press("Escape");
  expect(field().value).toBe("run tests");
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
  });
  expect(sendCommand).not.toHaveBeenCalled();
});

it("keeps every key from what holds the field (the canvas, in a fleet)", async () => {
  const seen = vi.fn();
  host.addEventListener("keydown", seen);
  await type("@th");
  for (const key of ["ArrowDown", "Escape", "Enter", "Backspace", "a"]) await press(key);
  expect(seen).not.toHaveBeenCalled();
});

it("keeps the keys of Send and of a chip's ✕ from the canvas too, when Tab brought the keyboard there", async () => {
  await type("@thoth run tests");
  await act(async () => sendButton().click());
  await type("run lint");
  const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Remove @thoth"]')!;
  const seen = vi.fn();
  host.addEventListener("keydown", seen);
  for (const button of [sendButton(), remove]) {
    button.focus();
    expect(document.activeElement).toBe(button);
    for (const key of ["Backspace", "Delete", "Escape", "a"]) {
      await act(async () => void button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    }
  }
  expect(seen).not.toHaveBeenCalled();
  // The field's own keys still work: Enter sends from it.
  await press("Enter");
  expect(sendCommand).toHaveBeenLastCalledWith(["b"], "run lint");
});

it("leaves the caret in the field on a click on Send or on a chip's ✕", async () => {
  await type("@thoth run tests");
  await act(async () => sendButton().click());
  const pressed = (element: Element) => {
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    element.dispatchEvent(down);
    return down.defaultPrevented;
  };
  expect(pressed(host.querySelector('button[aria-label="Remove @thoth"]')!)).toBe(true);
  await type("run lint");
  expect(pressed(sendButton())).toBe(true);
});

it("lists targets as plain rows: an icon each, and an agent's live status dot", async () => {
  await act(async () => {
    nodesStore.setState({
      nodes: { b: { workspaceId: "w1", kind: "terminal", payload: { title: "Thoth", name: "Thoth", agent: "claude", cwd: "C:/code", shell: "default", command: "" } } },
    });
    terminalStatusStore.setState({ statuses: { b: { state: "running" } } });
    agentActivityStore.setState({ activities: { b: { activity: "waiting", since: 0 } } });
  });
  await type("@");
  const rows = [...host.querySelectorAll('[role="option"]')];
  expect(rows.map((r) => r.querySelectorAll("svg").length)).toEqual([1, 1, 1, 1]);
  const dots = () => rows.map((r) => r.querySelector("[data-status-dot]")?.getAttribute("data-status-dot") ?? null);
  // @all has no dot; Thoth waits for an answer; Zeus and Hera have no session.
  expect(dots()).toEqual([null, "waiting", "stopped", "stopped"]);
  expect(rows[1].querySelector("[data-status-dot]")!.getAttribute("aria-label")).toBe("Waiting");
  await act(async () => {
    nodesStore.setState({ nodes: {} });
    terminalStatusStore.setState({ statuses: {} });
    agentActivityStore.setState({ activities: {} });
  });
});

it("shows an agent that reported and rests as Done, not Ready, in the list's dot", async () => {
  await act(async () => {
    nodesStore.setState({
      nodes: {
        b: { workspaceId: "w1", kind: "terminal", payload: { title: "Thoth", name: "Thoth", agent: "claude", cwd: "C:/code", shell: "default", command: "", lastReport: { status: "done", summary: "All green" } } },
      },
    });
    terminalStatusStore.setState({ statuses: { b: { state: "running" } } });
    agentActivityStore.setState({ activities: { b: { activity: "idle", since: 0 } } });
  });
  await type("@");
  const dot = host.querySelectorAll('[role="option"]')[1].querySelector("[data-status-dot]")!;
  expect(dot.getAttribute("aria-label")).toBe("Done");
  expect(dot.getAttribute("data-status-dot")).toBe("done");
  // Working again, it reads Working whatever its last report said.
  await act(async () => agentActivityStore.setState({ activities: { b: { activity: "working", since: 1 } } }));
  expect(host.querySelectorAll('[role="option"]')[1].querySelector("[data-status-dot]")!.getAttribute("aria-label")).toBe("Working");
  await act(async () => {
    nodesStore.setState({ nodes: {} });
    terminalStatusStore.setState({ statuses: {} });
    agentActivityStore.setState({ activities: {} });
  });
});

it("shows its keys as keycaps while empty, in place of a long placeholder", async () => {
  const keys = () => host.querySelector("[data-field-keys]");
  expect([...keys()!.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["@", "/", "↑"]);
  expect(field().getAttribute("aria-describedby")).toBe(keys()!.id);
  await type("run");
  expect(keys()).toBeNull();
  await act(async () => root.render(<CommandInput compact agents={agents} groups={[]} fallback={[]} placeholder="Consigne" emptyHint="Tape @" />));
  await type("");
  expect(keys()).toBeNull();
});

it("ties the field to its list: the highlighted line is the active one, and the mouse moves it", async () => {
  await type("@");
  const list = host.querySelector('[role="listbox"]')!;
  const rows = () => [...host.querySelectorAll('[role="option"]')];
  expect(field().getAttribute("aria-controls")).toBe(list.id);
  expect(field().getAttribute("aria-activedescendant")).toBe(rows()[0].id);
  await act(async () => void rows()[2].dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
  expect(rows()[2].getAttribute("aria-selected")).toBe("true");
  expect(field().getAttribute("aria-activedescendant")).toBe(rows()[2].id);
  await press("Escape");
  expect(field().hasAttribute("aria-controls")).toBe(false);
});
