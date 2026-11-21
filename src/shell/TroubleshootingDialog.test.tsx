// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { openUrl } from "@tauri-apps/plugin-opener";
import { diagnosticText, type Diagnostics } from "@/app/diagnostics";
import { showTroubleshooting, troubleshootStore } from "./troubleshoot";
import { TroubleshootingDialog } from "./TroubleshootingDialog";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const found: Diagnostics = {
  version: "1.0.0-beta.1",
  os: "Windows 11 (build 26300)",
  agents: [
    { id: "claude", path: "~\\.local\\bin\\claude.exe" },
    { id: "codex", path: null },
  ],
  git: null,
  gitBash: null,
  server: true,
  dataDir: "~\\AppData\\Roaming\\dev.dummyplane.app",
  logDir: "~\\AppData\\Local\\dev.dummyplane.app\\logs",
};

let calls: string[];
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  calls = [];
  vi.mocked(openUrl).mockClear();
  troubleshootStore.setState({ open: false, diagnostics: null, error: null });
  mockIPC((cmd) => {
    calls.push(cmd);
    if (cmd === "diagnostics") return found;
    if (cmd === "refresh_path" || cmd === "open_data_dir" || cmd === "open_log_dir") return null;
    if (cmd === "list_agents" || cmd === "list_shells") return [];
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
});

const open = async () => {
  await act(async () => root.render(<TroubleshootingDialog />));
  await act(async () => showTroubleshooting());
};
const dialog = () => document.querySelector<HTMLElement>("[role='dialog']")!;
const button = (text: string) => [...dialog().querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;

it("shows at once, its scrim too, when the palette opened it, and fades in for a click", async () => {
  const instant = () => ["dialog-overlay", "dialog-content"].map((slot) => document.querySelector(`[data-slot='${slot}']`)?.hasAttribute("data-instant"));
  await act(async () => root.render(<TroubleshootingDialog />));
  await act(async () => showTroubleshooting({ instant: true }));
  expect(instant()).toEqual([true, true]);
  await act(async () => troubleshootStore.setState({ open: false }));
  await act(async () => showTroubleshooting());
  expect(instant()).toEqual([false, false]);
});

it("shows the version, the agents found and where, Git and the local server", async () => {
  await open();
  const text = dialog().textContent!;
  expect(text).toContain("Troubleshooting");
  expect(text).toContain("1.0.0-beta.1");
  expect(text).toContain("~\\.local\\bin\\claude.exe");
  expect(dialog().querySelector("[data-agent='codex']")!.textContent).toContain("not found");
  // Without Git Bash, the usage meter stays empty: the dialog says why.
  expect(dialog().querySelector("[data-check='gitBash']")!.textContent).toContain("usage meter");
  expect(dialog().querySelector("[data-check='server']")!.textContent).toContain("running");
});

it("copies the diagnostic, opens the folders, the guide and a new issue with the version", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  await open();
  await act(async () => button("Copy the diagnostics").click());
  expect(writeText).toHaveBeenCalledWith(diagnosticText(found));
  await act(async () => button("Open the data folder").click());
  await act(async () => button("Open the logs folder").click());
  expect(calls).toContain("open_data_dir");
  expect(calls).toContain("open_log_dir");
  await act(async () => button("Troubleshooting guide").click());
  await act(async () => button("Report a problem").click());
  expect(vi.mocked(openUrl).mock.calls.map(([url]) => url)).toEqual([
    "https://github.com/MullaAhmed/dummyPlane/blob/main/docs/troubleshooting.md",
    "https://github.com/MullaAhmed/dummyPlane/issues/new?template=bug_report.yml&version=1.0.0-beta.1",
  ]);
});

it("reads Windows' PATH again before checking again", async () => {
  await open();
  calls = [];
  await act(async () => button("Check again").click());
  expect(calls.indexOf("refresh_path")).toBeGreaterThanOrEqual(0);
  expect(calls.indexOf("refresh_path")).toBeLessThan(calls.lastIndexOf("diagnostics"));
});

it("says what failed when the diagnostics cannot run: a title, a next step, then the error's own line (Alerts)", async () => {
  mockIPC((cmd) => {
    if (cmd === "diagnostics") return Promise.reject("probe crashed");
    if (cmd === "refresh_path") return null;
    if (cmd === "list_agents" || cmd === "list_shells") return [];
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await open();
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  const problem = dialog().querySelector("[role='alert']")!;
  expect(problem.textContent).toContain("Could not run the diagnostics");
  expect(problem.textContent).toContain("Check again, or report the problem if it keeps failing");
  expect(problem.textContent).toContain("probe crashed");
  // The error stays out of the title, and goes whole to the log.
  expect(problem.querySelector("p")!.textContent).toBe("Could not run the diagnostics");
  expect(warn).toHaveBeenCalledWith("Could not run the diagnostics:", expect.anything());
  warn.mockRestore();
});

it("heads with the version and what the app is, About dummyPlane's content, even when the diagnostics fail", async () => {
  mockIPC((cmd) => {
    if (cmd === "diagnostics") return Promise.reject("probe crashed");
    if (cmd === "plugin:app|version") return "0.3.0";
    if (cmd === "refresh_path") return null;
    if (cmd === "list_agents" || cmd === "list_shells") return [];
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await open();
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  const about = dialog().querySelector("[data-about]")!;
  expect(about.textContent).toContain("dummyPlane 0.3.0");
  expect(about.textContent).toContain("A local, open source canvas for agents");
  expect(dialog().querySelector("[role='alert']")).not.toBeNull();
  warn.mockRestore();
});

it("gives the keyboard back on Escape to what had it when a command opened it: no trigger of its own, never the page", async () => {
  const terminal = document.createElement("textarea");
  document.body.append(terminal);
  terminal.focus();
  await open();
  expect(dialog().contains(document.activeElement)).toBe(true);
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(document.querySelector("[role='dialog']")).toBeNull();
  expect(document.activeElement).toBe(terminal);
  terminal.remove();
});
