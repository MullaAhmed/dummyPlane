import { defineMessages, plural } from "@/i18n";
import type { LoopError, LoopTemplate, LoopTrigger } from "./model";
import type { StopReason } from "./engine";

/** How a loop ended that can run again as it is. */
export type LoopEnd = Exclude<StopReason, "noTargets" | "noAgents">;
/** Why a loop cannot run as it is: it stopped with no agent to type into, or it never had one. */
export type LoopProblem = "noTargets" | "noAgents" | "noAgent";

/** Texts of the loops (loops spec). */
export const loopsMessages = defineMessages({
    section: "Loops",
    notRead: "The list of loops could not be read: nothing changed",
    manage: "Manage loops…",
    manageKeywords: ["loop", "loops", "recurring", "repeat", "automatic"],
    stopAll: (running: number) => `Loops: stop all (${running})`,
    stopAllKeywords: ["loop", "stop", "all", "emergency"],
    indicator: {
      label: (loops: number, runs: number) => `${plural(loops, "loop", "loops")} · ${plural(runs, "run", "runs")}`,
      stopAll: "Stop all",
      // The name starts with what the button shows (WCAG 2.5.3 label in name).
      open: (summary: string) => `${summary}, open the loops`,
    },
    dialog: {
      title: "Loops",
      description: "An instruction that sends itself again. Each run spends real usage: every loop has an end, and stays off after a restart.",
      empty: "No loop yet. Create one, from a template if you like.",
      new: "New loop",
      templates: "Templates",
      template: { progress: "Progress check", relaunch: "Relaunch", tests: "Test watch" } as Record<LoopTemplate["id"], string>,
      templateInstruction: {
        progress: "Give a short progress check: what is done, what is left, what is blocking.",
        relaunch: "Continue: pick up where you stopped, or say what is blocking you.",
        tests: "Tests are failing: read the output, fix the cause and run them again.",
      } as Record<LoopTemplate["id"], string>,
      name: "Name",
      instruction: "Instruction sent",
      targets: "Agents",
      noTargets: "No agent in this project",
      // Loops of other projects still run; the indicator's Stop all stops them with this project's.
      elsewhere: (running: number) => `${plural(running, "loop runs", "loops run")} in other projects: Stop all, at the bottom left, stops them too`,
      trigger: "Trigger",
      triggers: { interval: "Every N minutes", idle: "An agent becomes ready", output: "Output contains a text" },
      // A number reads as a sentence, the field between the words: "Every 30 minutes", "At most 5 runs".
      every: "Every",
      atMost: "At most",
      unitMinutes: "minutes",
      unitRuns: "runs",
      text: "Text to spot",
      stop: "End of the loop (at least one)",
      save: "Save",
      cancel: "Cancel",
      close: "Close",
      edit: "Edit",
      remove: "Delete",
      // The row left where a deleted loop was, with its Undo; the loop comes back turned off.
      removed: (name: string) => `Loop “${name}” deleted`,
      undo: "Undo",
      turnOn: "Turn on",
      turnOff: "Stop",
      off: "off",
      round: (runs: number, max: number | undefined) => (max === undefined ? `run ${runs}` : `run ${runs} / ${max}`),
      untilEnd: (minutes: number) => `ends in ${minutes} min`,
      // How a loop ended on its own terms, or by hand: a loop that cannot run says so as a problem (below).
      stopped: {
        runs: "done: runs reached",
        duration: "done: duration reached",
        manual: "stopped",
      } as Record<LoopEnd, string>,
      /**
       * A loop that cannot run, and how to make it run again: Edit is then its first button. noAgent: saved when shells
       * could be targets, none of its own is an agent, and it stays off.
       */
      problem: {
        noTargets: "Stopped: none of its agents is running",
        noAgents: "Stopped: its targets are shells, not agents",
        noAgent: "Off: none of its targets is an agent",
      } as Record<LoopProblem, string>,
      problemNext: {
        noTargets: "Restart one of its agents, or edit the loop to pick others",
        noAgents: "Edit the loop to choose agents",
        noAgent: "Edit the loop to choose agents",
      } as Record<LoopProblem, string>,
      cost: (loop: { trigger: LoopTrigger; maxRuns?: number; maxMinutes?: number }) => {
        const parts: string[] = [];
        if (loop.maxRuns !== undefined) parts.push(plural(loop.maxRuns, "run", "runs"));
        if (loop.maxMinutes !== undefined) parts.push(`${loop.maxMinutes} min`);
        return `up to ${parts.join(" or ")}`;
      },
      triggerSummary: (trigger: LoopTrigger) =>
        trigger.kind === "interval" ? `every ${trigger.minutes} min` : trigger.kind === "idle" ? "when an agent becomes ready" : `when “${trigger.text}” appears`,
      errors: {
        name: "Give the loop a name",
        instruction: "Write the instruction to send",
        targets: "Choose at least one agent",
        interval: "The interval is 1 to 1440 minutes",
        text: "The text is 1 to 200 characters",
        runs: "The number of runs is 1 to 1000",
        minutes: "The duration is 1 to 1440 minutes",
        stop: "Set an end: a number of runs or a duration",
      } as Record<LoopError, string>,
      full: "Too many loops in this project (30 at most): delete one first",
      failed: "Could not change the loops",
    },
  });
