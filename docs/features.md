# dummyPlane features

The full tour of what dummyPlane does. For the short version, see the [README](../README.md); for missions and the overnight run, see [The Fleet](fleet.md).

## Features

- **Real terminals on a canvas.** Every agent is a real PTY (ConPTY on Windows) drawn with xterm.js. You can pan, zoom, draw around the agents and annotate their work. The canvas is [Excalidraw](https://github.com/excalidraw/excalidraw), so shapes, arrows, text and images all work.
- **Teams.** Compose a group with a role (Frontend, Backend, Testers, Reviewers…). Each group takes its names from a pantheon (DC, Marvel, Throne of Glass, Star Wars or Lord of the Rings): Batman, Thor, Aelin…, picked when you compose the group or later from its menu.
  - Give a group a **speciality** (one line, from its menu): a linked fleet reads it to hand each sub-task to the right group.
  - **Fold** a group onto its label with the chevron: its terminals leave the screen, nothing stops, and the label keeps its counters. Going to one of its agents unfolds it; a group can't be folded while its agents are still starting.
  - Save the team on screen as a **preset** (*Save the team as a preset…* in the function palette) and deploy it in any project with *Deploy team: <preset name>*. A preset keeps the shape only: groups, roles, specialities, agents and links, never instructions or history.
  - **Ungroup** from the selection ring, with `Ctrl+Shift+G` or the palette. *Remove from group* takes a single terminal or Fleet out of its group and leaves it where it is; a group left empty goes away.
  - **Link** two agents from an agent's foot: a wire joins them, and each can message the other.
- **Live states.** dummyPlane shows whether each agent is starting, ready, running, waiting for you, stopped or done, both on the canvas and in the Agents panel. For Claude Code the state comes from its hooks; for other agents, from their output. A minimised terminal stays on the canvas as a card that shows its state.
- **Back at the shell.** When Claude Code exits, its terminal stays open at the shell, reads *Agent exited* and offers to resume the conversation. Typing `claude` there yourself (`claude --resume`, `claude -c`…) starts it again as that terminal's agent, with its hooks, tools, role and limits, in PowerShell, pwsh, cmd and Git Bash.
- **One instruction box for everyone.** Address `@all` (everyone), a group, an agent, or several at once (`@batman/superman`). A line starting with `/` goes to the agents' CLI as a command, and dummyPlane suggests Claude Code's commands. The history keeps your last 50 instructions per project. An image pasted into the box shows as a thumbnail chip.
- **Agents talk to each other.** When one agent messages another, a dashed talk wire forms between them if none joins them, and it lights up with every message. Agents can also be linked by hand (see **Teams**).
- **Sub-agents with the skills, servers and plugins their task needs.** An agent that opens a sub-agent with `spawn_agent` can choose what it gets: `skills`, `mcp_servers` and `plugins` name items among what the sub-agent's CLI (Claude Code or Codex) loads in that folder, which the agent reads with `installed_extras`. A kind left out keeps the CLI's defaults; an empty list gives none of that kind. A plugin brings its own skills and MCP servers, and dummyPlane's own server is always kept. dummyPlane checks every name before the terminal opens and again at each launch, so a restart or a resume starts the sub-agent with the same pick, and a sub-agent whose pick cannot be applied does not start. The pick shows under *Next launch* in the sub-agent's Edit panel, and its own sub-agents inherit it kind by kind unless they choose again. Limits: an MCP server your settings leave off is never picked (only you turn it on); Claude Code's bundled skills are part of the CLI and stay, and a Claude sub-agent whose MCP servers were picked gets no claude.ai connector; on Codex, a plugin's or an app's MCP server follows its plugin, and a skill your Codex config turns off is not offered.
- **Output nodes.** An agent can show a result (a report, a table, a chart) in an output node beside its terminal, with the `show_output` tool. A call without `output` updates the agent's latest output in place (a new one only when it has none on the canvas), `output: <id>` updates that one, and `new: true` shows another one beside it, so an agent that lost an output's id does not pile up new nodes. A `dummyplane://` link pasted into an agent's terminal is read with `read_node`, so the agent can open a terminal, a Fleet, a sub-agent, an output or a file from it.
- **A fleet that plans, a Manager that runs it.** Give the fleet a goal. It proposes a plan; at your go-ahead, a Kanban board and a Manager appear beside it. The Manager gives each agent a sub-task on its own git branch and worktree, watches the time budget and merges the results into a mission branch, while the fleet stays free to talk with you. Details are in [The Fleet](fleet.md).
- **Change review.** See what an agent changed, either uncommitted or since its base, browse the repository read-only, and click a line to leave a remark. All remarks go back to the agent in one message.
- **Hear about questions.** When an agent waits for you, a notice stays at the bottom left of the window until it stops waiting, and a Windows notification appears if the window is not in focus (switch it off in the settings menu). A notification also tells you when an agent finishes (*Alert when an agent finishes*, in the settings menu). A click takes you to the agent, and a palette command goes to the next one that waits. dummyPlane also takes you there by itself, one agent at a time and oldest first, never while you are typing (or for 10 s after the last key while a field holds a draft you have not sent), or in the middle of a dialog or a menu, and not while you answer another agent (switch it off in the settings menu: *Go to agents that ask*).
- **A history of every popup.** The bell on the right rail keeps what the app told you, newest first: its kind, its text, when, and the project and workspace it was about. A click goes to that workspace, centres on the agent or node concerned and marks it read. Filter by *All*, *This workspace* or *Errors*; *Mark all read* and *Clear* tidy it. The last 200 survive a restart.
- **Remote Control.** Turn on Claude Code's Remote Control for one agent, a group or the whole team, and follow them from your phone.
- **Usage at a glance.** The title bar shows your Claude subscription's session and weekly limits. Click it for cost, durations, tokens per model, prompt cache state and an estimate of CO₂.
- **Tokens over 30 days.** From the usage detail, a chart of the tokens you used each day, and their share by agent and by model. dummyPlane reads the logs Claude Code already keeps on your disk, counters only, never the conversations; nothing is sent anywhere. Codex is not read yet.
- **Code Studio.** Fix a file by hand without leaving dummyPlane. Each project has a code workspace, an IDE tab beside its canvases, opened from the right rail or the function palette: the repository's tree, files in tabs with syntax colours in every palette, `Ctrl+S`, a Markdown preview, and *Insert* to put the file on a canvas. `Ctrl+P` finds a file, `App.tsx:42` included, and `Ctrl+G` goes to a line. If an agent wrote the file meanwhile, the save is refused and you choose: reload, or overwrite what you saw.
- **Notes.** Notes are Markdown files in `.dummyplane/notes/` of the project, so an agent can read them without dummyPlane. They open in a tab next to the workspace tabs. Link them with `[[name]]`, search them, see their backlinks and their graph, and attach notes to a group. A read-only tool lets agents list and read them.
- **Quick notes.** *Note* on a terminal's or a Fleet's right-click ring (or in its ⋯ menu, or the palette) opens a note right beside it, ready to type in. It follows its terminal when that is moved, minimised or arranged, and is saved with the canvas.
- **Pasting.** `Ctrl+V` in a terminal saves a clipboard image and types its path.
- **Install an agent from the app.** For an agent that is not found, *Install* shows the official command in full, then runs it in a visible terminal on the canvas that you can interrupt. Ollama models install the same way. Nothing is fetched or run in the background.
- **Loops.** Send an instruction again and again, with brakes. A loop fires every N minutes, when an agent goes idle, or when its screen shows a text; it must end after a number of turns (up to 1000) or a duration (up to 24 hours), whichever comes first. It never writes to an agent that waits for you, is stopped or is starting. A pill at the bottom left counts the running loops and their turns, with *Stop all* one click away, and every loop is off again after a restart. Three templates (progress report, relaunch, watch the tests) fill the form but start nothing.
- **Several Claude accounts.** A profile is only a name and a folder (Claude Code's `CLAUDE_CONFIG_DIR`). *Claude accounts…* in the function palette lists them: *Use* makes one the account of the next Claude agents, *Log in* opens a visible terminal to sign in, *Remove* forgets a profile and leaves its folder alone. A terminal keeps the account it started with, and shows it in its header. dummyPlane never reads, copies or stores a credential.
- **A git window.** Click the branch chip at the bottom left: the files changed in the project, their diff, a tick per file to commit exactly those, the history, a *Switch branch* menu on the branch's name in its header (existing local branches only; git refuses a switch that would overwrite your changes), and a *Push* button that names its target (`Push 3 → origin/main`). Discarding a file asks first and says what is lost; this button is the only route to a push inside dummyPlane's own tools: it goes only when you click, and it never forces. An agent running commands in a terminal is limited only by its permissions.
- **Overnight run.** Say how long you will be away: the fleet plans, a team works through a queue of tickets, and a morning report waits for you. See [Overnight run](fleet.md#overnight-run), and read its warnings first.
- **Projects and workspaces.** One project per folder, several workspace tabs per project; drag the tabs to reorder them (or `Alt+←` / `Alt+→` on a tab, or its menu), and the order is remembered. dummyPlane saves everything locally and, after a restart, offers to resume your Claude conversations.
- **Keyboard first.** Use the palettes, jump between terminals, or right-press anywhere for the radial menu. Every ring ends with *More*, which opens a second arc, and every ring has *Arrange*. The terminals take the palette's colours.

## A tour

**Brief the whole team.** Type `@frontend` and the question. The three agents of the group work at the same time, then come back *ready*.

**Send a command to every agent.** After the targets, `/` lists Claude Code's commands; `/context` then runs in each session of the group.

**Review a change and send it back.** Jump to an agent with `Ctrl+P`, open *Review changes* from `Ctrl+Shift+P`, then click a line to leave a remark. *Send to Batman* sends every remark in one message.

**Check your usage.** The meter in the title bar opens the detail: subscription limits and when they reset, cost and durations of dummyPlane's sessions, tokens per model, and each session's prompt cache.

## Supported agents

dummyPlane launches the agents you already have installed: an agent counts as available when its command is on your `PATH`.

| Agent | Command | State detection |
|---|---|---|
| Claude Code | `claude` | Hooks (precise: running, waiting for you, done) |
| Codex | `codex` | Output, plus its `notify` hook at the end of each turn; it gets dummyPlane's tools through a profile in `$CODEX_HOME`, removed when its terminal closes |
| Gemini CLI | `gemini` | Output |
| Qwen Code | `qwen` | Output |
| Cursor | `cursor-agent` | Output |
| OpenCode | `opencode` | Output |
| Aider | `aider` | Output |
| Ollama | `ollama run <model>` (or Aider on an Ollama model) | Output |
| Shell | PowerShell, cmd, pwsh or Git Bash | Output |
| Custom | any command you type | Output |

Remote Control, missions, the model router, the step timeline and the usage meter rely on Claude Code; the canvas, groups, mentions and review work with every agent.

## Keyboard

| Shortcut | Action |
|---|---|
| `Ctrl+P` | Go to a terminal, group, fleet, workspace or project |
| `Ctrl+Shift+P` | Function palette (every command of the app) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous terminal, in reading order |
| `Shift+Esc` | Give the keyboard back to the canvas |
| `Ctrl+Shift+A` | Overview |
| Right-press | Radial menu: click an item, or hold, drag and release |
| `@` · `/` · `↑` | In the instruction box: target · command · history |
| `Shift+Enter` | New line, in the instruction box and in terminals |
| `Ctrl+Shift+G` | Ungroup the selection on the canvas (never from inside a terminal or a field) |
| `Ctrl+V` | In a terminal: paste; a clipboard image is saved and its path pasted |
| `Alt+←` / `Alt+→` | Move the focused workspace tab left or right |
| `Ctrl+S` · `Ctrl+G` · `Ctrl+P` | In Code Studio: save the file · go to a line · find a file |

Excalidraw's own keys (`V`, `H`, `R`, `O`, `A`, `T`, `P`, `E`, `Ctrl+Z`…) work whenever the canvas has the keyboard. In a terminal, `Ctrl+C` copies when text is selected and interrupts otherwise.

## Single instance

dummyPlane runs once: launching it a second time brings the open window back (and restores it if it was minimized) instead of starting another copy, which would fight the first over the database and the log.

## How it works

- **Desktop shell:** [Tauri 2](https://v2.tauri.app/). The Rust side owns the PTYs ([portable-pty](https://crates.io/crates/portable-pty)), git, the SQLite database and a small HTTP server.
- **Interface:** React 19, TypeScript, Zustand and Tailwind CSS 4, with [Excalidraw](https://github.com/excalidraw/excalidraw) for the canvas and [xterm.js](https://xtermjs.org/) for the terminals.
- **Agent states and tools:** the HTTP server listens on `127.0.0.1` only, on a random port.
  - Each Claude Code session gets an extra `--settings` file. It declares hooks that report the session's state, a status line that reports usage, and an MCP server for the mission tools.
  - Every request needs a token drawn when the app starts, or a token for the session itself.
  - dummyPlane reads your own `~/.claude/settings.json` but never modifies it, and your own status line keeps showing in the terminals.
- **Storage:** projects, canvases, terminal scrollback and settings live in a local SQLite database under `%APPDATA%\dev.dummyplane.app\`. Notes are plain files in the project's `.dummyplane/notes/`; team presets are a setting of the database.
- **Token counts:** read-only and bounded. dummyPlane scans the `.jsonl` logs under Claude Code's folder (`~/.claude/projects`, or `$CLAUDE_CONFIG_DIR`) for the last 30 days, keeps dates, models and counters, and drops the rest unread.

See [SECURITY.md](../SECURITY.md) for the security model in more detail.
