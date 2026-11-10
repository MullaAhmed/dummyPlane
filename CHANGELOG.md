# Changelog

All notable changes to dummyPlane are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **A folder per workspace:** each canvas workspace can work in its own folder (the workspace tab's menu: *Folder…*, *Use the project folder*, or the launch folder at the top of the agent menu). Terminals, Fleet sessions, installs, sign-in, the git chip and the missions' repository (its worktrees too) all follow it; a workspace without a folder keeps following its project. Terminals already open keep their own folder, *Change folder* on the project moves a workspace's own folder along when it lay inside the old one, and a mission agent's folder is shown read-only in its options, with the reason. Code Studio and notes stay per project.
- **An *Edit* tab for the Fleet,** like the terminals' one, and a terminal's folder, shell and title can be edited from its panel.
- **Taken to the agent that asks:** when an agent starts waiting for you, dummyPlane brings you to its terminal and gives it the keyboard, one agent at a time, oldest first. It never moves while you write (it waits for a 3 s pause after your last key, and up to 10 s while the field you are in holds a draft you have not sent; a field that merely has the focus does not hold it), while you answer another waiting agent (one that starts asking while you are in its terminal is gone to as well), while a dialog, menu or the palette is open, in reading mode, or while the window is not in focus (it goes when you come back, if the agent still waits). A setting in the settings menu, *Go to agents that ask*, turns it off.
- **Done, Blocked and Failed:** once an agent reports and rests, its status reads *Done*, *Blocked* or *Failed* instead of *Ready* (header, minimized card, agents panel, *Go to* and the `@` list) until it works again. Its steps settle with the report, and its budget bar fills in the report's tone. The agents panel filters are now *All*, *Waiting*, *Working* and *Done*; a saved filter that no longer exists moves to the one that took its place.

### Changed
- **The manager is the Fleet** everywhere you read it: menus, panels, nodes, the palette, the prompts agents are given, the README and the docs. Nothing is lost on the way: saved projects and canvases keep the `orchestrator` kind they were stored with, and recently used commands under their old names are carried over.
- **The database is upgraded once more on first start:** migration 5 gives each workspace an optional folder. dummyPlane keeps a copy of the database first (`dummyplane.v4-backup.db`).
- **One header for terminals and the Fleet:** the same name field, status, buttons and overflow menu (⋯) on both, and the same rules when a node is narrow.
- **Interface consistency:** panels, dialogs, menus and hints follow the design system: the same controls, dialog footers, one hint at a time and one set of motions, with a press that eases on scale.
- **Double-click selects:** a double-click on a terminal or the Fleet selects it with any tool.
- **Agents stacked under a Fleet or in a group are spaced further apart,** to leave room for their step frieze.

### Fixed
- The eraser no longer erases terminals or the Fleet, nor takes them along with a group's frame or with a drawing grouped with either; it still erases the drawings that are grouped with none of them.
- Agents that arrive on their own (a mission's team and queue, `spawn_agent` sub-agents, replacements) no longer scroll the canvas to them or take the keyboard while you work. They start where they are, a quiet *joined · Show* toast tells you (one toast for several arrivals), and a launch you asked for still comes into view.
- The README model-router tables now use the effort IDs accepted by the fleet (`low`, `medium`, `high`, `extreme`), with French labels alongside them in the French README.

## [1.2.0-beta.1] - 2026-11-01

### Added
- **Notes:** per-project Markdown notes (plain files in the project's `.dummyplane/notes/`), a graph of the links between them, notes per group, and a note list agents are told about. Open them from the rail, the palette or a group's menu.
- **Install agents from the interface:** from the home screen or the palette, in a visible terminal, with a prerequisites check first, and Ollama models pulled the same way. Nothing is ever installed without being asked.
- **Question notice:** when an agent waits on a question, dummyPlane previews the question, and raises a Windows notification if you are not looking. A setting turns the notification off. Gemini CLI's hooks are heard too.
- **Specialised groups:** give a group a speciality from its menu; the orchestrator is told each agent's group and speciality and matches sub-tasks to them.
- **Folding groups:** fold a group into its label from the chevron or the palette; going to an agent inside it unfolds it.
- **Tab reordering:** drag project tabs, or use Alt+arrows or the tab menu; the order is saved per project.
- **Team presets:** save a team of groups and orchestrators and deploy it again from the palette, with undo for a deletion.
- **Loops:** a window to run a prompt again on a trigger, with stop conditions, spending guards, a running indicator and *Stop all*.
- **Claude accounts:** several Claude profiles, a login terminal per profile, *Use*, and an account chip on the terminals that use one.
- **Tokens:** a 30-day view of your tokens per day and per agent, read from Claude's local logs (read-only; Claude only, days counted in UTC).
- **A git window**, opened from the branch chip: changed files, diffs, a tick per file to commit exactly those, history, and a *Pousser* button that names its target. Discarding asks first and says what is lost.
- **Overnight run:** checks before a night, a morning report, and a PC kept awake while the mission works.
- **Mission task queue:** follow-ups are queued for the agents instead of being typed into their terminals.
- **Per-mission permissions:** choose what the agents of a mission may do.
- **A discreet exit button** in the zen and reading modes.

### Changed
- **Code Studio:** saving never goes over a file that changed on disk: an agent's change is reloaded by itself when you have none, and otherwise a banner lets you reload or overwrite, and a file deleted meanwhile can be dropped or recreated. Files are written atomically and keep their line endings, the tree leaves out secrets and `.git`, and quitting or updating asks first about unsaved tabs.
- The global time budget is now counted in real time for every mission, and the queue gives no new task once it is spent.
- Missions keep working when their project is not the one on screen.
- Only one dummyPlane runs at a time: a second launch brings the first window back.

### Fixed
- A program on your PC can no longer freeze or crash dummyPlane's local server with a slow, malformed or panicking request; every call is answered once.
- Text sent by agents can no longer smuggle escape sequences or invisible characters into what dummyPlane shows or types, and an agent is told that a task may come from a stranger's text.
- The git window does exactly what you confirmed: a commit, a discard or a push no longer includes anything else, and a push sends only the commits the button counted.
- The `gh` commands that reach the remote are denied to agents like `git push`; the README says plainly that this stops accidents and is not a security boundary.
- A mission's agents no longer keep their permissions when copied, and an agent already in a running mission is not offered to another.
- A list that could not be read (loops, presets, command history) is never overwritten with an empty one; a refused save is reported instead of lost.
- A relaunched terminal keeps its saved output, and an empty capture never replaces it; two starts of the same terminal can no longer race.
- Updates: a check no longer closes the update being installed, and an install never goes over unsaved studio changes.
- Remote Control never types `/remote-control` after a half-written draft; a Loop never types into a shell whose Claude has quit.
- Kanban: a card's text stays data wherever it reaches an orchestrator or an agent. A card from GitHub is never sent to a plain shell, and dropping a card on an agent waiting for an answer no longer confirms its dialog.
- Kanban and missions: a queued task can carry its card, which then moves with it, and an issue follows its card when you are in another project.
- Orchestrator and mission: events wait while you type in the orchestrator, `reassign` and `extend` refuse agents that cannot take them, overrun lines are told again if the app closed before they were heard, and changing a project's folder moves its orchestrators too.
- Groups: a group copied whole gets a pantheon of its own, a folded group never hides a selectable agent, and a new group is fitted at a readable zoom instead of 40 %.
- Review: the toasts no longer cover *Send*, a nested repository is skipped, and a git warning on an empty diff is no error.
- Many small interface fixes: the command palette and `@` commands (names, Escape, double spaces), the saved theme painted before the first render, translated messages, and the keyboard going back to the canvas after menus.

## [1.1.0-beta.1] - 2026-10-28

### Added
- **Code Studio**: each project gets one code workspace, an IDE tab beside its canvases (activity rail or command palette, **Code Studio**). The repository's tree sits in a floating bar you can show, hide, filter and refresh; files open in tabs in an editor with syntax highlighting, **Save (Ctrl+S)**, a warning before closing unsaved changes, and a **Preview** of Markdown files. **Insert** puts the open file on the last canvas shown. Reading and writing are limited to the project's folder (#49).
- In the code workspace, **Ctrl+P** finds files by name, and `file:line` or `file:line:column` (e.g. `App.tsx:42`) opens the file at that line; **Ctrl+G** (**Go to line…**) jumps to `42` or `42:7` in the open file.
- A **file node** on the canvas: a file of the project, shown read-only with a **Refresh** button.
- A **Kanban** widget (tool rail or command palette): columns you add, rename and delete, cards with a title, notes, a priority and a due date (today, tomorrow, next week or a date), overdue cards marked. Cards are dragged between columns, and a card dropped on a terminal is sent to that agent as an instruction. The node widens with its number of columns (#29).
- **Link to GitHub…** in the board's menu syncs a Kanban with a repository's issues, and optionally a Project v2, through the GitHub CLI (`gh`): issues become cards, moving a card closes, reopens or changes the issue's Status, and **Create the issue on GitHub** turns a card into an issue. It needs `gh auth login`, plus `gh auth refresh -s project` for Projects; dummyPlane stores no token (#29).
- **Plan with the orchestrator** in a column's menu sends the column's cards to a new or existing orchestrator. Linked orchestrators read the board with a new MCP tool, `board`, and `propose_plan` takes a `card` field per sub-task: the card moves to **In progress** when the mission starts and to the **Done** column (or the last one) when its agent reports done. The card shows the agent working on it, follows a reassignment, and warns when the agent is blocked or failed.

### Changed
- The database is upgraded twice on first start: migration 3 lets nodes be files, migration 4 gives workspaces a kind (canvas or code). dummyPlane keeps a copy of the database first (`dummyplane.v<N>-backup.db`).
- Closing the code workspace is always allowed; the last canvas still cannot be closed.

### Fixed
- **Launch the mission** and the mission's total budget stay visible at the bottom of the mission panel, however long the plan.

## [1.0.0-beta.1] - 2026-10-27

The first public beta of dummyPlane: a local, open source canvas where AI coding agents work side by side in real terminals.

### Highlights
- Real terminals on an Excalidraw canvas for Claude Code, Codex, Gemini CLI, Qwen Code, Cursor CLI, opencode, Aider, Ollama or any command, each with its live state.
- Groups with roles and names from a pantheon, and one instruction box for everyone, a group or a single agent.
- An orchestrator that proposes a plan, gives each agent a sub-task on its own git branch and worktree, watches the time budgets and merges the results into a mission branch.
- Change review with line remarks sent back to the agent, Remote Control for Claude Code, and your Claude usage in the title bar.
- English and French, a guided first launch, a troubleshooting dialog, and updates that install themselves.

### Added
- The interface in English and French. It follows Windows' language (English unless Windows is in French); the settings menu and the command palette switch it at once.
- A guided first launch: while no project exists or no coding agent is installed, the home screen shows three steps. Without any agent, it gives Claude Code's official install command to copy and the other agents' official pages.
- **Check again** reads Windows' `PATH` from the registry: an agent installed while dummyPlane runs is found without restarting it, and new terminals see it too.
- A **Troubleshooting** dialog (command palette, settings menu, home screen): the agents found and where, Git, Git Bash, the local server, the logs and data folders, diagnostics to copy (no token, the home folder as `~`), the [troubleshooting guide](docs/troubleshooting.md) and a bug report with the version filled in.
- A log file (`%LOCALAPPDATA%\dev.dummyplane.app\logs\dummyplane.log`), opened from the command palette or the settings menu, to attach to a bug report. It never holds a token, a terminal's text or an instruction.
- Before upgrading its database, dummyPlane keeps a copy of it (`dummyplane.v<N>-backup.db`).
- An orchestrator that cannot get dummyPlane's tools does not start, and its node says why.
- A strict content security policy for the interface.

### Changed
- dummyPlane's MCP tools have English names, arguments and values for every agent: `declare_steps`, `step`, `report`, `mission`, `propose_plan`, `team`, `read_output`, `write`, `extend`, `interrupt`, `reassign`, `merge`, `finish`, `remote_control`. A conversation that calls a former French name is told the new one; French values are still understood.
- What dummyPlane says to agents (role prompts, sub-tasks, budget warnings, tool answers, review remarks) follows the interface's language.
- An orchestrator may no longer run shell commands, and only gets dummyPlane's own MCP tools.
- Closing a working orchestrator asks for confirmation first.
- An orchestrator is refused when Claude Code is not installed, with a message that says so.

### Fixed
- Resuming a Claude session that never had a conversation starts a new one instead of dropping back to the shell.
- The periodic save could replace a terminal's final output with an older copy.
- A rendering error no longer blanks the whole window: it stays in its node, panel or dialog, and the window can reload without stopping the agents.
- A crash in one thread no longer closes dummyPlane and every agent with it.
- A database from a newer dummyPlane is no longer opened by an older one.
- The local server's token no longer appears on any command line.
- Terminals of an dummyPlane started from Claude Code no longer inherit that session's variables.
- A mission in a repository without a commit says so instead of showing git's error.
- A merge refused by a git hook no longer blocks the next merges.
- Mission times stop when the mission ends.
- A deleted orchestrator no longer raises budget alerts, and reports sent while it is stopped reach it when it starts again.
