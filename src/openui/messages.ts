import { defineMessages } from "@/i18n";

/** The words of generated output's own chrome: its notices, its source toggle, its disabled buttons. */
export const openuiMessages = defineMessages({
  notShown: "Part of this output could not be shown",
  showSource: "Show source",
  hideSource: "Hide source",
  noAgent: "No agent to send this to",
  sent: (label: string) => `“${label}” sent to the agent`,
  chartEmpty: "No data",
  tableEmpty: "No rows",
  openLink: (url: string) => `Open ${url}`,
  copied: "Copied",
  copyCode: "Copy code",
  sortBy: (column: string) => (column ? `Sort by ${column}` : "Sort by this column"),
  allRows: (count: number) => `Show all ${count.toLocaleString("en-US")} rows`,
  fewerRows: "Show fewer rows",
});
