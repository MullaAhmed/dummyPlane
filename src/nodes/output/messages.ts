import { defineMessages } from "@/i18n";

/** The output node's words: its header, its menu, its notices. */
export const outputMessages = defineMessages({
  untitled: "Output",
  missing: "This output is gone",
  from: (name: string) => `From ${name}`,
  fromGone: "From an agent no longer on the canvas",
  updated: (when: string) => `Updated ${when}`,
  copy: "Copy as text",
  more: "More",
  copySource: "Copy source",
  copyLink: "Copy link",
  showSource: "Show source",
  showOutput: "Show output",
  close: "Close",
  copied: "Copied",
  linkCopied: "Link copied: paste it to an agent, it reads it with read_node",
  copyFailed: "Could not copy to the clipboard",
  sent: (label: string, name: string) => `“${label}” sent to ${name}`,
  notSent: (name: string) => `${name} is not running: nothing was sent`,
});
