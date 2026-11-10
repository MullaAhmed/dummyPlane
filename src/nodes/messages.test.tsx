// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { nodesStore } from "@/store/nodes";
import { SHELL_LABELS } from "./terminal/launch";
import { pillOf } from "./terminal/pill";
import { relaunchSession } from "./terminal/session";
import { ResumeCard } from "./terminal/ResumeCard";
import { StatusPill } from "./terminal/StatusPill";
import { TerminalHeader } from "./terminal/TerminalHeader";
import { TerminalOptionsDialog } from "./terminal/TerminalOptionsDialog";
import { ToolsUnavailable } from "./fleet/ToolsUnavailable";

vi.mock("./terminal/registry", () => ({ relaunchTerminal: vi.fn(), stopTerminal: vi.fn(), terminalText: vi.fn(() => "") }));
vi.mock("@/app/logs", () => ({ openLogDir: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

const payload = { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "", claudeSessionId: "s" } as const;

it("labels the status pill in English", () => {
  expect(pillOf({ state: "running" })).toEqual({ label: "Active", tone: "live" });
  expect(pillOf({ state: "running" }, "working")).toEqual({ label: "Working", tone: "working" });
  expect(pillOf({ state: "stopped" })).toEqual({ label: "Stopped", tone: "stopped" });
  expect(pillOf({ state: "exited", code: 2 })).toEqual({ label: "Exited · 2", tone: "failed" });
  expect(pillOf({ state: "error", message: "x" })).toEqual({ label: "Error", tone: "failed" });
  // A Fleet refused its start says so on its header.
  expect(pillOf({ state: "error", message: "x", kind: "toolsUnavailable" })).toEqual({ label: "Tools unavailable", tone: "failed" });
});

it("tells in English how long the agent has been in its state", async () => {
  const { host, root } = await mount(<StatusPill status={{ state: "running" }} activity={{ activity: "idle", since: Date.now() - 45_000 }} />);
  expect(host.textContent).toBe("Ready");
  expect(host.querySelector("span")!.title).toMatch(/^Ready for \d+ s$/);
  await act(async () => root.unmount());
});

it("shows the header's menus and tooltips in English", async () => {
  const { host, root } = await mount(<TerminalHeader nodeId="batman" payload={payload} status={{ state: "stopped" }} onClose={() => {}} />);
  expect(host.querySelector('[aria-label="Agent"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="More actions"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Close"]')).not.toBeNull();
  expect(host.querySelector("header span[title]")!.getAttribute("title")).toBe("Double-click to rename");
  await act(async () => host.querySelector('[aria-label="More actions"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  const menu = document.querySelector('[role="menu"]')!.textContent!;
  for (const text of ["Review changes", "Minimize", "Restart", "Resume the session", "New session", "Latest in the folder"]) expect(menu).toContain(text);
  await act(async () => root.unmount());
});

it("offers to resume or restart in English", async () => {
  const resume = await mount(<ResumeCard nodeId="batman" payload={payload} status={{ state: "stopped" }} />);
  expect(resume.host.textContent).toContain("Resume the last conversation?");
  expect(resume.host.textContent).toContain("Click to resume · typing starts fresh");
  expect(resume.host.querySelector('[aria-label="Hide"]')).not.toBeNull();
  await act(async () => resume.root.unmount());
  const plain = await mount(<ResumeCard nodeId="batman" payload={{ ...payload, agent: "shell" }} status={{ state: "stopped" }} />);
  expect(plain.host.textContent).toContain("Restart?");
  await act(async () => plain.root.unmount());
});

it("shows the options dialog in English", async () => {
  mockIPC(() => undefined);
  await mount(<TerminalOptionsDialog nodeId="batman" payload={payload} onClose={() => {}} />);
  const text = document.body.textContent!;
  expect(text).toContain("Options for Batman");
  expect(text).toContain("Cancel");
  expect(text).toContain("Apply at next launch");
});

it("says in English why the fleet did not start", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("o", { workspaceId: "w", kind: "fleet", payload: { name: "Fleet" } });
  const { host, root } = await mount(<ToolsUnavailable nodeId="o" message="x" />);
  const text = host.textContent!;
  expect(text).toContain("dummyPlane tools unavailable");
  expect(text).toContain("the fleet could change your branch");
  expect(text).toContain("Try again");
  expect(text).toContain("Open the logs folder");
  await act(async () => root.unmount());
});

it("labels the default shell in English, and the restart marker written into the terminal", async () => {
  expect(SHELL_LABELS.default).toBe("Default");
  expect(SHELL_LABELS.cmd).toBe("Command Prompt");
  const written: string[] = [];
  const term = { cols: 80, rows: 24, write: (d: string | Uint8Array) => void written.push(String(d)) };
  mockIPC(() => undefined);
  await relaunchSession("n", term, { ...payload, agent: "shell" }, "new");
  expect(written[0]).toContain("── restart ──");
});
