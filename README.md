<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/brand/banner-light.png">
    <img alt="dummyPlane: an infinite canvas of real terminals for your AI coding agents" src="docs/assets/brand/banner-dark.png" width="100%">
  </picture>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-173F32?style=flat-square"></a>
  <img alt="Platform: Windows 10/11" src="https://img.shields.io/badge/platform-Windows%2010%2F11-101014?style=flat-square">
  <img alt="Built with Tauri 2" src="https://img.shields.io/badge/Tauri-2-7CC492?style=flat-square">
  <img alt="Status: early preview" src="https://img.shields.io/badge/status-early%20preview-DDAA62?style=flat-square">
</p>

dummyPlane is a desktop app that puts your AI coding agents on an infinite canvas. Each agent runs in a **real terminal** (Claude Code, Codex, Gemini CLI and more). You group agents into teams, brief a whole team in one line, review their changes, and hand a large task to the **fleet**, which plans it with you and has a Manager run the team while you keep talking.

Everything runs on your machine. dummyPlane adds no cloud service and no telemetry, and it never skips an agent's permission prompts. Its only request of its own is a check for updates, which you can turn off.

If you know Symvibe, dummyPlane covers the same ground (driving a fleet of CLI agents from an infinite canvas) as an open-source project with its own design and features.

> [!NOTE]
> dummyPlane is an early preview, built and tested on **Windows 10/11**. Its interface is in **English**; it comes in three palettes, chosen under Theme in the settings menu.

## Highlights

- **Real terminals on a canvas.** Every agent is a real PTY on an [Excalidraw](https://github.com/excalidraw/excalidraw) canvas: pan, zoom, draw around the agents and annotate their work.
- **Teams.** Compose groups with a role and a speciality, link agents, fold a group away, save a team as a preset and deploy it in any project.
- **One instruction box.** Address `@all`, a group, an agent or several at once; a line starting with `/` goes to the agents' CLI as a command.
- **Live states.** See whether each agent is starting, ready, running, waiting for you, stopped or done, and get a notice when one waits for you.
- **A fleet that plans, a Manager that runs it.** Missions run on a git branch and worktree per agent, merge into a mission branch, and never push. An **overnight run** works through a queue of tickets while you are away: [read how it works, and its warnings first](docs/fleet.md).
- **Review and ship.** Review an agent's changes and send your remarks back in one message, commit and push from the git window, fix a file in Code Studio, keep Markdown notes.
- **Know your usage.** Session and weekly limits in the title bar, and tokens per day, model and agent.
- **And more:** loops with brakes, several Claude accounts, Remote Control from your phone, one-click agent installs.

The rest of the features, the keyboard shortcuts and how it works are in [docs/features.md](docs/features.md).

## Works with

Claude Code, Codex, Gemini CLI, Qwen Code, Cursor, OpenCode, Aider, Ollama, any shell, or any custom command: an agent counts as available when its command is on your `PATH`. Remote Control, missions, the model router, the step timeline and the usage meter rely on Claude Code; the canvas, groups, mentions and review work with every agent. See the [table of agents](docs/features.md#supported-agents).

## Install

Download `dummyPlane_<version>_x64-setup.exe` from the [latest release](https://github.com/MullaAhmed/dummyPlane/releases/latest) and run it. It installs for your user only and needs no administrator rights. You also need at least one agent CLI, for example [Claude Code](https://docs.claude.com/en/docs/claude-code/overview), and [Git](https://git-scm.com/): Git Bash provides the `bash` that the usage meter needs.

> [!IMPORTANT]
> Betas are not code-signed yet. If Windows SmartScreen stops the installer, choose **More info**, then **Run anyway**.

On first launch, the home screen walks you through installing an agent, adding a project and launching an agent. Something wrong? See the [troubleshooting guide](docs/troubleshooting.md), or open **Troubleshooting** from the settings menu.

**Updates.** dummyPlane looks for a new release on GitHub 10 seconds after it starts, then every 6 hours, and offers to install it. Your canvas and the terminals' history are saved first, and an update whose signature does not match is refused. This check is the only request dummyPlane makes on its own: to turn it off, untick **Check automatically** in the settings menu (the gear).

## Build from source

You need [Tauri 2's Windows prerequisites](https://v2.tauri.app/start/prerequisites/) (the Microsoft C++ Build Tools and WebView2, already present on Windows 11), [Rust](https://rustup.rs/) 1.85 or newer, [Node.js](https://nodejs.org/) 22 LTS, [pnpm](https://pnpm.io/) 10, [Git](https://git-scm.com/) and at least one agent CLI.

```powershell
git clone https://github.com/MullaAhmed/dummyPlane.git
cd dummyPlane
pnpm install
pnpm tauri dev                  # run in development
pnpm tauri build                # build the installer, in src-tauri/target/release/bundle/nsis/
```

> [!TIP]
> To try dummyPlane without touching your saved projects, give the development build its own data folder:
> `pnpm tauri dev --config '{"identifier":"dev.dummyplane.probe"}'`

## Docs

- [Features, keyboard shortcuts and how it works](docs/features.md)
- [The Fleet and the overnight run](docs/fleet.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Security model](SECURITY.md)

## Contributing

Bug reports, ideas and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License and credits

dummyPlane is released under the [MIT License](LICENSE). It started as a fork of [OpenVibe](https://github.com/Mideky-hub/openvibe) (MIT, © Mathieu Kerbel), which this project continues at [MullaAhmed/dummyPlane](https://github.com/MullaAhmed/dummyPlane).

Much of what is described here started in OpenVibe. The vision is different: dummyPlane is heading toward working hand in hand with [dummyIndex](https://github.com/MullaAhmed/dummyIndex), the persistent context engine that turns a codebase into a `.context/` folder agents navigate instead of grepping, so that every agent on the canvas can start from the same map of the project.

It builds on [Tauri](https://tauri.app/), [Excalidraw](https://github.com/excalidraw/excalidraw), [xterm.js](https://xtermjs.org/), [portable-pty](https://github.com/wezterm/wezterm/tree/main/pty), [cmdk](https://cmdk.paco.me/) and [OpenUI](https://www.openui.com/). It is not affiliated with Symvibe, Anthropic, OpenAI, Google or the makers of the other agents it launches; their names belong to their owners.
