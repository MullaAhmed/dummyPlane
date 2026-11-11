import { describe, expect, it, vi } from "vitest";

// Slow under the load of the full suite: this file's tests get their own timeout.
vi.setConfig({ testTimeout: 30_000 });
import { blend, contrast } from "./colorMath";
import { cssBlock, readSource, sourceFiles } from "./cssBlocks";
import { BAR_TOKEN, GROUND_TOKENS, PROGRESS_TOKEN, SERIES_HUES, TEXT_TOKENS, TONES, TONE_BORDER, TONE_RULE, TONE_TEXT, TONE_TOKEN } from "@/openui/tones";
import { SYNTAX_HUES } from "@/studio/syntaxHues";

const tokens = readSource("theme/tokens.css");

const PALETTES = {
  calm: ':root[data-palette="calm"]',
  electric: ':root[data-palette="electric"]',
  expressive: ':root, :root[data-palette="expressive"]',
};

it("writes on role colors with one dark ink, the same in every palette", () => {
  // Role colors do not change with the palette; the canvas colors would read at 2:1 on them.
  for (const selector of Object.values(PALETTES)) {
    expect(cssBlock(tokens, selector)["--dp-on-role"]).toBe("#1F1E1D");
  }
});

it("keeps text readable at WCAG AA (4.5:1) on the canvas, the surfaces and the cards, in each palette", () => {
  for (const [palette, selector] of Object.entries(PALETTES)) {
    const t = cssBlock(tokens, selector);
    for (const ink of ["--dp-text", "--dp-text-2", "--dp-text-3"]) {
      for (const bg of ["--dp-canvas", "--dp-surface", "--dp-card"]) {
        expect(contrast(t[ink], t[bg]), `${palette} ${ink} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

it("writes on the accent at 4.5:1, and reads the accent as text through its ink variant", () => {
  for (const [palette, selector] of Object.entries(PALETTES)) {
    const t = cssBlock(tokens, selector);
    expect(contrast(t["--dp-on-accent"], t["--dp-accent"]), `${palette} on-accent on accent`).toBeGreaterThanOrEqual(4.5);
    for (const bg of ["--dp-canvas", "--dp-surface", "--dp-card"]) {
      expect(contrast(t["--dp-accent-ink"], t[bg]), `${palette} accent-ink on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it("keeps the functional colors (wait, ok, danger) readable as text on the canvas", () => {
  for (const [palette, selector] of Object.entries(PALETTES)) {
    const t = cssBlock(tokens, selector);
    for (const role of ["--dp-wait", "--dp-ok", "--dp-danger"]) {
      expect(contrast(t[role], t["--dp-canvas"]), `${palette} ${role} on canvas`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it("never inks with the canvas color, nor with an agent's raw tint", () => {
  for (const [file, text] of Object.entries(sourceFiles())) {
    expect(/text-dp-canvas/.test(text), `${file} : texte couleur du canvas`).toBe(false);
    expect(/color:\s*(meta|AGENTS\[[^\]]+\])\.tint\b/.test(text), `${file} : teinte brute en couleur de texte`).toBe(false);
  }
});

/** An `rgba(r,g,b,a)` token over an opaque ground, composited as the browser does. */
function over(ground: string, value: string): string {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(value);
  if (!m) throw new Error(`not an rgba token: ${value}`);
  const top = "#" + m.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  return blend(ground, top, Number(m[4]));
}

/** The value of a `var(--dp-…)` in `t`, or the hex itself. */
const resolve = (t: Record<string, string>, value: string) => t[/^var\((--dp-[\w-]+)\)$/.exec(value)?.[1] ?? ""] ?? value;

it("writes the waiting count on its wait fill at 4.5:1 in every palette, with the rail pip's own classes (P1-13)", () => {
  const rail = readSource("shell/ActivityRail.tsx");
  // The pip's class string: the first className after data-pip, whatever attributes come between.
  const at = rail.indexOf("data-pip");
  expect(at, "the rail draws its waiting pip").toBeGreaterThanOrEqual(0);
  const pip = /className="([^"]*)"/.exec(rail.slice(at))![1];
  const fill = /(?:^|\s)bg-dp-([\w-]+)(?=\s|$)/.exec(pip)![1];
  const ink = /(?:^|\s)text-dp-([\w-]+)(?=\s|$)/.exec(pip)![1];
  expect([fill, ink]).toEqual(["wait", "on-wait"]);
  // index.css hands the token to Tailwind, or text-dp-on-wait would draw nothing.
  expect(cssBlock(readSource("index.css"), "@theme inline")["--color-dp-on-wait"]).toBe("var(--dp-on-wait)");
  for (const [palette, selector] of Object.entries(PALETTES)) {
    const t = cssBlock(tokens, selector);
    expect(contrast(t[`--dp-${ink}`], t[`--dp-${fill}`]), `${palette} ${ink} on ${fill}`).toBeGreaterThanOrEqual(4.5);
  }
  // The audit's number: the role ink read 2.46:1 on calm's wait.
  const calm = cssBlock(tokens, PALETTES.calm);
  expect(contrast(calm["--dp-on-role"], calm["--dp-wait"])).toBeCloseTo(2.46, 2);
});

describe("a control's own boundary reaches 3:1, where a divider's hairline does not (P2-24)", () => {
  it("composites like the audit measured: the hairline 1.18-1.25:1 on the surface", () => {
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      const ratio = contrast(over(t["--dp-surface"], t["--dp-line"]), t["--dp-surface"]);
      expect(ratio, `${palette} line on surface`).toBeGreaterThan(1.1);
      expect(ratio, `${palette} line on surface`).toBeLessThan(1.3);
    }
  });

  it("draws --dp-line-strong at 3:1 or more on every ground a field sits on, the selection's tint included", () => {
    expect(cssBlock(readSource("index.css"), "@theme inline")["--color-dp-line-strong"]).toBe("var(--dp-line-strong)");
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      const grounds: Record<string, string> = { canvas: t["--dp-canvas"], surface: t["--dp-surface"], card: t["--dp-card"], head: t["--dp-terminal-head"] };
      grounds.tint = over(t["--dp-surface"], t["--dp-accent-soft"]);
      for (const [ground, hex] of Object.entries(grounds)) {
        expect(contrast(over(hex, t["--dp-line-strong"]), hex), `${palette} line-strong on the ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("bounds Input, Textarea and the Select trigger with it, never with the divider's hairline", () => {
    for (const [file, slot] of [["components/ui/input.tsx", "input"], ["components/ui/textarea.tsx", "textarea"], ["components/ui/select.tsx", "select-trigger"]]) {
      const text = readSource(file);
      const classes = /"([^"]*)"/.exec(text.slice(text.indexOf("className", text.indexOf(`data-slot="${slot}"`))))![1];
      expect(classes, file).toMatch(/(?:^|\s)border-dp-line-strong(?=\s|$)/);
      expect(classes, file).not.toMatch(/(?:^|\s)border-dp-line(?=\s|$)/);
    }
  });
});

describe("selected text is themed from the palette and stays readable (P2-26)", () => {
  it("writes the ink on the selection's tint at 4.5:1 on the canvas, the surfaces, the cards and a terminal's head, the tint still seen", () => {
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      for (const ground of ["--dp-canvas", "--dp-surface", "--dp-card", "--dp-terminal-head"]) {
        const tint = over(t[ground], t["--dp-selection"]);
        expect(contrast(t["--dp-text"], tint), `${palette} text on the selection over ${ground}`).toBeGreaterThanOrEqual(4.5);
        // At least as visible as the selected row's tint (--dp-accent-soft).
        expect(contrast(tint, t[ground]), `${palette} selection against ${ground}`).toBeGreaterThanOrEqual(contrast(over(t[ground], t["--dp-accent-soft"]), t[ground]));
      }
    }
  });

  it("paints ::selection with it, and leaves xterm, the code editor and Excalidraw their own", () => {
    const rule = /:not\(([^)]*)\)::selection\s*\{([^}]*)\}/.exec(readSource("index.css"));
    expect(rule, "index.css themes ::selection").not.toBeNull();
    // A terminal's body too: its text is in the terminal theme's inks, light on calm's dark green, where the ink would vanish.
    expect(rule![1].split(",").map((s) => s.trim()).sort()).toEqual([".bg-dp-terminal *", ".cm-editor *", ".excalidraw *", ".xterm *"]);
    expect(rule![2]).toMatch(/background:\s*var\(--dp-selection\);/);
    expect(rule![2]).toMatch(/color:\s*var\(--dp-text\);/);
  });
});

describe("text on a selected row (the accent's tint) keeps 4.5:1 (P1-14)", () => {
  const index = readSource("index.css");
  /** The selection's tint over the grounds a selected row sits on: the panels and menus, the cards. */
  const tints = (t: Record<string, string>) => ({ surface: over(t["--dp-surface"], t["--dp-accent-soft"]), card: over(t["--dp-card"], t["--dp-accent-soft"]) });

  it("composites like the audit measured: text-3 on the tint 4.44 in calm, 4.24 in expressive; danger 4.06 in expressive", () => {
    const calm = cssBlock(tokens, PALETTES.calm);
    const expressive = cssBlock(tokens, PALETTES.expressive);
    expect(contrast(calm["--dp-text-3"], tints(calm).surface)).toBeCloseTo(4.44, 1);
    expect(contrast(expressive["--dp-text-3"], tints(expressive).surface)).toBeCloseTo(4.24, 1);
    expect(contrast(expressive["--dp-danger"], tints(expressive).surface)).toBeCloseTo(4.06, 1);
  });

  it("steps a selected row's tertiary text up to a role that reads on the tint, every text-3 inside included", () => {
    const lift = cssBlock(index, "@utility dp-on-soft");
    expect(Object.keys(lift)).toEqual(["--dp-text-3"]);
    // @theme inline writes text-dp-text-3 as var(--dp-text-3), read at the element: the row's own value reaches its children.
    expect(cssBlock(index, "@theme inline")["--color-dp-text-3"]).toBe("var(--dp-text-3)");
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      const ink = resolve(t, lift["--dp-text-3"]);
      for (const [ground, tint] of Object.entries(tints(t))) {
        expect(contrast(ink, tint), `${palette} lifted text-3 on the tint over the ${ground}`).toBeGreaterThanOrEqual(4.5);
        for (const role of ["--dp-text", "--dp-text-2"]) expect(contrast(t[role], tint), `${palette} ${role} on the tint over the ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("writes danger on the tint a step toward the ink, at 4.5:1; ok and wait read there as they are", () => {
    const mix = /^color-mix\(in srgb, var\((--dp-[\w-]+)\) (\d+)%, var\((--dp-[\w-]+)\)\)$/.exec(cssBlock(tokens, ":root")["--dp-danger-on-soft"]);
    expect(mix, "--dp-danger-on-soft is danger mixed toward the ink").not.toBeNull();
    expect([mix![1], mix![3]]).toEqual(["--dp-danger", "--dp-text"]);
    expect(cssBlock(index, "@theme inline")["--color-dp-danger-on-soft"]).toBe("var(--dp-danger-on-soft)");
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      const danger = blend(t[mix![3]], t[mix![1]], Number(mix![2]) / 100);
      for (const [ground, tint] of Object.entries(tints(t))) {
        expect(contrast(danger, tint), `${palette} danger-on-soft on the tint over the ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
      // A selected git row's + count and A/N letter: on the tint over the panel's surface.
      for (const role of ["--dp-ok", "--dp-wait"]) expect(contrast(t[role], tints(t).surface), `${palette} ${role} on the tint`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("turns the lift on in every selected row that holds tertiary text or a danger count", () => {
    const rows: [string, string][] = [
      ["commands/Palette.tsx", "data-[selected=true]:bg-dp-accent-soft data-[selected=true]:dp-on-soft"], // palette and Go to rows
      ["agents/AgentsPanel.tsx", 'variant="choice"'], // the filter: the Toggle's choice look, on the tint when chosen…
      ["components/ui/toggle.tsx", "data-[state=on]:bg-dp-accent-soft data-[state=on]:text-dp-text"],
      ["agents/AgentsPanel.tsx", 'className="gap-1 px-2 data-[state=on]:dp-on-soft"'], // …and its count lifted there
      ["notes/NotesWorkspace.tsx", '"bg-dp-accent-soft hover:bg-dp-accent-soft dp-on-soft"'], // the note's excerpt
      ["git/GitWindow.tsx", 'current && "bg-dp-accent-soft text-dp-text hover:bg-dp-accent-soft dp-on-soft"'], // the file row
      ["git/GitWindow.tsx", 'const danger = current ? "text-dp-danger-on-soft" : "text-dp-danger";'],
      ["studio/CodeWorkspace.tsx", 'node.path === active && "bg-dp-accent-soft text-dp-text hover:bg-dp-accent-soft dp-on-soft"'], // the file tree
    ];
    for (const [file, row] of rows) expect(readSource(file), file).toContain(row);
    // The git row writes its − count and D letter in that variable, never in danger itself.
    expect(readSource("git/GitWindow.tsx")).not.toContain('<span className="text-dp-danger">−');
  });
});

describe("an agent's generated output (src/openui) reads in every palette", () => {
  it("writes its text roles and its tones' inks at 4.5:1 on the output's surface and on a card", () => {
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      for (const ink of [...TEXT_TOKENS, ...Object.values(TONE_TOKEN)]) {
        for (const ground of GROUND_TOKENS) {
          expect(contrast(t[ink], t[ground]), `${palette} ${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("draws each tone's text, border and rule in that very token", () => {
    for (const tone of TONES) {
      const name = TONE_TOKEN[tone].slice(2);
      expect([TONE_TEXT[tone], TONE_BORDER[tone], TONE_RULE[tone]]).toEqual([`text-${name}`, `border-${name}`, `border-l-${name}`]);
    }
  });

  it("draws bars, progress and line series at 3:1 at least on its grounds, a graphic's floor", () => {
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      const hues = SYNTAX_HUES[palette as keyof typeof SYNTAX_HUES];
      for (const ground of GROUND_TOKENS) {
        expect(contrast(t[BAR_TOKEN], t[ground]), `${palette} bars on ${ground}`).toBeGreaterThanOrEqual(3);
        expect(contrast(t[PROGRESS_TOKEN], t[ground]), `${palette} progress on ${ground}`).toBeGreaterThanOrEqual(3);
        for (const hue of SERIES_HUES) expect(contrast(hues[hue], t[ground]), `${palette} ${hue} series on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("draws with exactly those tokens: the charts' bars and the progress fill name them", () => {
    const sources = sourceFiles();
    expect(sources["openui/charts.tsx"]).toContain(`fill-${BAR_TOKEN.slice(2)}`);
    expect(sources["openui/parts.tsx"]).toContain(`bg-${PROGRESS_TOKEN.slice(2)}`);
  });
});
