import { expect, it } from "vitest";
import { sourceFiles } from "@/theme/cssBlocks";
import { accountsMessages } from "./messages";

it("shows the folder's example with its backslashes (P2-54)", () => {
  expect(accountsMessages.folderPlaceholder).toBe(String.raw`C:\Users\me\.claude-work`);
});

/** The escapes a string literal means: any other backslash vanishes when the file is parsed. */
const KNOWN = new Set(["n", "r", "t", "b", "f", "v", "0", "x", "u", "\\", '"', "'", "`", "$", "{", "\n", "\r"]);

it("writes no lone backslash in the interface's copy: `\\U` or `\\.` would silently drop it", () => {
  const lone: string[] = [];
  for (const [path, text] of Object.entries(sourceFiles())) {
    if (!path.endsWith("messages.ts")) continue;
    // A pair at a time, so that `\\` is read as one escaped backslash.
    for (const match of text.matchAll(/\\([\s\S])/g)) if (!KNOWN.has(match[1])) lone.push(`${path}: \\${match[1]}`);
  }
  expect(lone).toEqual([]);
});
