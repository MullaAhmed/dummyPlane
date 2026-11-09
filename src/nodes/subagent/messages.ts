import { defineMessages } from "@/i18n";

/** The texts of a subagent's node. */
export const subagentMessages = defineMessages({
  running: "RUNNING",
  done: "DONE",
  close: "Close",
  ended: "This subagent has ended.",
  waiting: "Waiting for its first output…",
  report: "Report",
  /** The header's prefix: who spawned it. */
  from: (parent: string) => `↳ ${parent} ›`,
  terminal: "terminal",
});
