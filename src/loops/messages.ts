import { defineMessages, plural } from "@/i18n";
import type { LoopError, LoopTemplate, LoopTrigger } from "./model";
import type { StopReason } from "./engine";

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
      noTargets: "No agent on the canvas",
      trigger: "Trigger",
      triggers: { interval: "Every N minutes", idle: "An agent becomes idle", output: "Output contains a text" },
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
      stopped: { runs: "done: runs reached", duration: "done: duration reached", manual: "stopped", noTargets: "stopped: no agent left" } as Record<StopReason, string>,
      cost: (loop: { trigger: LoopTrigger; maxRuns?: number; maxMinutes?: number }) => {
        const parts: string[] = [];
        if (loop.maxRuns !== undefined) parts.push(plural(loop.maxRuns, "run", "runs"));
        if (loop.maxMinutes !== undefined) parts.push(`${loop.maxMinutes} min`);
        return `up to ${parts.join(" or ")}`;
      },
      triggerSummary: (trigger: LoopTrigger) =>
        trigger.kind === "interval" ? `every ${trigger.minutes} min` : trigger.kind === "idle" ? "when an agent becomes idle" : `when “${trigger.text}” appears`,
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
      full: "Too many loops (30 at most): delete one first",
      failed: (error: string) => `Loops: operation failed: ${error}`,
    },
  });
