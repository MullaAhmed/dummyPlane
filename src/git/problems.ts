import { messages } from "@/i18n";
import { rawText } from "@/lib/errorToast";
import { gitMessages } from "./messages";

/** What the git window was doing when git refused: the title names it. */
export type GitDoing =
  | { what: "read" }
  | { what: "diff"; path: string }
  | { what: "history" }
  | { what: "branches" }
  | { what: "push"; target: string }
  | { what: "switch"; branch: string }
  | { what: "commit" }
  | { what: "discard"; path: string };

/** A refusal the window can say more of than "could not". */
export type GitRefusal = "notRepo" | "locked" | "rejected" | "overwritten" | "identity";

/**
 * Git's words that tell one refusal from another. Git may speak another language (the app sets no locale): then none
 * matches and the plain title of what was being done stands, with git's line under it.
 */
const REFUSALS: [GitRefusal, RegExp][] = [
  ["notRepo", /not a git repository/i],
  ["locked", /index\.lock/i],
  // ` ! [rejected] main -> main (fetch first)`, or `(non-fast-forward)`; a `[remote rejected]` (a hook, a protected branch) is not one.
  ["rejected", /\[rejected\]|updates were rejected/i],
  ["overwritten", /would be overwritten by (?:checkout|switch)/i],
  ["identity", /please tell me who you are|unable to auto-detect email address|empty ident name/i],
];

export function gitRefusal(error: unknown): GitRefusal | null {
  const text = rawText(error);
  return REFUSALS.find(([, words]) => words.test(text))?.[0] ?? null;
}

/**
 * The line of git's output that says most, for the detail: ` ! [rejected] main -> main (fetch first)` rather than
 * the `To github.com:…` a refused push starts with; else the first `fatal:` or `error:`; else the first line that is
 * not a hint. The whole output goes to the log.
 */
export function gitLine(error: unknown): string {
  const lines = rawText(error)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return (
    lines.find((line) => /^!\s*\[/.test(line)) ??
    lines.find((line) => /^(?:fatal|error):/i.test(line)) ??
    lines.find((line) => !/^(?:hint:|To\s)/.test(line)) ??
    lines[0] ??
    ""
  );
}

export interface GitProblem {
  title: string;
  next: string;
  /** Git's telling line, shown under the title in the code font. */
  line: string;
  /**
   * What is left to do is done in a terminal: the problem offers to open one in the folder, which closes the window.
   * Never after a failed commit: the message being written would go with the window.
   */
  terminal: boolean;
}

/** What failed, in the window's words, and what to do next: the refusal when git's words tell it, else the action's own. */
export function gitProblem(doing: GitDoing, error: unknown): GitProblem {
  const t = messages(gitMessages).problem;
  const refusal = gitRefusal(error);
  const said = (title: string, next: string, terminal = false): GitProblem => ({ title, next, line: gitLine(error), terminal });
  if (refusal === "notRepo") return said(t.notRepo, t.notRepoNext, true);
  if (refusal === "locked") return said(t.locked, t.lockedNext);
  switch (doing.what) {
    case "read":
      return said(t.read, t.readNext);
    case "diff":
      return said(t.diff(doing.path), t.readNext);
    case "history":
      return said(t.history, t.readNext);
    case "branches":
      return said(t.branches, t.branchesNext);
    case "push":
      return refusal === "rejected" ? said(t.rejected(doing.target), t.rejectedNext, true) : said(t.push(doing.target), t.pushNext, true);
    case "switch":
      return refusal === "overwritten" ? said(t.overwritten(doing.branch), t.overwrittenNext) : said(t.switch(doing.branch), t.switchNext);
    case "commit":
      return refusal === "identity" ? said(t.identity, t.identityNext) : said(t.commit, t.commitNext);
    case "discard":
      return said(t.discard(doing.path), t.discardNext);
  }
}
