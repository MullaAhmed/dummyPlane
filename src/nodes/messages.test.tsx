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
import { ToolsUnavailable } from "./orchestrator/ToolsUnavailable";

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

const payload = { title: "Isis", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "", claudeSessionId: "s" } as const;

it("labels the status pill in English", () => {
  expect(pillOf({ state: "running" })).toEqual({ label: "ACTIVE", tone: "live" });
  expect(pillOf({ state: "running" }, "working")).toEqual({ label: "WORKING", tone: "working" });
  expect(pillOf({ state: "stopped" })).toEqual({ label: "STOPPED", tone: "stopped" });
  expect(pillOf({ state: "exited", code: 2 })).toEqual({ label: "EXITED · 2", tone: "failed" });
});

it("tells in English how long the agent has been in its state", async () => {
  const { host, root } = await mount(<StatusPill status={{ state: "running" }} activity={{ activity: "idle", since: Date.now() - 45_000 }} />);
  expect(host.textContent).toBe("READY");
  expect(host.querySelector("span")!.title).toMatch(/^READY for \d+ s$/);
  await act(async () => root.unmount());
});

it("shows the header's menus and tooltips in English", async () => {
  const { host, root } = await mount(<TerminalHeader nodeId="isis" payload={payload} status={{ state: "stopped" }} />);
  expect(host.querySelector('[aria-label="Restart"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Review changes"]')).not.toBeNull();
  expect(host.querySelector("header span[title]")!.getAttribute("title")).toBe("Double-click to rename");
  await act(async () => root.unmount());
});

it("offers to resume or restart in English", async () => {
  const resume = await mount(<ResumeCard nodeId="isis" payload={payload} status={{ state: "stopped" }} />);
  expect(resume.host.textContent).toContain("Resume the last conversation?");
  expect(resume.host.textContent).toContain("Click to resume · typing starts fresh");
  expect(resume.host.querySelector('[aria-label="Hide"]')).not.toBeNull();
  await act(async () => resume.root.unmount());
  const plain = await mount(<ResumeCard nodeId="isis" payload={{ ...payload, agent: "shell" }} status={{ state: "stopped" }} />);
  expect(plain.host.textContent).toContain("Restart?");
  await act(async () => plain.root.unmount());
});

it("shows the options dialog in English", async () => {
  mockIPC(() => undefined);
  await mount(<TerminalOptionsDialog nodeId="isis" payload={payload} onClose={() => {}} />);
  const text = document.body.textContent!;
  expect(text).toContain("Options for Isis");
  expect(text).toContain("Cancel");
  expect(text).toContain("Apply at next launch");
});

it("says in English why the orchestrator did not start", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("o", { workspaceId: "w", kind: "orchestrator", payload: { name: "Orchestrator" } });
  const { host, root } = await mount(<ToolsUnavailable nodeId="o" message="x" />);
  const text = host.textContent!;
  expect(text).toContain("OpenVibe tools unavailable");
  expect(text).toContain("the orchestrator could change your branch");
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
