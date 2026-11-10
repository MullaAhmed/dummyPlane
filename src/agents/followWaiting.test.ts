// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followWaitingStore } from "@/app/followWaitingSetting";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { DRAFT_MS, TYPING_MS } from "@/canvas/typing";
import { goToAgent } from "@/commands/goToRun";
import { paletteStore } from "@/commands/paletteState";
import { requestUi } from "@/commands/uiRequests";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { installFollowWaiting, RETRY_MS } from "./followWaiting";

vi.mock("@/commands/goToRun", () => ({ goToAgent: vi.fn() }));

const terminal = (name: string) => ({
  workspaceId: "w1",
  kind: "terminal",
  payload: { title: name, name, agent: "claude", cwd: "C:/code", shell: "default", command: "" },
});

/** Each test starts a minute after the last one: a key typed in one is long past in the next. */
let clock = 1_700_000_000_000;
let tick = 0;
let uninstall: () => void;
let hasFocus: ReturnType<typeof vi.spyOn>;

const wait = (nodeId: string, since = ++tick) => agentActivityStore.getState().apply({ nodeId, activity: "waiting", since });
const answer = (nodeId: string) => agentActivityStore.getState().apply({ nodeId, activity: "working", since: ++tick + 1000 });
const gone = () => vi.mocked(goToAgent).mock.calls.map(([agent]) => agent.id);

/** A terminal's xterm: a textarea in a node; the user can type in it, and it can hold the keyboard. */
function xterm(nodeId: string): HTMLTextAreaElement {
  const node = document.createElement("div");
  node.setAttribute("data-terminal", nodeId);
  node.innerHTML = '<div class="xterm"><textarea></textarea></div>';
  document.body.append(node);
  return node.querySelector("textarea")!;
}

/** Puts an element in the page and gives it the keyboard. */
function focused<T extends HTMLElement>(element: T): T {
  document.body.append(element);
  element.focus();
  return element;
}

/** A text field of the interface (the command bar, a name being edited, a dialog's input) that has the keyboard. */
const field = (value = "") => focused(Object.assign(document.createElement("input"), { value }));

/** A contenteditable element: it can be focused, and holds its text as content. */
const editableWith = (text: string) => () => {
  const element = document.createElement("div");
  element.setAttribute("contenteditable", "true");
  element.tabIndex = 0;
  element.textContent = text;
  return element;
};

const type = (target: Element) => target.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
const pass = (ms: number) => vi.advanceTimersByTime(ms);

beforeEach(() => {
  vi.useFakeTimers();
  clock += 60_000;
  vi.setSystemTime(clock);
  vi.clearAllMocks();
  document.body.innerHTML = "";
  hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  followWaitingStore.setState({ enabled: true });
  paletteStore.setState({ open: false });
  canvasStore.setState({ view: EMPTY_VIEW });
  projectsStore.setState({ view: "project" });
  workspacesStore.setState({ workspaces: [{ id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder: null }] });
  nodesStore.setState({ nodes: { a: terminal("A"), b: terminal("B"), c: terminal("C"), chef: { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } } } } as never);
  terminalStatusStore.setState({ statuses: { a: { state: "running" }, b: { state: "running" }, c: { state: "running" }, chef: { state: "running" } } });
  agentActivityStore.setState({ activities: {} });
  uninstall = installFollowWaiting();
});

afterEach(() => {
  uninstall();
  hasFocus.mockRestore();
  vi.useRealTimers();
});

describe("taking the user to an agent that starts waiting", () => {
  it("goes to it at once when nothing is in the way", () => {
    wait("a");
    expect(goToAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "a", kind: "terminal", name: "A", workspaceId: "w1" }));
  });

  it("goes to a fleet's session as well", () => {
    wait("chef");
    expect(goToAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "chef", kind: "fleet" }));
  });

  it("goes once per wait: a new question during the wait changes nothing", () => {
    wait("a", 5);
    agentActivityStore.getState().apply({ nodeId: "a", activity: "waiting", since: 5, message: "Run rm?" });
    pass(10_000);
    expect(gone()).toEqual(["a"]);
  });

  it("does not take the user to the agents already waiting when the interface loads", () => {
    uninstall();
    agentActivityStore.getState().load([{ nodeId: "a", activity: "waiting", since: 1 }]);
    uninstall = installFollowWaiting();
    pass(10_000);
    expect(goToAgent).not.toHaveBeenCalled();
  });

  it("does not take the user to an agent that is not in the open project", () => {
    wait("elsewhere");
    expect(goToAgent).not.toHaveBeenCalled();
  });

  it("stops when uninstalled", () => {
    uninstall();
    wait("a");
    expect(goToAgent).not.toHaveBeenCalled();
  });
});

describe("while the user writes", () => {
  it("waits for a pause of 3 s after the last key, then goes", () => {
    type(xterm("c"));
    wait("a");
    expect(goToAgent).not.toHaveBeenCalled();
    pass(TYPING_MS - 1);
    expect(goToAgent).not.toHaveBeenCalled();
    pass(1);
    expect(goToAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "a" }));
  });

  it("starts the pause over at each key", () => {
    const field = xterm("c");
    type(field);
    wait("a");
    pass(2000);
    type(field);
    pass(TYPING_MS - 1);
    expect(goToAgent).not.toHaveBeenCalled();
    pass(1);
    expect(gone()).toEqual(["a"]);
  });

  it("goes while the keyboard merely rests in an empty field: the command bar after sending", () => {
    field();
    wait("a");
    expect(gone()).toEqual(["a"]);
  });

  it("goes while the keyboard rests in a field whose draft nobody touched for 10 s", () => {
    field("a draft left behind");
    wait("a");
    expect(gone()).toEqual(["a"]);
  });

  it("waits for a pause of 3 s after a key in an empty field, then goes", () => {
    type(field());
    wait("a");
    pass(TYPING_MS - 1);
    expect(goToAgent).not.toHaveBeenCalled();
    pass(1);
    expect(gone()).toEqual(["a"]);
  });

  it("waits while a field holds an unsent draft, until 10 s after the last key, then goes", () => {
    const input = field();
    input.value = "git push";
    type(input);
    wait("a");
    pass(TYPING_MS);
    expect(goToAgent).not.toHaveBeenCalled();
    pass(DRAFT_MS - TYPING_MS - 1);
    expect(goToAgent).not.toHaveBeenCalled();
    pass(1);
    expect(gone()).toEqual(["a"]);
  });

  it("starts the 10 s over at each key typed in the draft", () => {
    const input = field();
    input.value = "git";
    type(input);
    wait("a");
    pass(8000);
    input.value = "git push";
    type(input);
    pass(DRAFT_MS - 1);
    expect(goToAgent).not.toHaveBeenCalled();
    pass(1);
    expect(gone()).toEqual(["a"]);
  });

  it("goes as soon as the draft is sent and the field is empty again", () => {
    const input = field();
    input.value = "git push";
    type(input);
    wait("a");
    pass(5000);
    expect(goToAgent).not.toHaveBeenCalled();
    input.value = "";
    pass(RETRY_MS);
    expect(gone()).toEqual(["a"]);
  });

  it.each([
    ["a text area", () => Object.assign(document.createElement("textarea"), { value: "a draft" }) as HTMLElement],
    ["an editable element", editableWith("a draft")],
  ])("holds for a draft in %s as well, until the keyboard leaves it", (_, make) => {
    const element = focused(make());
    type(element);
    wait("a");
    pass(TYPING_MS + RETRY_MS);
    expect(goToAgent).not.toHaveBeenCalled();
    element.remove();
    pass(RETRY_MS);
    expect(gone()).toEqual(["a"]);
  });

  it("does not take a focused checkbox for a draft", () => {
    const box = focused(Object.assign(document.createElement("input"), { type: "checkbox" }));
    type(box);
    wait("a");
    pass(TYPING_MS);
    expect(gone()).toEqual(["a"]);
  });

  it("does not take the text of a terminal's input for a draft", () => {
    const screen = xterm("c");
    screen.value = "ls -la";
    type(screen);
    wait("a");
    pass(TYPING_MS);
    expect(gone()).toEqual(["a"]);
  });

  it("goes with the keyboard in a terminal that is not typed in: it holds it as long as nobody clicks elsewhere", () => {
    xterm("c").focus();
    wait("a");
    expect(gone()).toEqual(["a"]);
  });

  it("skips an agent that stops waiting before the pause", () => {
    type(xterm("c"));
    wait("a");
    pass(1000);
    answer("a");
    pass(30_000);
    expect(goToAgent).not.toHaveBeenCalled();
  });

  it("skips the ones that stopped and goes to the one that still waits", () => {
    type(xterm("c"));
    wait("a");
    wait("b");
    pass(1000);
    answer("a");
    pass(TYPING_MS);
    expect(gone()).toEqual(["b"]);
  });
});

describe("several agents waiting", () => {
  it("goes to the one waiting longest, whatever the order the news came in", () => {
    type(xterm("x"));
    wait("c", 30);
    wait("a", 10);
    wait("b", 20);
    pass(TYPING_MS);
    expect(gone()).toEqual(["a"]);
  });

  it("brings the next one only when the one gone to stops waiting, oldest first", () => {
    wait("a", 10);
    wait("b", 20);
    wait("c", 30);
    pass(60_000);
    expect(gone()).toEqual(["a"]);
    answer("a");
    expect(gone()).toEqual(["a", "b"]);
    pass(60_000);
    answer("b");
    expect(gone()).toEqual(["a", "b", "c"]);
  });

  it("applies the typing rule to the next one: the answer was typed, the pause comes first", () => {
    const field = xterm("a");
    wait("a", 10);
    wait("b", 20);
    expect(gone()).toEqual(["a"]);
    field.focus();
    type(field);
    answer("a");
    expect(gone()).toEqual(["a"]);
    pass(TYPING_MS - 1);
    expect(gone()).toEqual(["a"]);
    pass(1);
    expect(gone()).toEqual(["a", "b"]);
  });

  it("goes to the next one when the one gone to is stopped, not answered", () => {
    wait("a", 10);
    wait("b", 20);
    terminalStatusStore.setState({ statuses: { a: { state: "exited", code: 0 }, b: { state: "running" } } });
    pass(RETRY_MS);
    expect(gone()).toEqual(["a", "b"]);
  });

  it("goes to an agent that waits again after it was answered", () => {
    wait("a", 10);
    answer("a");
    wait("a", 5000);
    expect(gone()).toEqual(["a", "a"]);
  });
});

describe("answering in a waiting terminal", () => {
  it("never bounces away from it, even for an agent that waited longer", () => {
    wait("b", 20);
    xterm("b").focus();
    wait("a", 10);
    pass(60_000);
    expect(gone()).toEqual(["b"]);
  });

  it("goes to the one that waited longer once the answer is given", () => {
    wait("b", 20);
    xterm("b").focus();
    wait("a", 10);
    answer("b");
    expect(gone()).toEqual(["b", "a"]);
  });

  it("goes to the terminal that has the keyboard when it starts waiting: the view may be elsewhere", () => {
    xterm("a").focus();
    wait("a");
    expect(gone()).toEqual(["a"]);
  });

  it("goes to the terminal that has the keyboard before an agent that waited longer", () => {
    hasFocus.mockReturnValue(false);
    wait("a", 10);
    xterm("b").focus();
    wait("b", 20);
    hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
    pass(60_000);
    expect(gone()).toEqual(["b"]);
    answer("b");
    expect(gone()).toEqual(["b", "a"]);
  });

  it("serves the terminal the user moved into by hand, then goes on to the next one", () => {
    wait("a", 10);
    wait("b", 20);
    wait("c", 30);
    expect(gone()).toEqual(["a"]);
    xterm("b").focus();
    pass(RETRY_MS);
    expect(gone()).toEqual(["a", "b"]);
    pass(60_000);
    expect(gone()).toEqual(["a", "b"]);
    answer("b");
    expect(gone()).toEqual(["a", "b", "c"]);
  });

  it("lets go of the agent gone to when the user moves into another that waits, even one that waited before the interface loaded", () => {
    uninstall();
    agentActivityStore.getState().load([{ nodeId: "b", activity: "waiting", since: 1 }]);
    uninstall = installFollowWaiting();
    wait("a", 10);
    xterm("b").focus();
    wait("c", 30);
    expect(gone()).toEqual(["a"]);
    answer("b");
    expect(gone()).toEqual(["a", "c"]);
  });

  it("does not move for another agent while the keyboard stays in one that waits and was gone to", () => {
    wait("a", 10);
    xterm("a").focus();
    wait("b", 20);
    wait("c", 30);
    pass(60_000);
    expect(gone()).toEqual(["a"]);
  });
});

describe("when it does not go", () => {
  it("stays away while the window has not the focus, and goes when it is back if the agent still waits", () => {
    hasFocus.mockReturnValue(false);
    wait("a");
    pass(30_000);
    expect(goToAgent).not.toHaveBeenCalled();
    hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
    expect(gone()).toEqual(["a"]);
  });

  it("does not go back to an agent that stopped waiting while the window was away", () => {
    hasFocus.mockReturnValue(false);
    wait("a");
    answer("a");
    hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
    pass(30_000);
    expect(goToAgent).not.toHaveBeenCalled();
  });

  it("stays away when the setting is off, and does not go to the old ones when it is turned back on", () => {
    followWaitingStore.setState({ enabled: false });
    wait("a");
    pass(30_000);
    followWaitingStore.setState({ enabled: true });
    pass(30_000);
    expect(goToAgent).not.toHaveBeenCalled();
    wait("b");
    expect(gone()).toEqual(["b"]);
  });

  it("stops looking when the setting is turned off with an agent waiting", () => {
    type(xterm("c"));
    wait("a");
    followWaitingStore.setState({ enabled: false });
    pass(30_000);
    expect(goToAgent).not.toHaveBeenCalled();
  });

  it("stays away in reading mode, and goes when it is left", () => {
    canvasStore.setState({ view: { ...EMPTY_VIEW, mode: "reading" } });
    wait("a");
    pass(30_000);
    expect(goToAgent).not.toHaveBeenCalled();
    canvasStore.setState({ view: EMPTY_VIEW });
    pass(RETRY_MS);
    expect(gone()).toEqual(["a"]);
  });

  it("goes in zen mode: only the tools are hidden", () => {
    canvasStore.setState({ view: { ...EMPTY_VIEW, mode: "zen" } });
    wait("a");
    expect(gone()).toEqual(["a"]);
  });

  it("waits for the palette to close", () => {
    paletteStore.setState({ open: true });
    wait("a");
    pass(30_000);
    expect(goToAgent).not.toHaveBeenCalled();
    paletteStore.setState({ open: false });
    pass(RETRY_MS);
    expect(gone()).toEqual(["a"]);
  });

  it.each([
    ["a dialog", '<div role="dialog" data-state="open"></div>'],
    ["an alert dialog", '<div role="alertdialog" data-state="open"></div>'],
    ["a menu", '<div role="menu" data-state="open"></div>'],
    ["a popover", '<div data-radix-popper-content-wrapper><div data-state="open"></div></div>'],
    ["the radial menu", "<div data-radial></div>"],
  ])("waits for %s to close", (_, html) => {
    document.body.innerHTML = html;
    wait("a");
    pass(30_000);
    expect(goToAgent).not.toHaveBeenCalled();
    document.body.innerHTML = "";
    pass(RETRY_MS);
    expect(gone()).toEqual(["a"]);
  });

  it("is not stopped by a closed dialog or a tooltip", () => {
    document.body.innerHTML = '<div role="dialog" data-state="closed"></div><div data-radix-popper-content-wrapper><div data-state="delayed-open"></div></div>';
    wait("a");
    expect(gone()).toEqual(["a"]);
  });

  it("waits for a panel that a command just asked for to open", () => {
    requestUi({ kind: "composeGroup" });
    wait("a");
    expect(goToAgent).not.toHaveBeenCalled();
    pass(2000 + RETRY_MS);
    expect(gone()).toEqual(["a"]);
  });

  it("stays away at home: no canvas to arrive on", () => {
    projectsStore.setState({ view: "home" });
    wait("a");
    pass(30_000);
    expect(goToAgent).not.toHaveBeenCalled();
    projectsStore.setState({ view: "project" });
    pass(RETRY_MS);
    expect(gone()).toEqual(["a"]);
  });
});
