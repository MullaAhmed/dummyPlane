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

it("shows the version, the agents found and where, Git and the local server (spec première version §7.3)", async () => {
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
    "https://github.com/Mideky-hub/openvibe/blob/main/docs/troubleshooting.md",
    "https://github.com/Mideky-hub/openvibe/issues/new?template=bug_report.yml&version=1.0.0-beta.1",
  ]);
});

it("reads Windows' PATH again before checking again", async () => {
  await open();
  calls = [];
  await act(async () => button("Check again").click());
  expect(calls.indexOf("refresh_path")).toBeGreaterThanOrEqual(0);
  expect(calls.indexOf("refresh_path")).toBeLessThan(calls.lastIndexOf("diagnostics"));
});
