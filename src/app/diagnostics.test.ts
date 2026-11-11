import { expect, it } from "vitest";
import { diagnosticText, guideUrl, issueUrl, type Diagnostics } from "./diagnostics";

const sample: Diagnostics = {
  version: "1.0.0-beta.1",
  os: "Windows 11 (build 26300)",
  agents: [
    { id: "claude", path: "~\\.local\\bin\\claude.exe" },
    { id: "codex", path: null },
  ],
  git: null,
  gitBash: "C:\\Users\\Mathieu\\scoop\\apps\\git\\bin\\bash.exe",
  server: true,
  dataDir: "~\\AppData\\Roaming\\dev.dummyplane.app",
  logDir: "~\\AppData\\Local\\dev.dummyplane.app\\logs",
};

it("writes what a bug report needs, the home folder as ~ even when Rust missed it", () => {
  expect(diagnosticText(sample)).toBe(
    [
      "dummyPlane 1.0.0-beta.1",
      "OS: Windows 11 (build 26300)",
      "Agents:",
      "  claude: ~\\.local\\bin\\claude.exe",
      "  codex: not found",
      "Git: not found",
      "Git Bash: ~\\scoop\\apps\\git\\bin\\bash.exe",
      "Local server: running",
      "Data: ~\\AppData\\Roaming\\dev.dummyplane.app",
      "Logs: ~\\AppData\\Local\\dev.dummyplane.app\\logs",
    ].join("\n"),
  );
  expect(diagnosticText(sample)).not.toMatch(/Mathieu|Users/i);
});

it("prefills the version in a new issue, and links the English guide", () => {
  expect(issueUrl("1.0.0-beta.1")).toBe("https://github.com/MullaAhmed/dummyPlane/issues/new?template=bug_report.yml&version=1.0.0-beta.1");
  expect(guideUrl()).toBe("https://github.com/MullaAhmed/dummyPlane/blob/main/docs/troubleshooting.md");
});
