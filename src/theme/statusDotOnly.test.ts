import { expect, it } from "vitest";
import { sourceFiles } from "./cssBlocks";

/**
 * The round 6–8px dot is the signature of an agent (docs/design/unslop-direction.md): StatusDot draws it,
 * nothing else does. A group or a role is a bar (RoleMark), a step a segment (STEP_LOOK), unread a weight,
 * unsaved a word or a pencil (src/components/marks.tsx).
 */
const DOT = /(?<![\w-])size-(?:1\.5|2)(?![\w.-]).*(?<![\w-])rounded-full(?![\w-])|(?<![\w-])rounded-full(?![\w-]).*(?<![\w-])size-(?:1\.5|2)(?![\w.-])/;

/** Its own file: StatusDot's size and its shapes stand on different lines. */
const STATUS_DOT = "nodes/terminal/StatusDot.tsx";

/** The round dots that are not about an agent, how many each file has, and why each may stay. */
const ALLOWED: Record<string, { count: number; reason: string }> = {
  "openui/charts.tsx": { count: 1, reason: "a line chart's data points, drawn over its plot" },
  "shell/SettingsMenu.tsx": { count: 1, reason: "a palette's swatch: its accent on its canvas, inside a 16px tile" },
  "shell/TokensView.tsx": { count: 2, reason: "the token chart's legend keys, beside their words" },
};

it("draws the round 8px dot for agents alone: StatusDot, and the allowed swatches, chart and legend dots", () => {
  const found: Record<string, string[]> = {};
  for (const [file, text] of Object.entries(sourceFiles())) {
    if (file === STATUS_DOT) continue;
    const dots = text.split("\n").filter((line) => DOT.test(line));
    if (dots.length > 0) found[file] = dots.map((line) => line.trim());
  }
  const counts = Object.fromEntries(Object.entries(found).map(([file, lines]) => [file, lines.length]));
  expect(counts, JSON.stringify(found, null, 2)).toEqual(Object.fromEntries(Object.entries(ALLOWED).map(([file, { count }]) => [file, count])));
});

it("tells a dot from what is not one", () => {
  for (const line of ['className="size-2 rounded-full"', 'className="mt-1.5 size-2 shrink-0 rounded-full bg-dp-accent"', 'className="rounded-full size-1.5"']) {
    expect(DOT.test(line), line).toBe(true);
  }
  for (const line of ['className="size-2.5 rounded-full"', 'className="size-20 rounded-full"', 'className="size-2 rounded-xs"', 'className="h-0.5 w-3 rounded-full"', 'className="max-size-2 rounded-full-x"']) {
    expect(DOT.test(line), line).toBe(false);
  }
});
