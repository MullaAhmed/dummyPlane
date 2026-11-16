import { describe, expect, it, vi } from "vitest";

// Slow under the load of the full suite: this file's tests get their own timeout.
vi.setConfig({ testTimeout: 30_000 });
import { blend, contrast, oklabDistance } from "./colorMath";
import { cssBlock, readSource, sourceFiles } from "./cssBlocks";
import { displayColorFor } from "./sceneColors";
import { PALETTES as SCHEMES, type ThemeChoice } from "@/app/theme";
import { BAR_TOKEN, GROUND_TOKENS, PROGRESS_TOKEN, SERIES_HUES, TEXT_TOKENS, TONES, TONE_SOFT, TONE_SOFT_ALPHA, TONE_TEXT, TONE_TOKEN } from "@/openui/tones";
import { SYNTAX_HUES } from "@/studio/syntaxHues";
import { TOAST_CLASSES, TOAST_TONES } from "@/components/ui/sonner";
import { NEUTRAL_EDGE, PART_COLOR } from "@/openui/charts";

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

describe("selected text in the canvas's own editors reads as shown, after the dark theme's filter", () => {
  const excalidraw = readSource("theme/excalidraw.css");
  /** The block that carries each palette's pair: a dark palette's sits under `.theme--dark`, where Excalidraw's filter runs. */
  const BLOCKS: Record<ThemeChoice, string> = {
    calm: ':root[data-palette="calm"] .excalidraw.excalidraw',
    electric: ':root[data-palette="electric"] .excalidraw.excalidraw.theme--dark',
    expressive: ":root .excalidraw.excalidraw.theme--dark",
  };
  const OPAQUE_HEX = /^#[0-9a-f]{6}$/i;

  /** The fill and the ink of the editor's selection, as stored and as the screen shows them (through the filter where there is one). */
  const editorSelection = (palette: ThemeChoice) => {
    const block = cssBlock(excalidraw, BLOCKS[palette]);
    const stored = { fill: block["--editor-selection"], ink: block["--editor-selection-ink"] };
    const { scheme } = SCHEMES[palette];
    return { stored, scheme, fill: displayColorFor(stored.fill, scheme), ink: displayColorFor(stored.ink, scheme) };
  };

  it("stores an opaque pair per palette, pre-inverted exactly where the palette's scheme is dark", () => {
    for (const palette of Object.keys(BLOCKS) as ThemeChoice[]) {
      const { stored, scheme, fill, ink } = editorSelection(palette);
      expect(BLOCKS[palette].includes(".theme--dark"), `${palette}'s block is the filtered one`).toBe(SCHEMES[palette].scheme === "dark");
      expect(stored.fill, `${palette} fill`).toMatch(OPAQUE_HEX);
      expect(stored.ink, `${palette} ink`).toMatch(OPAQUE_HEX);
      // Stored as shown, the dark palettes' ink (near-white) would come out near-black, the bug itself.
      if (scheme === "dark") expect(contrast(stored.ink, ink), `${palette} stored ink against shown`).toBeGreaterThan(10);
      else expect([fill, ink]).toEqual([stored.fill, stored.ink]);
    }
  });

  it("writes the ink on the fill at 4.5:1 as shown, the fill at the 99 % alpha the rule gives it, over the canvas", () => {
    for (const palette of Object.keys(BLOCKS) as ThemeChoice[]) {
      const t = cssBlock(tokens, PALETTES[palette]);
      const { fill, ink } = editorSelection(palette);
      expect(contrast(ink, fill), `${palette} ink on the fill`).toBeGreaterThanOrEqual(4.5);
      // The filter keeps a color's alpha: the 99 % fill lets 1 % of the canvas through.
      expect(contrast(ink, blend(t["--dp-canvas"], fill, 0.99)), `${palette} ink on the fill at 99 %`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("shows a fill that stands out from the canvas as much as a selected row's tint, in the app's own selection look", () => {
    for (const palette of Object.keys(BLOCKS) as ThemeChoice[]) {
      const t = cssBlock(tokens, PALETTES[palette]);
      const { fill, ink } = editorSelection(palette);
      const canvas = t["--dp-canvas"];
      expect(contrast(fill, canvas), `${palette} fill against the canvas`).toBeGreaterThanOrEqual(contrast(over(canvas, t["--dp-accent-soft"]), canvas));
      // The ink the filter reaches is at most #ededed: near the palette's ink, not equal. Electric's saturated blue is
      // out of the filter's reach too, so its tint shows duller (#5163b9 for #4759f4, 0.096); the others are all but exact.
      expect(oklabDistance(ink, t["--dp-text"]), `${palette} ink against the ink`).toBeLessThan(0.03);
      expect(oklabDistance(fill, over(canvas, t["--dp-selection"])), `${palette} fill against the app's selection`).toBeLessThan(palette === "electric" ? 0.12 : 0.02);
    }
  });

  it("paints the text editors' ::selection with that pair, and a note's with the app's own", () => {
    const bare = excalidraw.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => m[1].includes("::selection"))
      .map((m) => ({ selectors: m[1].split(",").map((s) => s.trim()), body: m[2] }));
    const editors = rules.find((r) => r.selectors.includes(".excalidraw .excalidraw-wysiwyg::selection"));
    expect(editors?.selectors, "the textarea of a text, a label, a note on the canvas, and a frame's name input").toEqual([
      ".excalidraw .excalidraw-wysiwyg::selection",
      '.excalidraw [id*="-frame-name-"] input::selection',
    ]);
    // 99 %, never a fully opaque fill: a browser may draw that one translucent, in another shade; an alpha is left as written.
    expect(editors!.body).toMatch(/background:\s*color-mix\(in srgb, var\(--editor-selection\) 99%, transparent\);/);
    expect(editors!.body).toMatch(/color:\s*var\(--editor-selection-ink\);/);
    // The quick note is DOM in an embeddable, outside the filter: the app's selection, which index.css withholds under `.excalidraw`.
    const note = rules.find((r) => r.selectors.includes(".excalidraw [data-note] *::selection"));
    expect(note, "a note's text takes the app's selection").toBeDefined();
    expect(note!.body).toMatch(/background:\s*var\(--dp-selection\);/);
    expect(note!.body).toMatch(/color:\s*var\(--dp-text\);/);
    expect(readSource("nodes/note/NoteNode.tsx")).toContain("data-note={nodeId}");
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

  it("draws each tone's text and tint in that very token, the tint at its measured alpha", () => {
    for (const tone of TONES) {
      const name = TONE_TOKEN[tone].slice(2);
      expect([TONE_TEXT[tone], TONE_SOFT[tone]]).toEqual([`text-${name}`, `bg-${name}/${Math.round(TONE_SOFT_ALPHA * 100)}`]);
    }
  });

  it("writes text and the tone's own ink at 4.5:1 on a callout's or a badge's tint, over each of its grounds", () => {
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      for (const tone of TONES) {
        for (const ground of GROUND_TOKENS) {
          const tint = blend(t[ground], t[TONE_TOKEN[tone]], TONE_SOFT_ALPHA);
          for (const ink of ["--dp-text", TONE_TOKEN[tone]]) {
            expect(contrast(t[ink], tint), `${palette} ${ink} on ${tone}'s tint over ${ground}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
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

  it("draws a Breakdown's toned parts in the tones' inks, and edges its light neutral part at 3:1", () => {
    for (const tone of TONES.filter((tone) => tone !== "neutral")) expect(PART_COLOR[tone]).toBe(`var(${TONE_TOKEN[tone]})`);
    expect(PART_COLOR.neutral).toContain(`var(${NEUTRAL_EDGE})`);
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      for (const ground of GROUND_TOKENS) expect(contrast(t[NEUTRAL_EDGE], t[ground]), `${palette} neutral edge on ${ground}`).toBeGreaterThanOrEqual(3);
    }
    expect(sourceFiles()["openui/charts.tsx"]).toContain("boxShadow: `inset 0 0 0 1px var(${NEUTRAL_EDGE})`");
  });

  it("draws with exactly those tokens: the charts' bars and the progress fill name them", () => {
    const sources = sourceFiles();
    expect(sources["openui/charts.tsx"]).toContain(`fill-${BAR_TOKEN.slice(2)}`);
    expect(sources["openui/parts.tsx"]).toContain(`bg-${PROGRESS_TOKEN.slice(2)}`);
  });
});

describe("toasts: every type, the description, the detail and the buttons read in every palette (Alerts)", () => {
  /** The token a class names: `text-dp-ok` → `--dp-ok`, `hover:bg-dp-hover` → `--dp-hover`. */
  const token = (classes: string, prefix: string) => {
    const match = new RegExp(`(?:^|\\s)${prefix}dp-([\\w-]+)(?=\\s|$)`).exec(classes);
    expect(match, `${prefix}dp-… in "${classes}"`).not.toBeNull();
    return `--dp-${match![1]}`;
  };
  /** The detail line of an error toast (lib/errorToast.tsx): its class string. */
  const detail = /className="([^"]*font-mono[^"]*)"/.exec(readSource("lib/errorToast.tsx"))![1];

  it("writes the title, the description and an error's detail at 4.5:1 on the toast's surface", () => {
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      for (const [part, classes] of [["title", TOAST_CLASSES.title], ["description", TOAST_CLASSES.description], ["detail", detail]]) {
        expect(contrast(t[token(classes, "text-")], t["--dp-surface"]), `${palette} toast ${part}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("draws each type's icon in a status colour that reads at 4.5:1 on the surface, a tone of its own", () => {
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      const tones = Object.entries(TOAST_TONES).map(([type, classes]) => [type, token(classes, "text-")] as const);
      for (const [type, tone] of tones) {
        expect(contrast(t[tone], t["--dp-surface"]), `${palette} ${type} icon`).toBeGreaterThanOrEqual(4.5);
      }
      // The four types that tell something have four tones (the loader is the quiet text).
      expect(new Set(tones.filter(([type]) => type !== "loading").map(([, tone]) => t[tone])).size, palette).toBe(4);
    }
  });

  it("writes the action and the cancel at 4.5:1 on their fill, at rest and under the pointer", () => {
    for (const [palette, selector] of Object.entries(PALETTES)) {
      const t = cssBlock(tokens, selector);
      const surface = t["--dp-surface"];
      const hover = over(surface, t[token(TOAST_CLASSES.actionButton, "hover:bg-")]);
      // The action: the outline button, its own surface fill.
      const action = TOAST_CLASSES.actionButton;
      const fill = t[token(action, "bg-")];
      expect(contrast(t[token(action, "text-")], fill), `${palette} action`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[token(action, "hover:text-")], hover), `${palette} action, pointed at`).toBeGreaterThanOrEqual(4.5);
      // The cancel: the ghost, a step quieter, on the toast's surface.
      const cancel = TOAST_CLASSES.cancelButton;
      expect(contrast(t[token(cancel, "text-")], surface), `${palette} cancel`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[token(cancel, "hover:text-")], over(surface, t[token(cancel, "hover:bg-")])), `${palette} cancel, pointed at`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
