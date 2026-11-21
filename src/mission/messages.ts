import { inLine, stateWords } from "@/agents/messages";
import { defineMessages, plural } from "@/i18n";
import { ROUTER_LEVELS } from "./router";

export const missionMessages = defineMessages({
    // The first words of the mission's status line, beside its dot.
    state: {
      redaction: "Waiting for a task",
      plan: "Plan proposed · waiting for the go-ahead",
      lancement: "Forming the team…",
      en_cours: "In progress",
      terminee: "Finished",
    },
    // Instead of the state, beside the red dot: the words agree with it; the error itself is the line's hint and the alert below.
    stateError: "Stopped on an error",
    report: { termine: inLine(stateWords.done), bloque: inLine(stateWords.blocked), echec: inLine(stateWords.failed) },
    // The rows' words, the state table's in a line; "stopped" is no table state: no process runs (stopped, starting, or its agent exited back to the shell).
    agent: { travaille: inLine(stateWords.working), attend: inLine(stateWords.waiting), inactif: inLine(stateWords.ready), arrêté: "stopped" },
    // What a plan row says of an agent the mission opens for the task (`NEW_AGENT` is the internal id, never shown).
    newAgent: "new agent",
    level: { faible: "low", moyen: "medium", eleve: "high", extreme: "extreme" },
    title: (name: string) => `Mission${name ? ` · ${name}` : ""}`,
    writeTask: "write it in the terminal above",
    settings: "Settings",
    settingsSummary: (agents: number) => `up to ${plural(agents, "agent", "agents")} at once`,
    min: "min",
    maxAgents: "Max active agents",
    maxAgentsHint: "The most agents working at once",
    routerLabel: "Model router",
    routerTitle: `Each agent takes the model of its sub-task's level: ${ROUTER_LEVELS}; on Codex, the models set in Settings. Unset, it follows Settings' Model router; turned on or off here, it stays so until Follow Settings`,
    // The switch beside a header's chips: its name stays, its state is aria-pressed's.
    routerSwitch: "Model router",
    // The switch's word in a terminal's foot, beside Link: its name stays routerSwitch, which holds it.
    routerShort: "Router",
    // Beside a switch the user set, on or off: unsets it, so it follows Settings again, or the Fleet's or spawner's switch above it.
    routerFollow: { settings: "Follow Settings", above: "Follow the switch above" },
    // A switch with nothing to route (`routerInert`), greyed out on every terminal that has none: why, in its hint, its menu entry's title and its Edit panel's line.
    routerInert: {
      agent: (who: string) => `${who} can't open sub-agents, so the router has nothing to route here`,
      manager: "A Manager opens no sub-agents; its Fleet's switch routes the mission",
    },
    // Who "can't open sub-agents": a CLI goes by its name (`AGENTS`), a shell and a custom command by what they are.
    routerInertWho: { shell: "A shell", custom: "A custom command" },
    linked: (count: number) => plural(count, "agent linked", "agents linked"),
    done: "Done",
    link: "Link",
    total: (total: number, away: number | undefined) => `${total} agent minutes${away ? ` · ${away} min away` : ""}`,
    waitingTasks: (count: number) => `Waiting (${count})`,
    // A waiting task that waits for others (`waitsFor`): no agent takes it before each is done and merged.
    waitsFor: (titles: string) => `waits for ${titles}`,
    // The Fleet's proposed change to the waiting tasks while the mission runs: nothing changes before the user applies it.
    amendment: {
      // The mission's status line while they wait: beside the "waiting" dot.
      state: "Changes proposed · waiting for the go-ahead",
      title: "The Fleet proposes changing the waiting tasks",
      added: (count: number) => `Added (${count})`,
      edited: (count: number) => `Edited (${count})`,
      dropped: (count: number) => `Dropped (${count})`,
      apply: "Apply the changes",
      decline: "Decline",
      applyTitle: "Change the waiting tasks as proposed. The tasks at work stay as they are.",
      declineTitle: "Keep the waiting tasks as they are; the Fleet is told",
    },
    // Toast title when the user applies changes a task started meanwhile has made out of date: nothing was changed.
    amendmentVoid: "The changes no longer apply",
    // What a Fleet waits on, under the waiting notice's first line (`./decisions`): a plan, by its mission's name and size.
    decision: {
      plan: (name: string, count: number) => [name, plural(count, "sub-task", "sub-tasks")].filter(Boolean).join(" · "),
    },
    nightBadge: "overnight",
    nightLeft: (minutes: number) => `overnight · ${minutes} min left`,
    morning: {
      title: "Morning report",
      time: (elapsed: number, away: number | undefined) => `${elapsed}${away ? ` / ${away}` : ""} min`,
      count: (title: string, count: number) => `${title} (${count})`,
      check: "To check by hand",
      done: stateWords.done,
      failed: "Failed or blocked",
      unfinished: "Not finished",
      waiting: (tasks: string) => `Left in the queue: ${tasks}`,
    },
    nightButton: "Overnight run…",
    overnight: {
      title: "Overnight run",
      titleChange: "Change the night",
      description: "The Fleet reads your tickets, keeps what fits in your time away, and works while you're gone",
      time: "Time and team",
      away: "Away for",
      awayLabel: "Time away (hours)",
      hours: "hours",
      agents: "Agents at once",
      agentsLabel: "Number of agents working at once",
      awayInvalid: (max: number) => `More than 0 and up to ${max} hours`,
      agentsInvalid: (max: number) => `A whole number from 1 to ${max}`,
      ends: (clock: string, windDown: number) => `Ends around ${clock} · the last ${windDown} min are kept to merge and wrap up`,
      source: "Tickets",
      sources: { github: "GitHub issues", backlog: "BACKLOG.md", linear: "Linear" },
      sourceHelp: {
        github: "Open issues with a label: anyone can open an issue, only people with rights can label one",
        backlog: "The unticked top-level items of the project's BACKLOG.md",
        linear: "Read by the Fleet through Linear's read-only server, in one team, with a label",
      },
      label: "Label",
      labelLabel: "Issue label",
      team: "Team",
      teamLabel: "Linear team key or name",
      teamPlaceholder: "ENG",
      permission: "What agents may do unasked",
      permissions: { ask: "Ask, as usual", edits: "Edit files", work: "Edit files and run commands" },
      // Each one reads on its own line, under its option's name.
      permissionHelp: {
        ask: "Every question waits for you: an agent stops at its first one until you are back",
        edits: "Edits and simple file commands (mkdir, mv, cp) run unasked; an agent stops at the first other command",
        work: "Everything its tools allow runs unasked, and what would still ask is refused. The network and the accounts signed in on this PC are open to agents",
      },
      // A Codex team (checked on Codex 0.167): its sandbox keeps .git read-only, so a commit needs it off or a yes.
      permissionHelpCodex: {
        ask: "Your own Codex settings apply: an agent waits for you only where they make it ask",
        edits: "Edits and sandboxed commands in its folder run unasked. Codex's sandbox keeps .git read-only: to commit, an agent asks you, or fails",
        work: "No sandbox, since Codex's would block commits: everything runs unasked. The network and the accounts signed in on this PC are open to agents. Recursive deletes outside the worktree are not blocked: only the agent's prompt says not to",
      },
      fleetNight: "The Fleet itself never waits for a yes at night: what would ask is refused, and it still cannot edit files or run commands",
      fleetNightCodex: "The Fleet itself runs in Codex's read-only sandbox and never waits for a yes: it reads the repository and cannot write to it",
      noPush: "git push and pull requests are blocked for the night. It is a guard, not a security boundary: a review got past it with -c remote.origin.pushurl and GIT_CONFIG_COUNT=0. Your own settings are not changed.",
      noPushCodex: "git push is blocked for the night. It is a guard, not a security boundary: a review got past it with -c remote.origin.pushurl and GIT_CONFIG_COUNT=0. Codex takes no rule against gh: with Edit files its sandbox has no network, with Edit files and run commands an agent could open a pull request. Your own settings are not changed.",
      start: "Start",
      starts: { wait: "When I approve the plan", auto: "As soon as the plan is ready" },
      startHelp: {
        wait: "You check the plan in the Fleet's panel, then launch it",
        auto: "Leave now: nobody needs to answer",
      },
      checks: "Before you go",
      checking: "Checking the project…",
      checkFailed: "The project could not be checked",
      checkNext: "Check that git and gh run in a terminal, then try again",
      checkAgain: "Try again",
      check: {
        git: "The folder is a git repository",
        gh: "GitHub CLI answers",
        linear: "Linear is connected to the Fleet",
        awake: "The PC stays awake during the mission. Closing the lid or asking for sleep still puts it to sleep.",
      },
      blocked: {
        git: "The workspace's folder is not a git repository",
        gh: "gh does not answer: install GitHub CLI and sign in, or choose another source",
        linear: "Linear is not connected to the Fleet yet",
      },
      connectLinear: "Connect…",
      linearAgain: "Sign in again…",
      linearSteps: "In the Fleet's terminal: type /mcp, pick linear, then Authenticate. Then open Overnight run again.",
      linearStepsCodex: "Your browser opens Linear's sign-in for Codex: approve it, then open Overnight run again",
      linearSigned: "Linear is signed in for the Fleet",
      linearFailed: "Linear's sign-in did not finish",
      usage: (percent: number) => `Plan usage at ${percent} %: the night could stop on the limit`,
      cancel: "Cancel",
      prepare: "Prepare the night",
      update: "Update the night",
    },
    night: {
      title: "Overnight run",
      edit: "Edit…",
      cancel: "Cancel the night",
      away: "Away",
      awayValue: (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`),
      left: (minutes: number) => `${minutes} min left`,
      agents: "Agents",
      agentsValue: (count: number) => `${count} at once`,
      tickets: "Tickets",
      github: (label: string) => `GitHub issues · label ${label}`,
      backlog: "BACKLOG.md",
      linear: (team: string, label: string) => `Linear · team ${team} · label ${label}`,
      permission: "Unasked",
      start: "Start",
    },
    launching: "Launching…",
    // A mission its Manager runs: who runs the team, and where its cards are.
    runBy: (manager: string) => `Run by ${manager}, on its board`,
    showManager: "Manager",
    showManagerTitle: (manager: string) => `Show ${manager}, who runs the team`,
    showBoard: "Board",
    showBoardTitle: "Show the mission's board",
    launch: "Launch the mission",
    reviewTitle: (name: string) => `Review ${name}'s work`,
    reviewLabel: (name: string) => `Review of ${name}`,
    diff: "diff",
    merged: " · merged",
    finishedBefore: (tasks: string) => `Already finished: ${tasks}`,
    spent: (spent: number, budget: number) => `${spent} / ${budget} min`,
    cleanFailed: "Could not clean up the mission",
    // What a cleanup did, for the user, from the panel's button or the Fleet's clean_up_mission alike (`./cleanup.ts`):
    // the title, then what went, the work saved, and what stays, each with why.
    cleanedTitle: (name: string) => (name ? `Mission ${name} cleaned up` : "Mission cleaned up"),
    cleanedRemoved: (removed: readonly string[]) => `Removed: ${removed.join(", ") || "nothing"}.`,
    cleanedSaved: (saved: readonly string[]) => `Uncommitted work saved as a "WIP saved at clean-up" commit on its own branch: ${saved.join(", ")}.`,
    cleanedKept: (kept: readonly string[]) => `Kept: ${kept.join("; ")}.`,
    cleanedOpen: (open: readonly string[]) => `Left open: ${open.join("; ")}.`,
    // `moved`: each worktree's files nothing makes again (ignored ones, `.env*`), and the folder they wait in.
    cleanedMoved: (moved: readonly { worktree: string; folder: string }[]) =>
      `Ignored files nothing makes again, and .env files, moved before their worktree went: ${moved.map(({ worktree, folder }) => `${worktree} → ${folder}`).join("; ")}.`,
    cleanUnderWay: "The clean-up of this mission is already under way: its result shows here when it ends",
    // "Clean up leftovers", the worktrees and branches past missions left in the project, and the question it asks
    // first, with what becomes of each: only the user's Clean up acts (`./leftovers.ts`).
    leftovers: {
      button: "Clean up leftovers",
      hint: "Worktrees and branches that past missions left in this project",
      title: "Clean up the leftovers of past missions?",
      body: (worktrees: number, branches: number) =>
        `${plural(worktrees, "worktree", "worktrees")} and ${plural(branches, "branch", "branches")} of past missions. Nothing is pushed; the running mission's are not touched.`,
      worktreeGoes: "removed",
      wip: (branch: string) => `uncommitted work committed on ${branch} first ("WIP saved at clean-up")`,
      moves: (files: readonly string[], count: number, folder: string) =>
        `${files.join(", ")}${count > files.length ? `, +${count - files.length} more` : ""} moved to ${folder}`,
      gone: "its folder is gone: only git's record of it goes",
      kept: (why: string) => `kept: ${why}`,
      deleted: (target: string) => `deleted: its work is on ${target}`,
      trash: (count: number) => `${plural(count, "folder", "folders")} a clean-up left half-deleted: deleted, their work saved already`,
      strays: (names: string) => `Not git worktrees, left as they are: ${names}`,
      clean: "Clean up",
      notNow: "Not now",
      nothing: "No leftovers of past missions in this project",
      allKept: "Nothing to clean up",
      allKeptWhy: (kept: readonly string[]) => `Everything past missions left here is kept: ${kept.join("; ")}. Each stays until its reason goes.`,
      done: "Leftovers cleaned up",
      failed: "Could not clean up the leftovers",
      launching: "A mission is starting in this project: clean up leftovers once it runs",
      underWay: "The leftovers are being cleaned up already",
    },
    // Why a team terminal stays open (`./keptOpen.ts`): at the cleanup, and to its Manager's close_agent.
    openWhy: {
      launching: "still starting",
      restarting: "starting again",
      dialog: "waiting on a dialog only the user answers",
      atWork: "at work",
      waiting: "waiting for an answer",
      moving: "being handed work",
      subAgents: "its own sub-agents are at work",
      user: "the user is at its terminal",
    },
    clean: "Clean up the mission",
    // "Stop the mission" while it runs, and the question it asks first: what stopping does (`stopMission`, ./stop.ts).
    stop: "Stop the mission",
    stopTitle: (name: string) => (name ? `Stop the mission “${name}”?` : "Stop the mission?"),
    // `manager`: a Manager runs it (a mission run the old way has none).
    stopDescription: (manager: boolean) =>
      `The agents created for it close, and linked agents go back to the project folder.${manager ? " Its Manager stays." : ""} Its branches and worktrees stay: cleaning the mission up later removes only the worktrees whose work is merged.`,
    stopCancel: "Cancel",
    // A stall only the user can end (`./stalls.ts`): the popup, and the notification panel's entry.
    stuckTitle: (name: string, min: number) => `${name} has been waiting for you for ${min} min`,
    stuckQuestion: (what: string | undefined) => what ?? "A dialog is open in its terminal",
    stuckLogin: "Its login expired: run /login in its terminal",
    overBudgetTwice: (name: string, budget: number) => `${name} has gone over twice its budget (${budget} min) without reporting`,
    // The toast when the user starts a mission's agent again while the team is full (`./restartWatch.ts`).
    pastMaxAgents: (name: string, mission: string, active: number, max: number) =>
      `${name} started again: ${active} agents are at work${mission ? ` in mission ${mission}` : ""}, past its Max active agents (${max}). No new agent starts until fewer are at work.`,
    // The question `land` asks, in the Fleet's panel and a toast: only the user's click lands (`./land.ts`).
    land: {
      title: (target: string) => `Land the mission on ${target}?`,
      body: (target: string, count: number, branch: string) => `${target} gets ${plural(count, "commit", "commits")} of ${branch}, by fast-forward. Nothing is pushed.`,
      moved: (target: string, branch: string) =>
        `${target} moved since the mission started: Land first merges it into ${branch}, in the mission's worktree, never in your checkout. Its checks run again, then you're asked again.`,
      more: (count: number) => `+${count} more`,
      land: "Land",
      notNow: "Not now",
      landed: (target: string, count: number) => `Mission landed: ${target} has its ${plural(count, "commit", "commits")}`,
      upToDate: (target: string) => `${target} already has the mission's commits`,
      dirty: (target: string) => `Mission not landed: your checkout of ${target} has uncommitted changes`,
      dirtyNext: (files: string) => `Nothing was touched (${files}). Commit or set them aside, then the Fleet can ask again.`,
      merged: (target: string) => `${target} moved: merged into the mission's branch`,
      mergedNext: "In the mission's worktree, not your checkout. Its checks run again there, then you're asked again.",
      conflict: (target: string) => `${target} moved, and merging it into the mission's branch conflicts`,
      conflictNext: (files: string) => `The merge was undone (${files}). An agent resolves it in the mission's worktree, then you're asked again.`,
      failed: "Could not land the mission",
    },
  });
