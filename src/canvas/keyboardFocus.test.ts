// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { nodesStore } from "@/store/nodes";
import { readSource } from "@/theme/cssBlocks";
import { activeTerminalStore } from "./activeTerminal";
import { lastTerminalOf, terminalWithKeyboard, trackTerminalFocus } from "./keyboardFocus";

let untrack: () => void;

/** Focuses like a click or xterm would; the focusin is sent by hand in case the DOM emulation does not. */
const focusOn = (element: HTMLElement) => {
  element.focus();
  element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
};

const terminalNode = (nodeId: string) => {
  const root = document.createElement("div");
  root.dataset.terminal = nodeId;
  root.innerHTML = '<button type="button">Fermer</button><div><textarea></textarea></div>';
  document.body.append(root);
  const input = root.querySelector("textarea")!;
  const button = root.querySelector("button")!;
  return { input: { focus: () => focusOn(input) }, button: { focus: () => focusOn(button) } };
};

beforeAll(async () => {
  mockIPC(() => undefined);
  for (const [id, workspaceId] of [["isis", "w1"], ["thot", "w1"], ["horus", "w2"]]) {
    await nodesStore.getState().create(id, {
      workspaceId,
      kind: "terminal",
      payload: { title: id, name: id, agent: "claude", cwd: "C:/code", shell: "default", command: "" },
    });
  }
});
afterAll(() => clearMocks());
beforeEach(() => {
  untrack = trackTerminalFocus(document);
});
afterEach(() => {
  untrack();
  document.body.replaceChildren();
});

it("knows the terminal whose xterm has the keyboard, and none elsewhere", () => {
  const isis = terminalNode("isis");
  expect(terminalWithKeyboard()).toBeNull();
  isis.input.focus();
  expect(terminalWithKeyboard()).toBe("isis");
  isis.button.focus();
  expect(terminalWithKeyboard()).toBeNull();
});

it("makes the terminal whose xterm takes the keyboard the one Send goes to, and keeps it when the keyboard leaves", () => {
  activeTerminalStore.setState({ id: null });
  const isis = terminalNode("isis");
  const thot = terminalNode("thot");
  isis.input.focus();
  expect(activeTerminalStore.getState().id).toBe("isis");
  thot.input.focus();
  expect(activeTerminalStore.getState().id).toBe("thot");
  thot.button.focus();
  expect(activeTerminalStore.getState().id).toBe("thot");
  activeTerminalStore.setState({ id: null });
});

it("remembers the last terminal of each workspace to have had the keyboard (spec fenêtre §6.3)", () => {
  const isis = terminalNode("isis");
  const thot = terminalNode("thot");
  const horus = terminalNode("horus");
  isis.input.focus();
  horus.input.focus();
  expect(lastTerminalOf("w1")).toBe("isis");
  expect(lastTerminalOf("w2")).toBe("horus");
  thot.input.focus();
  thot.button.focus();
  expect(lastTerminalOf("w1")).toBe("thot");
});

it("does not count a click on a terminal's header button", () => {
  const isis = terminalNode("isis");
  const thot = terminalNode("thot");
  isis.input.focus();
  thot.button.focus();
  expect(lastTerminalOf("w1")).toBe("isis");
});

it("marks every terminal node with its id", () => {
  expect(readSource("nodes/terminal/TerminalNode.tsx")).toContain("data-terminal={nodeId}");
});
