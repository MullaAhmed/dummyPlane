import { inLine, stateWords } from "@/agents/messages";
import { defineMessages } from "@/i18n";

/** The texts of the nodes: terminals, the Fleet. */
export const nodesMessages = defineMessages(
  {
    unknownNode: "Unknown node",
    shells: {
      default: "Default",
      cmd: "Command Prompt",
    },
    pill: {
      starting: "Starting",
      // The state table's words (`stateWords`): every surface says one word for one state.
      working: stateWords.working,
      waiting: stateWords.waiting,
      ready: stateWords.ready,
      // What its last report says of an agent that is not at work.
      done: stateWords.done,
      blocked: stateWords.blocked,
      failed: stateWords.failed,
      stopped: "Stopped",
      exited: stateWords.exited,
      exitedWith: (code: number) => `${stateWords.exited} · ${code}`,
      // Claude exited and its terminal is back at the shell, which still runs.
      left: "Agent exited",
      // A plain console that runs and is not quiet: no agent, so neither Working nor Waiting (the counts' words).
      running: "Running",
      error: "Error",
      toolsUnavailable: "Tools unavailable",
      // A sub-agent whose spawner's pick of skills, MCP servers and plugins could not be set: it did not start.
      pickRefused: "Pick not set",
      since: (label: string, duration: string) => `${label} for ${duration}`,
      // A finished agent whose process dummyPlane stopped (`@/agents/finishedStop`): an expand or new work starts it again.
      asleep: (label: string) => `${label} · stopped to free memory, expand to resume`,
    },
    resumeCard: {
      resumeTitle: "Resume the last conversation?",
      relaunchTitle: "Restart?",
      // Typing in the stopped terminal does what the click does: a new conversation is the menu's "New session".
      resumeHint: "Click or type to resume",
      relaunchHint: "Click or type to restart",
      oneShotHint: "Click to run the command again",
      // Over a shell whose Claude exited: typing goes to the shell, where `claude` starts it again with its tools.
      leftHint: "Claude exited · click, or type claude in the shell",
      hide: "Hide",
    },
    options: {
      title: (name: string) => `Options for ${name}`,
      thisTerminal: "this terminal",
      cancel: "Cancel",
      apply: "Apply at next launch",
    },
    header: {
      agent: "Agent",
      /** A manager its spawner opened (spawn_agent's role "manager"), in its header and on its Agents row: no mission's Manager. */
      coordinator: "Manager",
      coordinatorHint: "Opened as a manager: it runs its task with sub-agents of its own, on a board of its own",
      more: "More actions",
      relaunch: "Restart",
      resumeSession: "Resume the session",
      newSession: "New session",
      latestInFolder: "Latest in the folder",
      stopProcess: "Stop the process",
      modelChosen: (model: string) => `Model chosen by the router: ${model}`,
      modelDefault: "Default model at next start",
      current: "current",
      options: "Options…",
      doubleClickRename: "Double-click to rename",
      review: "Review changes",
      minimize: "Minimize",
    },
    minimized: {
      expand: "Expand",
      doubleClickExpand: "Double-click to expand",
    },
    /** The title of a member's budget bar under its terminal: its time over its budget, in minutes. */
    budgetBar: {
      spent: (spent: number, budget: number) => `${spent} / ${budget} min`,
      done: (spent: number, budget: number) => `${stateWords.done} in ${spent} min of ${budget}`,
      blocked: (spent: number, budget: number) => `${stateWords.blocked} after ${spent} min of ${budget}`,
      failed: (spent: number, budget: number) => `${stateWords.failed} after ${spent} min of ${budget}`,
    },
    /** A step of the frieze under a terminal, as its mark is named: "Tests, done". Its shape shows the state; the name says it. */
    stepMark: {
      state: { fait: inLine(stateWords.done), en_cours: "in progress", a_venir: "to do", echec: inLine(stateWords.failed) },
      name: (title: string, state: string) => `${title}, ${state}`,
    },
    file: {
      notFound: "File not found",
      refresh: "Refresh",
      loading: "Loading…",
      readFailed: "Could not read the file",
      readNext: "Refresh to read it again",
      empty: "Empty file",
    },
    terminal: {
      notFound: "Terminal not found",
      duplicate: "Duplicate",
      close: "Close",
      duplicateFailed: "Could not duplicate the terminal",
      imagePasteFailed: "Could not paste the image",
      nothingToPaste: "Nothing to paste",
      nothingToPasteDetail: "The clipboard holds no text and no PNG, JPEG, GIF or WebP image",
    },
    /** Under an agent's terminal: where it stands, who commands it, and a line to message it. */
    foot: {
      from: (names: string) => `from ${names}`,
      link: "Link",
      done: "Done",
      linkTitle: "Link this agent to another agent, a fleet or a Kanban board",
    },
    session: {
      restartMarker: "── restart ──",
    },
    fleet: {
      defaultName: "Fleet",
      /** A mission's Manager terminal (`@/mission/manager`): its name, and its title with the mission's. */
      managerName: "Manager",
      managerTitle: (mission: string) => `Manager · ${mission}`,
      /** The group frame that holds a mission's Manager and its team, as a go-ahead's team had before Managers. */
      teamGroup: (mission: string) => (mission ? `Mission ${mission}` : "Mission"),
      notFound: "Fleet not found",
      clockTitle: "Time spent / overall budget",
      menu: "Fleet menu",
      pauseAll: "Pause all",
      resumeAll: "Resume all",
      remoteTeam: "Remote Control for the team",
      remoteOff: "Turn off Remote Control",
      close: "Close the fleet",
    },
    toolsUnavailable: {
      title: "dummyPlane tools unavailable",
      consequence: "Without them, the fleet could change your branch: it does not start",
      retry: "Try again",
      openLogs: "Open the logs folder",
    },
  },
);
