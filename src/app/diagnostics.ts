import { toastError } from "@/lib/errorToast";
import { messages } from "@/i18n";
import { call } from "@/ipc/invoke";
import type { AgentId } from "@/ipc/pty";
import { appMessages } from "./messages";

/** What dummyPlane sees of this PC for the troubleshooting dialog (spec première version §7.3); paths with the home folder as `~`. */
export interface Diagnostics {
  version: string;
  os: string;
  /** Every coding agent of the catalog, with the program found, or null. */
  agents: { id: AgentId; path: string | null }[];
  /** `git --version`, or null without Git. */
  git: string | null;
  gitBash: string | null;
  /** dummyPlane's local server (agents' states and tools) runs. */
  server: boolean;
  dataDir: string;
  logDir: string;
}

const REPO = "https://github.com/Mideky-hub/openvibe";

export const loadDiagnostics = () => call<Diagnostics>("diagnostics");

/** "Open the data folder" of the troubleshooting dialog. */
export async function openDataDir() {
  try {
    await call<void>("open_data_dir");
  } catch (error) {
    toastError(messages(appMessages).dataFailed, { error });
  }
}

/** A new GitHub issue from the bug template, the version filled in. */
export const issueUrl = (version: string) => `${REPO}/issues/new?template=bug_report.yml&version=${encodeURIComponent(version)}`;

export const guideUrl = () => `${REPO}/blob/main/docs/troubleshooting.md`;

/** A Windows user folder: what Rust may not have shortened still never leaves the PC. */
const USER_FOLDER = /[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/gi;

/**
 * "Copy the diagnostic": English keys, for any maintainer to read; no token,
 * no project path, the home folder as `~`.
 */
export function diagnosticText(d: Diagnostics): string {
  const lines = [
    `dummyPlane ${d.version}`,
    `OS: ${d.os}`,
    "Agents:",
    ...d.agents.map((a) => `  ${a.id}: ${a.path ?? "not found"}`),
    `Git: ${d.git ?? "not found"}`,
    `Git Bash: ${d.gitBash ?? "not found"}`,
    `Local server: ${d.server ? "running" : "not running"}`,
    `Data: ${d.dataDir}`,
    `Logs: ${d.logDir}`,
  ];
  return lines.join("\n").replace(USER_FOLDER, "~");
}
