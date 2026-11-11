# The Fleet

The fleet is a Claude Code or Codex session that plans a mission with you, then babysits it (*Fleet agent…* in the settings menu: its Manager and its team run on the same CLI). Link one to a group from the group menu (*Link a fleet*) and describe the goal in its terminal. Then:

1. **It proposes a plan.** It splits the goal into sub-tasks, each with an owner, a time budget and, optionally, a difficulty level. The plan appears in the mission panel under the fleet.
2. **You launch the mission.** dummyPlane creates the mission branch `dummyplane/<mission>`, plus a branch and a worktree for each agent next to your repository. Then dummyPlane itself, not the fleet's model, sets the mission up: a **Kanban board** right of the fleet, one card per sub-task in its to-do column, and a **Manager** terminal under the board. The new agents open as the Manager's sub-agents, in a tree that grows downward under it, four to a row. A mission planned from a Kanban column (*Plan with the fleet*) runs on that board instead of a new one.
3. **The Manager runs the board.** It gives every agent its sub-task, reads their reports, merges, reassigns and finishes. The cards follow: *In progress* when an agent takes one, *Done* on its report, *Blocked* when it is blocked or failed. Each agent declares its steps, which appear as a timeline under its terminal, and agents can hand parts of their work to their own sub-agents. With *Sub-agents as terminals* on, the fleet's `spawn_agent` opens a terminal beside it for a one-off task instead.
4. **You keep talking to the fleet.** The team never interrupts it: reports, questions and progress go to the Manager and the board. Ask for more and the fleet adds cards, which the Manager's queue starts as soon as a seat frees up; the fleet can also reorder them, look at the board and the team, or stop the mission. It hears two things only: the board is finished (with its summary), or the Manager is stuck and needs you.
5. **The Manager keeps time.** It is told when a sub-task reaches its budget. At twice the budget you get a notification and a red bar. Nobody is stopped automatically: the Manager can extend, interrupt or reassign.
6. **It merges.** Finished branches are merged into the mission branch; a conflict aborts that merge and is reported. A mission's own steps **never push** and **never merge into your own branch**. The git window pushes only when you click *Push*, and an agent running commands in a terminal is limited only by its permissions.

Fleet, board, Manager and team are joined by wires, and *Arrange* moves them as one block. When one agent messages another through dummyPlane (a `message_agent`, the Manager's `write`, a report, a card handed from the fleet to the board to the Manager), a dashed wire forms between them if none was there, and lights up with every message. A mission's agents and their Manager reach each other without a manual link. The mission panel says who runs the mission, with the Manager and the board a click away. Only the mission's end alerts you, once: neither the Manager nor its team do.

With the **model router**, each sub-task's level picks the model its agent runs on:

| Level | Model |
|---|---|
| `low` | Claude Haiku 5.5 |
| `medium` | Claude Sonnet 5.5 |
| `high` | Claude Opus 5.5 |
| `extreme` | Claude Fable 5.1 |

The fleet and the Manager talk to dummyPlane through a local MCP server. The fleet plans with `propose_plan` and babysits with `add_tasks`, `prioritize`, `board`, `team`, `stop_mission` and `remote_control`; the Manager runs the team with `team`, `read_output`, `write`, `extend`, `interrupt`, `reassign`, `merge`, `move_card`, `finish` and `need_user`. Both can read the repository, but they are denied `Edit`, `Write`, `NotebookEdit` and `Bash`: the agents write the code. A Codex fleet and its Manager run in Codex's read-only sandbox with approvals off, and get none of your own MCP servers, plugins or browser tools; `remote_control` is Claude's only. A mission launched before the Manager existed is run to its end by its fleet, the old way.

## Overnight run

Before you leave, open *Overnight run…* in the mission panel: how long you will be away, how many agents, where the tickets come from (GitHub issues with a label, `BACKLOG.md`, or Linear issues of one team with a label), what agents may do unasked and whether the plan waits for you. Until the team is formed, the night's choices stay in the panel, where *Edit…* changes them and *Cancel the night* calls it off. The fleet plans, and the Manager and its team work through a queue: when an agent reports done, its branch is merged into the mission branch and a new agent takes the next task in a new terminal, so each task starts with a fresh context. When you are back, a morning report in the panel gives what is done, what failed, what to check by hand and the time spent. Kanban is not a source yet. The PC stays awake during the mission, but closing the lid or asking for sleep still puts it to sleep.

Read this before you choose:

- **By default the plan waits for your go-ahead and agents may *Edit files*.** They edit files and run simple file commands (`mkdir`, `mv`, `cp`) unasked, and stop at their first other command until you are back. That is the safer choice, and it limits what a night can do.
- ***Edit files and run commands* is an explicit choice.** Agents run any command unasked, and what would still ask is refused: the network and the accounts logged in on this PC are open to them. Use a repository you can afford to lose.
- **The fleet and its Manager never wait for a yes at night.** The fleet's session restarts on the same conversation in a mode that refuses whatever would ask, and the Manager starts in it; neither can edit files or run commands. *Clean up the mission* puts the fleet back as it was and closes the Manager.
- **Linear is read by the fleet, through Linear's own read-only server** (`https://mcp.linear.app/mcp/readonly`), with no key stored in dummyPlane. Choose *Linear*, then *Connect…*: the fleet restarts with Linear's server, and you sign in once in its terminal with `/mcp` (pick *linear*, then *Authenticate*); a Codex fleet opens Linear's sign-in in your browser instead (`codex mcp login`). dummyPlane cannot see that sign-in: if the fleet finds no Linear tool at night, it says so and plans nothing.
- **The push block is not a security boundary.** `git push` and the `gh` commands that reach the remote are denied by rules on the command's text and by a git setting in the terminal. They stop accidents. An agent running commands can get past them: a review did with `-c remote.origin.pushurl` and `GIT_CONFIG_COUNT=0`.
