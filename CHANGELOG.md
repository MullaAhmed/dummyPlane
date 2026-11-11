# Changelog

All notable changes to dummyPlane are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **The Fleet babysits; a board and a Manager run the mission:**
  - **At the go-ahead:** dummyPlane opens a Kanban board beside the Fleet, or reuses the one the plan came from, and a **Manager** under the board, all wired. The plan's tasks become cards.
  - **The Manager:** a new read-only agent on the Fleet's CLI. It starts the team, reads their reports, merges, reassigns and moves the cards (*In progress*, *Done*, *Blocked*) by itself.
  - **The team:** they open under the Manager as a tree that grows down, in rows of up to four, wired from parent to child without crossing a terminal. Arrange moves the Fleet, board, Manager and tree as one block.
  - **The Fleet:** you keep talking to it. It adds cards (the Manager starts them as seats free up), reprioritises them and can stop the mission. It is no longer disturbed by the team: it hears only that the board is finished, or that the Manager needs you. The mission's end alerts once.
  - **Older missions:** a mission saved before runs the old way. Overnight runs, Codex Fleets and Remote Control work with the Manager.
- **Wires form when agents talk:** the first time one agent messages another (a message, a report, the Manager's instructions, a question passed up, a card handed on), a dashed talk wire joins them and pulses with every message. Inside a mission, the Manager and its agents reach each other without *+ Link*. A talk wire never makes an agent part of the Fleet's team.
- **An output node:** an agent shows a result with the `show_output` tool instead of a wall of text: a report, a summary, a comparison, a table, figures or a chart. It appears beside the agent's terminal, wired to it, under the same header as terminals.
  - **How it's drawn:** [OpenUI](https://www.openui.com/) Lang, with dummyPlane's own components (cards, tables, stats, callouts, code, bar and line charts, links, buttons…) in the palette's colours.
  - **Buttons:** a button types its message into the agent that made the output, only when you click it.
  - **The agent's side:** calling the tool again updates the same node, and `output_guide` gives the agent the components and an example.
  - **Your side:** *Copy as text* copies the output, and ⋯ shows or copies its source.
  - **Database upgrade:** it needs migration 7 on first start; dummyPlane keeps a copy of the database first (`dummyplane.v6-backup.db`).
  - **Privacy:** OpenUI's install-time analytics are switched off and its development widget is replaced. Nothing it ships calls out from the app.
- **Agents read dummyPlane links:** a `dummyplane://…` link you paste into an agent's terminal (a terminal, a Fleet, a sub-agent, an output, a file or a Kanban board) is read with the new `read_node` tool, without linking the two on the canvas. A sub-agent's link gives its type, its prompt and its answer.
- **Generated text through OpenUI:** these render OpenUI Lang, and Markdown otherwise:
  - an agent's last report in the *Edit* tab;
  - the Fleet's mission summary;
  - the morning report's summaries;
  - a sub-agent's answer.

  Names, step titles, status words and one-line summaries stay plain text. A report written in OpenUI Lang with errors is refused, and the agent is told which lines to fix.
- **A Fleet's sub-agents open as terminals:** with *Sub-agents open as terminals* on, a Fleet delegates one-off work (a lookup, a check) with `spawn_agent`, like any agent, instead of Claude's built-in sub-agents.
  - **Where it opens:** a regular agent in its own terminal beside the Fleet, wired to it, in the workspace's folder and on the Fleet's CLI.
  - **What it may do:** it edits files and runs commands with your usual prompts. During an overnight run, it has the night's permission until the night ends.
  - **When it's done:** its report is typed into the Fleet's terminal.
  - **Not on the team:** a mission's work still goes to its team, and a sub-agent is not a team member.
- **Arrange tidies everything in a group,** not only its terminals:
  - **What moves:** every node at its real size (Kanban boards, files, outputs, sub-agent cards, minimised tabs) and the drawings in the frame.
  - **What stays together:** a set of Excalidraw-grouped shapes, a shape with its label, a diagram whose shapes are joined by arrows, and a hand-drawn frame with what it holds.
  - **Arrows:** they follow the shapes they're bound to.
  - **Sub-agent trees:** a group holding one is arranged too, its flowchart kept.
  - **Attached items:** an output and a quick note move with the agent they belong to.
- **Quick notes:** *Note* on a terminal's or a Fleet's right-click ring, in its ⋯ menu or in the palette (*Quick note on this terminal*) opens a note right beside it, ready to type in, and saved with the canvas.
  - **Placement:** a note never covers another node, and a terminal's notes stack beside it.
  - **Moving:** a note follows its terminal when it's dragged, minimised, expanded or arranged; one you move by hand keeps its new place beside it.
  - **Deleting:** a note with text that's deleted can be brought back from the *Undo* toast.
  - **Closing:** when its terminal closes, a note with text stays on the canvas, unattached.
  - **The ring:** on a terminal's ring, *Note* takes *Duplicate*'s place; *Duplicate* is still in ⋯, the palette and Ctrl+D.
- **A `claude` typed by hand in an agent's terminal stays in dummyPlane:** after Claude exits, the shell is still there; `claude`, `claude -c` or `claude --resume` typed in it now starts with that terminal's dummyPlane settings in PowerShell, cmd and Git Bash.
  - **What it keeps:** dummyPlane's hooks (status, questions, sub-agent nodes), its tools and role, the model and effort, and a Fleet's limits.
  - **Before:** it started a plain Claude, which dummyPlane could not see, and a Fleet resumed that way could edit files.
  - **Where it shows:** nowhere on screen and in no shell history.
  - **Not for Codex:** a `codex` typed by hand still starts without dummyPlane's profile.
- **An alert when an agent finishes,** as there is one when it asks.
  - **What counts as finished:** it reports *Done*, *Blocked* or *Failed*; a Fleet's mission ends; or an agent's turn ends after at least 20 s of work.
  - **How you're told:** when dummyPlane isn't in front, a Windows notification gives the agent's name, its state and the first line of its summary, and clicking it brings you to that agent. When dummyPlane is in front but you aren't looking at that agent, a toast with *Show* appears instead.
  - **Who alerts:** agents you started and Fleets. A sub-agent, a running mission's team agent and a plain shell don't.
  - **When it waits:** an agent whose sub-agents still work alerts once, when it's really done.
  - **Turning it off:** *Alert when an agent finishes*, in the settings menu, is on by default.
- **Pasted images are attachments:** an image pasted into the command bar or a Fleet's message line shows as a thumbnail chip, never as a file path. It can be removed with its × or Backspace. On send, Claude Code and Codex get each image as an attached image (`[Image #N]`) before the text; dummyPlane waits for the image to show before typing the rest, since Claude drops an Enter that arrives while it reads one.
- **An agent for the Fleet:** the settings menu's *Fleet agent…* lists the CLIs, installed or not, and which can carry a Fleet; the Fleet, its team, its queue's agents and their sub-agents all run on the one chosen, and dummyPlane asks before the first Fleet when more than one installed CLI could (with a single one, it is taken). Claude Code and Codex can carry a Fleet; the others are listed with why not yet.
- **A Fleet on Codex:** a Codex Fleet runs in Codex's read-only sandbox and never waits for a yes, with dummyPlane's tools and none of your own MCP servers, plugins or browser tools, even those a project's `.codex/config.toml` adds; it does not start if Codex still lists one, or points dummyPlane's server elsewhere. Its team and their sub-agents run Codex too, with dummyPlane's tools and their mission's permission: *Edit files* is Codex's `workspace-write` sandbox (to commit, an agent asks you, or fails), *Edit files and run commands* runs without a sandbox, since Codex's keeps `.git` read-only. dummyPlane knows when Codex's prompt is ready, answers its trust question in the worktrees it makes, and *Resume* takes the conversation Codex saved back up. Every Codex terminal now gets dummyPlane's tools and role through a profile file in Codex's folder, removed when it closes; it starts without Codex's update check, which would stop it before its task. The model router stays Claude's, and Remote Control is not offered to a Codex Fleet.
- **Linear as an overnight ticket source:** choose *Linear*, a team and a label in *Overnight run*; the Fleet reads the issues itself through Linear's own read-only server, with no key stored in dummyPlane. *Connect…* gives the Fleet that server; you sign in once, in its terminal with `/mcp` for Claude, in the browser Codex opens for Codex.
- **A folder per workspace:** each canvas workspace can work in its own folder (the workspace tab's menu: *Folder…*, *Use the project folder*, or the launch folder at the top of the agent menu). Terminals, Fleet sessions, installs, sign-in, the git chip and the missions' repository (its worktrees too) all follow it; a workspace without a folder keeps following its project. Terminals already open keep their own folder, *Change folder* on the project moves a workspace's own folder along when it lay inside the old one, and a mission agent's folder is shown read-only in its options, with the reason. Code Studio and notes stay per project.
- **An *Edit* tab for the Fleet,** like the terminals' one, and a terminal's folder and shell can be edited from its panel.
- **An effort slider in the *Edit* tab:** a Claude terminal or a Fleet gets Claude Code's effort level (`--effort`) from a slider with six stops, *Auto*, *Low*, *Medium*, *High*, *Extra high* and *Max*; *Auto* passes no level, and Claude takes the one in your settings or the model's own. Under it, the level the running session reports. Changing it on a running terminal offers *Restart now*, like its other launch settings.
- **Taken to the agent that asks:** when an agent starts waiting for you, dummyPlane brings you to its terminal and gives it the keyboard, one agent at a time, oldest first. It never moves while you write (it waits for a 3 s pause after your last key, and up to 10 s while the field you are in holds a draft you have not sent; a field that merely has the focus does not hold it), while you answer another waiting agent (one that starts asking while you are in its terminal is gone to as well), while a dialog, menu or the palette is open, in reading mode, or while the window is not in focus (it goes when you come back, if the agent still waits). A setting in the settings menu, *Go to agents that ask*, turns it off.
- **Done, Blocked and Failed:** once an agent reports and rests, its status reads *Done*, *Blocked* or *Failed* instead of *Ready* (header, minimized card, agents panel, *Go to* and the `@` list) until it works again. Its steps settle with the report, and its budget bar fills in the report's tone. The agents panel filters are now *All*, *Waiting*, *Working* and *Done*; a saved filter that no longer exists moves to the one that took its place.

### Changed
- **"Agent exited":** when Claude quits and its terminal is back at the shell, the node says so, in its header, the agents panel and its card, with *Resume* and *Restart*, instead of still reading *Ready*.
- **Arrange and Auto-arrange** are named for what they now do, without "terminals".
- **Message agents from the command bar:** an agent's terminal no longer has a message field of its own; its foot keeps its status line and *Link*. Selecting terminals or groups on the canvas puts them in the command bar as `@` chips, as if typed, in the canvas's order (a group once, not its members again); with nothing selected, the terminal you last entered gets its chip as before. A new selection replaces the chips the last send left, though not those of a draft you are writing; a chip you remove is not sent to, and removing your own last chip shows who Enter would reach again.
- **A Fleet's message line in one click:** the line under a Fleet is now the message field itself, instead of a fold to open first. It is as tall as the old line, grows with what you write, never takes the keyboard by itself, and Escape gives the keyboard back to the Fleet.
- **Claude's own colours follow the palette:** Claude terminals start with dummyPlane's theme for Claude Code (its ANSI-only dark theme, written to Claude's `themes` folder as `dummyplane.json`), so its prompt, accents, panels and diffs draw in the palette's terminal colours and switch with it. Message panels and diff lines keep their text at 4.5:1 or more in every palette. Sessions outside dummyPlane keep your own theme. Inside a dummyPlane terminal, `/theme` gives way to dummyPlane's; a `theme` set in your Claude settings (user or project) wins, from the next start.
- **The *Edit* tab names the model Claude picks:** the choice without a model of its own reads as that model instead of "Claude's default": the one the running session reports (*Opus 5.5 · your settings*), else the `model` in your Claude settings, else *Your plan's default model*.
- **No *Title* or *Session name* row in the *Edit* tab:** a terminal is named in its header. Claude still gets the terminal's name when a new conversation starts.
- **A clearer Overnight run:** the dialog is laid out in sections (time and team, tickets, what agents may do, how it starts) and ends with a checklist of what is ready, when the night ends and how long is kept to wrap up. Once prepared, the night's choices stay in the Fleet's panel, with *Edit…* and *Cancel the night* until the team is formed, and the time left once it works.
- **The night's permissions say what they really do,** as Claude Code applies them: *Edit files* also runs simple file commands (`mkdir`, `mv`, `cp`), and with *Edit files and run commands* what would still ask is refused rather than waiting.
- **No more global budget on a mission:** its settings keep *Max active agents* and the model router. Each sub-task still has its own time budget, and an overnight run is still bounded by your time away. A mission saved with a global budget simply goes on without it.
- **Notes open in a tab,** next to the workspace tabs, the way Code Studio does, instead of a window over the project: the rail's *Notes*, the palette or the tab itself. A note being written stays as it is when you switch tabs or close the Notes tab, and closing dummyPlane asks about it whichever tab is on screen. Closing the Notes or Code tab no longer asks to erase anything: their files are on disk. A group's notes are still chosen in their own dialog.
- **The manager is the Fleet** everywhere you read it: menus, panels, nodes, the palette, the prompts agents are given, the README and the docs. Nothing is lost on the way: saved projects and canvases keep the `orchestrator` kind they were stored with, and recently used commands under their old names are carried over.
- **The database is upgraded once more on first start:** migration 5 gives each workspace an optional folder, and migration 6 lets a project have its Notes tab. dummyPlane keeps a copy of the database first (`dummyplane.v4-backup.db`, or `v5` if you ran a development build).
- **One header for terminals and the Fleet:** the same name field, status, buttons and overflow menu (⋯) on both, and the same rules when a node is narrow.
- **Interface consistency:** panels, dialogs, menus and hints follow the design system: the same controls, dialog footers, one hint at a time and one set of motions, with a press that eases on scale.
- **Double-click selects:** a double-click on a terminal or the Fleet selects it with any tool.
- **Agents stacked under a Fleet or in a group are spaced further apart,** to leave room for their step frieze.

### Fixed
- **Agent counts agree everywhere:**
  - **What used to disagree:** the title bar could read "16 active" beside "1 working". "Active" counted every running process in every tab, plain shells and exited agents included, while "working" and "waiting" counted the tab on screen without its Fleets.
  - **What they count now:** the title bar's three counters, the side rail's waiting pip, the agents panel's filters and section headers, the group labels on the canvas, the workspace tab badges and *Go to*'s "N active" all count the same agents, Fleets included and plain shells never, from the state their status pill shows. "Active" is the tab on screen, like the panel; an agent waiting in another tab still brings the waiting notice.
  - **Exited agents:** they're no longer counted as working, and the close dialog no longer says one is working.
  - **The panel's *Active* filter:** clicking "N active" opens it, and it lists exactly those N agents.
  - **Plain shells:** a plain shell reads *Running* while it works, never *Working*.
  - **The home screen:** a project card counts live agents the same way.
- **The UI audit's second tier (P2), all 59 findings:** 49 fixed in this release, 10 already fixed before it.
  - **Keyboard and screen readers:**
    - focus follows menus and panels that swap views, and returns to what opened them;
    - placing an agent ends with Enter;
    - hints, palette results, update progress and errors are announced, and the errors are tied to their fields;
    - rename fields are named;
    - the project card is one button;
    - the git changes list is one tab stop;
    - the file tree has a real tree keyboard model;
    - native tooltips gave way to the app's hints.
  - **Legibility:**
    - fields have a visible boundary (`--dp-line-strong`);
    - the chosen soft tab has an accent border;
    - text selection follows the palette;
    - agent tints and the overdue chips pass contrast in every palette;
    - working and waiting no longer differ by colour alone;
    - a role shows as a bar, and a priority as signal bars, not as status dots.
  - **Layout at small sizes:**
    - the window buttons stay in reach at 960 px;
    - the bottom bars no longer overlap;
    - the active workspace tab scrolls into view;
    - dialogs scroll past the window's height, and their close button no longer covers the title;
    - menus fit their content.
  - **States and recovery:**
    - *Undo* for a deleted Kanban column, card or loop;
    - *Try again* after a failed start or workspace load;
    - error boundaries recover;
    - the overnight run waits for its checks;
    - a mission stopped on an error says so;
    - the Files tab refreshes;
    - a remark stays on its line;
    - Markdown preview keeps the editor's undo;
    - Markdown links open in the browser;
    - one primary button per first-run screen.
  - **Speed:** panning no longer re-derives the scene on every frame, and typing a remark no longer re-renders the whole diff.
  - **Not done in this pass:**
    - virtualising very long diffs and trees;
    - moving the canvas backdrops with transforms;
    - the bottom band as one grid.
- **The Fleet gets the MCP servers its *MCP* tab shows on.** It used to start with dummyPlane's server only, whatever the tab said, so a Linear or Supabase server checked there was missing from its session. They are now copied into the Fleet's own MCP configuration, a plugin's server too while its plugin is on. Your own servers keep the sign-in Claude already has for them; a plugin's server may ask for it once (`/mcp`). A Fleet still reads no other MCP configuration, and no claude.ai connector. During an overnight run that reads its tickets in Linear, Linear's read-only server takes the place of a `linear` server of yours.
- **Every plugin Claude loads is in the *Plugins* tab:** one turned on in the project's settings but installed for another project (Claude loads it from its cache), and a plugin kept in a `skills` folder (`<name>@skills-dir`, on until turned off), with its subagents and MCP servers.
- **Every skill and MCP server Claude loads is in the *Edit* tab:** your own and the project's commands, the skills synced from your claude.ai account, and each plugin's skills and commands. Commands and synced skills switch one by one; a plugin's skills follow their plugin's switch, since Claude's per-skill switch doesn't reach them. *MCP* now shows Claude in Chrome, which can be turned off, and dummyPlane's own server, always on. A `.md` file without front matter (a README) is no longer listed as a subagent. What nothing on disk names, Claude Code's bundled skills, built-in plugins and subagents, and claude.ai connectors, is said under each list.
- **The Fleet no longer stalls on a question at night:** during an overnight run its own session refuses what would ask instead of waiting for nobody, and still cannot edit files or run commands. Cleaning up the mission puts it back.
- **Closing a Fleet mid-mission no longer leaves its agents with the night's permission:** they go on as they run, but a later restart asks as usual.
- Deleting a workspace (its tab's ×, its menu or the palette) and removing a project from the home screen now ask in dummyPlane's own dialog, in the app's look, instead of a Windows message box; Cancel is where the keyboard starts. A failure reads as a plain sentence, without "AppError:" in front.
- The eraser no longer erases terminals or the Fleet, nor takes them along with a group's frame or with a drawing grouped with either; it still erases the drawings that are grouped with none of them.
- Agents that arrive on their own (a mission's team and queue, `spawn_agent` sub-agents, replacements) no longer scroll the canvas to them or take the keyboard while you work. They start where they are, a quiet *joined · Show* toast tells you (one toast for several arrivals), and a launch you asked for still comes into view.
- **A sub-agent says what it was asked, legibly:** a terminal opened by `spawn_agent` shows its task in a line under its name (the title its spawner gave, else the task's first meaningful sentence, without markdown, "You are…" or setup steps), in the secondary text colour at 12px, with the task's excerpt in a tooltip you can reach with Tab; its minimized card and its Claude session title say the same line. A Claude subagent cell shows its type over what it was asked, and a finished one no longer fades under an opacity: its text steps to the dim ink and keeps 4.5:1 or more in every palette.
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
