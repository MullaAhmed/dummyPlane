// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { TerminalOptionsDialog } from "./TerminalOptionsDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const terminal = (patch: Partial<TerminalPayload> = {}): TerminalPayload => ({
  title: "Isis",
  name: "Isis",
  agent: "claude",
  cwd: "C:/code",
  shell: "powershell",
  command: "",
  ...patch,
});

let root: Root;
const onClose = vi.fn();

beforeEach(() => {
  onClose.mockClear();
  mockIPC(() => undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  clearMocks();
  nodesStore.setState({ nodes: {} });
  document.body.replaceChildren();
});

async function openFor(payload: TerminalPayload) {
  nodesStore.setState({ nodes: { isis: { workspaceId: "w1", kind: "terminal", payload } } });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<TerminalOptionsDialog nodeId="isis" payload={payload} onClose={onClose} />));
}

/** The field a label names, through its `for`. */
const field = (label: string) => {
  const tag = [...document.body.querySelectorAll("label")].find((l) => l.textContent === label);
  return tag ? (document.getElementById(tag.htmlFor) as HTMLInputElement | null) : null;
};
const labels = () => [...document.body.querySelectorAll("label")].map((l) => l.textContent);
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const apply = async () => {
  const button = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Apply at next launch")!;
  await act(async () => button.click());
};
const stored = () => terminalOf(nodesStore.getState().nodes.isis)!;

it("shows no command for a Claude terminal, which never runs one, and leaves its stored command alone", async () => {
  // A terminal switched from Custom to Claude keeps the command it had.
  await openFor(terminal({ command: "npm run dev" }));
  expect(field("Folder")!.value).toBe("C:/code");
  expect(field("Command to run")).toBeNull();
  expect(labels()).toEqual(["Folder", "Shell", "Title"]);
  expect(document.body.querySelector('input[placeholder="npm run dev"]')).toBeNull();
  const update = vi.spyOn(nodesStore.getState(), "update");
  await type(field("Title")!, "  Isis · api  ");
  await apply();
  expect(update).toHaveBeenCalledWith("isis", expect.not.objectContaining({ command: expect.anything() }));
  expect(stored()).toMatchObject({ title: "Isis · api", command: "npm run dev" });
  expect(onClose).toHaveBeenCalled();
});

it("shows a Custom terminal's command first, says what runs it, and saves it trimmed", async () => {
  await openFor(terminal({ agent: "custom", title: "Dev server", command: "npm run dev" }));
  const command = field("Command to run")!;
  expect(command.value).toBe("npm run dev");
  expect(document.getElementById(command.getAttribute("aria-describedby")!)!.textContent).toBe("A Custom terminal runs it in its shell when it starts.");
  expect(labels()).toEqual(["Command to run", "Folder", "Shell", "Title"]);
  await type(command, "  pnpm dev --port 3000 ");
  await apply();
  expect(stored()).toMatchObject({ agent: "custom", command: "pnpm dev --port 3000", cwd: "C:/code", title: "Dev server" });
});

it("changes nothing on Cancel", async () => {
  await openFor(terminal({ agent: "custom", command: "npm run dev" }));
  await type(field("Command to run")!, "rm -rf dist");
  const cancel = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!;
  await act(async () => cancel.click());
  expect(stored().command).toBe("npm run dev");
  expect(onClose).toHaveBeenCalled();
});
