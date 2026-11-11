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
  for (const [id, workspaceId] of [["batman", "w1"], ["cyborg", "w1"], ["aquaman", "w2"]]) {
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
  const batman = terminalNode("batman");
  expect(terminalWithKeyboard()).toBeNull();
  batman.input.focus();
  expect(terminalWithKeyboard()).toBe("batman");
  batman.button.focus();
  expect(terminalWithKeyboard()).toBeNull();
});

it("makes the terminal whose xterm takes the keyboard the one Send goes to, and keeps it when the keyboard leaves", () => {
  activeTerminalStore.setState({ id: null });
  const batman = terminalNode("batman");
  const cyborg = terminalNode("cyborg");
  batman.input.focus();
  expect(activeTerminalStore.getState().id).toBe("batman");
  cyborg.input.focus();
  expect(activeTerminalStore.getState().id).toBe("cyborg");
  cyborg.button.focus();
  expect(activeTerminalStore.getState().id).toBe("cyborg");
  activeTerminalStore.setState({ id: null });
});

it("remembers the last terminal of each workspace to have had the keyboard", () => {
  const batman = terminalNode("batman");
  const cyborg = terminalNode("cyborg");
  const aquaman = terminalNode("aquaman");
  batman.input.focus();
  aquaman.input.focus();
  expect(lastTerminalOf("w1")).toBe("batman");
  expect(lastTerminalOf("w2")).toBe("aquaman");
  cyborg.input.focus();
  cyborg.button.focus();
  expect(lastTerminalOf("w1")).toBe("cyborg");
});

it("does not count a click on a terminal's header button", () => {
  const batman = terminalNode("batman");
  const cyborg = terminalNode("cyborg");
  batman.input.focus();
  cyborg.button.focus();
  expect(lastTerminalOf("w1")).toBe("batman");
});

it("marks every terminal node with its id", () => {
  expect(readSource("nodes/terminal/TerminalNode.tsx")).toContain("data-terminal={nodeId}");
});
