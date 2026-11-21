import { describe, expect, it, vi } from "vitest";

// Slow under the load of the full suite: this file's tests get their own timeout.
vi.setConfig({ testTimeout: 30_000 });
import { sourceFiles } from "./cssBlocks";

/**
 * The rules chrome.test.ts and panels.test.ts kept to their folders, over every file of src: the drift gathered
 * where they did not look (the terminal, note, sub-agent, Fleet and foot nodes, the canvas's own controls, the
 * notifications, the radial ring, lib, the launch menu). Motion's own sweep is in motion.test.ts.
 */
const files = Object.entries(sourceFiles());
/** Every component and class table: `.ts` files carry class strings too (a row's classes, a step's look). */
const code = files.filter(([file]) => /\.tsx?$/.test(file));
/** Every component. */
const components = code.filter(([file]) => file.endsWith(".tsx"));

/** One file of each place the folder scopes left out: an empty sweep must not pass. */
const ONCE_LEFT_OUT = [
  "nodes/terminal/TerminalNode.tsx",
  "nodes/note/NoteNode.tsx",
  "nodes/subagent/SubagentNode.tsx",
  "nodes/fleet/FleetNode.tsx",
  "nodes/foot/StatusLine.tsx",
  "canvas/Canvas.tsx",
  "notifications/NotificationPanel.tsx",
  "radial/RadialMenu.tsx",
  "lib/errorToast.tsx",
  "agents/AgentMenu.tsx",
];

it("sweeps every component of src, the places the folder scopes left out included", () => {
  expect(components.length).toBeGreaterThan(150);
  expect(code.length).toBeGreaterThan(components.length);
  expect(components.map(([file]) => file)).toEqual(expect.arrayContaining(ONCE_LEFT_OUT));
});

describe("the design rules every file keeps (docs/design-system.md)", () => {
  it("writes radii on the scale, never a pixel value", () => {
    for (const [file, text] of code) {
      expect(text.match(/\brounded-\[\d+(\.\d+)?px\]|\brounded-\[min\(/g) ?? [], `${file}: a hard-coded radius`).toEqual([]);
    }
  });

  it("keeps headings at weight 600 at most, and never resizes the section label", () => {
    for (const [file, text] of code) {
      expect(text.match(/\bfont-(bold|extrabold|black)\b/g) ?? [], `${file}: weight 700`).toEqual([]);
      expect(text.match(/\bdp-label[^"'`]*\b(text-(xs|sm|base|\(length)|font-(normal|semibold))/g) ?? [], `${file}: a .dp-label resized`).toEqual([]);
    }
  });

  it("uses the palette's tokens only: no raw hex in a component, no black or white anywhere", () => {
    // Components only: the `.ts` files hold the values the tokens are made of (app/theme.ts, the terminal themes,
    // the agents' and roles' tints, the pens, the syntax hues).
    for (const [file, text] of components) {
      expect(text.match(/["'`(]#[0-9a-fA-F]{3,8}\b/g) ?? [], `${file}: a raw hex colour`).toEqual([]);
    }
    for (const [file, text] of code) {
      expect(text.match(/\b(bg|text|border|ring|fill|stroke)-(black|white)\b/g) ?? [], `${file}: black or white`).toEqual([]);
    }
  });
});

/**
 * A partial opacity in a class string (`opacity-50`, `hover:opacity-80`, `opacity-[0.4]`) behind no disabled variant:
 * text faded that way fell to 2.4:1 to 3.6:1 (card 1 of the design audit), so a quieter state takes a quieter ink.
 * `opacity-0` and `opacity-100` show and hide; `disabled:`, `data-disabled:`, `group-disabled/…:` and the like may fade.
 */
function fades(classes: string): string[] {
  return classes.split(/\s+/).filter((token) => {
    const m = /^!?(?<variants>.*:)?opacity-(?<value>\d+|\[[^\]]+\]|\([^)]+\))!?$/.exec(token);
    if (!m) return false;
    if (m.groups!.value === "0" || m.groups!.value === "100") return false;
    return !(m.groups!.variants ?? "").includes("disabled");
  });
}

/** The fades that are not words to read, how many each file has, and why each may stay. */
const FADES_ALLOWED: Record<string, { count: number; reason: string }> = {
  "agents/RemoteButton.tsx": { count: 1, reason: "Remote Control's phone while it connects: an icon alone, no words" },
  "git/GitWindow.tsx": { count: 1, reason: "the branch while git switches it: a second's busy cue, its only one, the menu shut meanwhile" },
  "nodes/kanban/KanbanNode.tsx": { count: 1, reason: "the card a drag lifts: the pointer holds it, the faded copy marks where it came from" },
  "radial/RadialMenu.tsx": { count: 1, reason: "a wedge that cannot run (aria-disabled): the kit's disabled fade, its reason in the hub in text-3" },
};

describe("no words faded by opacity (card 1 of the design audit)", () => {
  it("fades no text with opacity outside a disabled variant: a quieter state takes a quieter ink", () => {
    const found: Record<string, string[]> = {};
    for (const [file, text] of code) {
      // Class strings are double-quoted; a comment that names a fade is not one.
      const hits = (text.match(/"[^"\n]*"/g) ?? []).flatMap((literal) => fades(literal.slice(1, -1)));
      if (hits.length > 0) found[file] = hits;
    }
    const counts = Object.fromEntries(Object.entries(found).map(([file, hits]) => [file, hits.length]));
    expect(counts, JSON.stringify(found, null, 2)).toEqual(Object.fromEntries(Object.entries(FADES_ALLOWED).map(([file, { count }]) => [file, count])));
  });

  it("tells a fade from a show, a hide and a disabled control", () => {
    for (const classes of ["opacity-50", "text-xs opacity-70", "aria-busy:opacity-60", "hover:opacity-80", "opacity-[0.4]", "opacity-60!"]) {
      expect(fades(classes), classes).toHaveLength(1);
    }
    for (const classes of [
      "opacity-0 group-hover:opacity-100",
      "focus-visible:opacity-100 data-[state=open]:opacity-100",
      "disabled:opacity-50",
      "data-disabled:opacity-50",
      "group-disabled/button:opacity-50",
      "peer-disabled:opacity-50 group-data-[disabled=true]:opacity-50",
      "transition-[border-color,opacity]",
      "data-disabled:opacity-100",
    ]) {
      expect(fades(classes), classes).toEqual([]);
    }
  });
});

it("floats no hint over the command band: the first-use tip is the empty field's placeholder (card 3 of the design audit)", () => {
  for (const [file, text] of code) {
    expect(/\bCommandHint\b|\bhideHint\b|Hide the tip/.test(text), `${file}: a floating hint`).toBe(false);
  }
  // The tip's dismissal is kept where it is defined and read where the placeholder is chosen, nowhere else.
  expect(code.filter(([, text]) => /\bHINT_KEY\b/.test(text)).map(([file]) => file).sort()).toEqual(["agents/history.ts", "shell/CommandBar.tsx"]);
});
