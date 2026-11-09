# Security policy

dummyPlane launches AI coding agents in real terminals on your machine, so its security matters to everyone who uses it. Thank you for helping keep it safe.

## Supported versions

dummyPlane is in beta. Only the latest release and the `main` branch receive security fixes; installed versions update themselves.

| Version | Supported |
|---|---|
| Latest release (1.0.0 betas) and `main` | Yes |
| Anything older | No |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub instead: open the repository's **Security** tab and choose **Report a vulnerability**. GitHub's guide is [Privately reporting a security vulnerability](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability).

Please include:

- the version or commit you tested;
- what an attacker can do, and what they need first (a local account, a malicious repository, a crafted agent output…);
- the steps to reproduce, ideally with a minimal example.

dummyPlane is maintained by one person in their spare time, so these are goals rather than guarantees:

- an acknowledgement within 7 days;
- an assessment within 14 days;
- a fix or a mitigation as soon as possible for serious issues.

We will credit you in the advisory unless you prefer to stay anonymous.

## Security model

dummyPlane is a local desktop app. It is designed around these rules:

- **Your agents keep their own guardrails.** dummyPlane never adds permission-bypass flags such as `--dangerously-skip-permissions`. Your agents run with your user account and ask for permission the way you configured them. The only prompt dummyPlane ever answers for you is Claude Code's folder-trust question, and only in the mission worktrees it created itself.
- **The local server only accepts requests from your machine.**
  - The server that receives agent hooks, status lines and MCP calls listens on `127.0.0.1` only, on a port the OS picks at random.
  - Hook and status routes need a token drawn each time the app starts. The status line and Codex hand it to `curl` through a configuration file in dummyPlane's app data folder, so it never appears on a command line.
  - The MCP route needs a separate bearer token for each session, revoked when that session ends.
  - Request bodies are capped (64 KiB for hooks, 256 KiB for MCP), and node ids are checked against a strict pattern.
- **Your Claude settings are only read.** dummyPlane reads your `~/.claude/settings.json` and the project's `.claude/settings*.json` to keep your own status line. It never writes to them.
  - Its own per-session files (the `--settings` file, the MCP configuration and the role prompt) are written to its app data folder, deleted when the session ends, and cleared at startup.
- **The orchestrator cannot change your files.** Its Claude session is denied `Edit`, `Write`, `NotebookEdit` and `Bash`, and only gets dummyPlane's own MCP tools. If its settings, tools or role cannot be given to it, it does not start, and its node says why.
- **The interface runs under a strict Content Security Policy.** Only the app's own scripts, styles, fonts and images load. No remote content, frame or plugin.
- **Git stays local.** Missions create branches and worktrees next to your repository. dummyPlane never pushes, and never merges into your own branch.
- **No telemetry.** The app's only request of its own is the update check: it reads the latest release's `latest.json` on GitHub, 10 seconds after the start and every 6 hours, and the settings menu turns it off. Fonts and icon libraries are bundled. Links you click, such as a Remote Control link, open in your browser.
- **Updates are signed.** Each installer is signed with dummyPlane's update key, and the app refuses an update whose signature does not match the public key it ships with.
- **Inputs to launch commands are checked.** Session ids must be UUIDs, model and Ollama names must match a strict pattern, and terminal titles are stripped of quotes and control characters. A *Custom* agent's command is typed exactly as you wrote it: that is its purpose.

## Known limitations

These are known and tracked. Reports that show a practical way to exploit them are still welcome.

- **Terminal history is stored unencrypted.** Each terminal keeps up to 512 KiB of its output in the local SQLite database (`%APPDATA%\dev.dummyplane.app\dummyplane.db`). Anything an agent printed, secrets included, can end up there.
- **Tokens are readable by your own account.** The hook token sits in dummyPlane's own files in its app data folder (Claude's per-session settings, `curl.cfg`). Another program running under your account could read it and send fake states or usage to dummyPlane.
- **Agents run with your permissions.** dummyPlane does not sandbox them. Review what you let an agent do, especially in auto-accept modes, and prefer missions, which isolate each agent in its own worktree.

## Out of scope

- Vulnerabilities in the agent CLIs themselves (Claude Code, Codex, Gemini CLI…). Please report those to their vendors.
- Attacks that require an administrator account or malware already running as your user, except where dummyPlane makes them meaningfully easier.
- Problems that only exist in a modified build of dummyPlane.
