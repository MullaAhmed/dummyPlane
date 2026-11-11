import { defineMessages } from "@/i18n";

/** The texts of the nodes: terminals, the Fleet (spec première version §7.1). */
export const nodesMessages = defineMessages(
  {
    unknownNode: "Unknown node",
    shells: {
      default: "Default",
      cmd: "Command Prompt",
    },
    pill: {
      starting: "Starting",
      working: "Working",
      waiting: "Waiting",
      ready: "Ready",
      active: "Active",
      // What its last report says of an agent that is not at work.
      done: "Done",
      blocked: "Blocked",
      failed: "Failed",
      stopped: "Stopped",
      exited: "Exited",
      exitedWith: (code: number) => `Exited · ${code}`,
      // Claude exited and its terminal is back at the shell, which still runs.
      left: "Agent exited",
      // A plain console that runs and is not quiet: no agent, so neither Working nor Active (the counts' words).
      running: "Running",
      error: "Error",
      toolsUnavailable: "Tools unavailable",
      since: (label: string, duration: string) => `${label} for ${duration}`,
    },
    resumeCard: {
      resumeTitle: "Resume the last conversation?",
      relaunchTitle: "Restart?",
      resumeHint: "Click to resume · typing starts fresh",
      relaunchHint: "Click to restart · typing starts fresh",
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
      done: (spent: number, budget: number) => `Done in ${spent} min of ${budget}`,
      blocked: (spent: number, budget: number) => `Blocked after ${spent} min of ${budget}`,
      failed: (spent: number, budget: number) => `Failed after ${spent} min of ${budget}`,
    },
    file: {
      notFound: "File not found",
      refresh: "Refresh",
      loading: "Loading…",
      readFailed: (error: string) => `Could not read: ${error}`,
      empty: "Empty file",
    },
    terminal: {
      notFound: "Terminal not found",
      duplicate: "Duplicate",
      close: "Close",
      duplicateFailed: (error: string) => `Could not duplicate: ${error}`,
      imagePasteFailed: "Could not paste the image",
      nothingToPaste: "Nothing to paste",
      nothingToPasteDetail: "The clipboard holds no text and no PNG, JPEG, GIF or WebP image",
    },
    /** Under an agent's terminal: where it stands, who commands it, and a line to message it. */
    foot: {
      from: (names: string) => `from ${names}`,
      link: "Link",
      done: "Done",
      linkTitle: "Link this agent to another agent or to a fleet",
    },
    session: {
      restartMarker: "── restart ──",
    },
    fleet: {
      defaultName: "Fleet",
      /** A mission's Manager terminal (`@/mission/manager`): its name, and its title with the mission's. */
      managerName: "Manager",
      managerTitle: (mission: string) => `Manager · ${mission}`,
      notFound: "Fleet not found",
      clockTitle: "Time spent / overall budget",
      menu: "Fleet menu",
      pauseAll: "Pause all",
      resumeAll: "Resume all",
      remoteTeam: "Remote Control for the team",
      remoteOff: "Turn off Remote Control",
      close: "Close the fleet",
      input: {
        placeholder: (agents: string) => `Message ${agents}`,
        emptyHint: "Link agents to this fleet",
      },
    },
    toolsUnavailable: {
      title: "dummyPlane tools unavailable",
      consequence: "Without them, the fleet could change your branch: it does not start.",
      retry: "Try again",
      openLogs: "Open the logs folder",
    },
  },
);
