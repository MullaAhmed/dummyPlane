import { describe, expect, it, vi } from "vitest";

// Slow under the load of the full suite: this file's tests get their own timeout.
vi.setConfig({ testTimeout: 30_000 });
import { blend, contrast, oklabDistance } from "./colorMath";
import { cssBlock, readSource, sourceFiles } from "./cssBlocks";
import { displayColorFor } from "./sceneColors";
import { PALETTES as SCHEMES, type ThemeChoice } from "@/app/theme";
import { BAR_TOKEN, GROUND_TOKENS, PROGRESS_TOKEN, SERIES_HUES, TEXT_TOKENS, TONES, TONE_FILL, TONE_SOFT, TONE_SOFT_ALPHA, TONE_TEXT, TONE_TOKEN } from "@/openui/tones";
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

describe("a floating surface stacked on another has an edge of its own in the dark palettes (card 20)", () => {
  const DARK = Object.entries(PALETTES).filter(([palette]) => SCHEMES[palette as ThemeChoice].scheme === "dark");
  /** The rule index.css gives the edge: its selector list and its one declaration. */
  const edgeRule = () => {
    const bare = readSource("index.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /([^{}]+)\{\s*border-color:\s*var\(--dp-line-strong\);\s*\}/.exec(bare);
    expect(rule, "index.css draws the stacked surfaces' edge in --dp-line-strong").not.toBeNull();
    return rule![1].replace(/\s+/g, " ").trim();
  };

  it("draws the edge of menus, popovers, selects, dialogs and toasts in --dp-line-strong, under the dark scheme only", () => {
    const selector = edgeRule();
    for (const slot of ["dropdown-menu-content", "dropdown-menu-sub-content", "popover-content", "select-content", "dialog-content"]) {
      expect(selector, slot).toContain(`[data-slot="${slot}"]`);
    }
    expect(selector).toContain('[data-sonner-toaster] [data-sonner-toast][data-styled="true"]');
    // The two toasts the app draws itself (Sonner's data-styled is false for them) carry their own mark, and take the same edge.
    for (const mark of ["data-decision-toast", "data-resume-toast"]) expect(selector, mark).toContain(`[${mark}]`);
    expect(readSource("shell/DecisionToast.tsx")).toContain("data-decision-toast");
    expect(readSource("agents/ResumeAllToast.tsx")).toContain("data-resume-toast");
    // Each selector of the list is keyed on the scheme, which theme.ts writes: dark exactly for electric and expressive, calm keeps its hairline and its shadow.
    expect(selector.split(/,(?![^(]*\))/).every((part) => part.trim().startsWith(':root[data-theme="dark"] '))).toBe(true);
    expect(DARK.map(([palette]) => palette)).toEqual(["electric", "expressive"]);
    expect(SCHEMES.calm.scheme).toBe("light");
    expect(cssBlock(readSource("index.css"), "@theme inline")["--color-dp-line-strong"]).toBe("var(--dp-line-strong)");
  });

  it("reaches 1.5:1 against its own fill, the surface beneath, the canvas, the dialog's veiled ground, a card and a terminal's head, and 3:1 against its fill", () => {
    for (const [palette, selector] of DARK) {
      const t = cssBlock(tokens, selector);
      // A border is painted over its own element's fill (background-clip: border-box).
      const edge = over(t["--dp-surface"], t["--dp-line-strong"]);
      const grounds: Record<string, string> = { fill: t["--dp-surface"], canvas: t["--dp-canvas"], veil: over(t["--dp-canvas"], t["--dp-scrim"]), card: t["--dp-card"], head: t["--dp-terminal-head"] };
      for (const [ground, hex] of Object.entries(grounds)) {
        expect(contrast(edge, hex), `${palette} stacked edge against the ${ground}`).toBeGreaterThanOrEqual(1.5);
      }
      expect(contrast(edge, grounds.fill), `${palette} stacked edge against its fill`).toBeGreaterThanOrEqual(3);
    }
  });

  it("measures what the hairline left: the edge under 1.5:1 against the fill, and the fill itself 1.09:1 to 1.15:1 from the dialog's veiled ground", () => {
    for (const [palette, selector] of DARK) {
      const t = cssBlock(tokens, selector);
      const veil = over(t["--dp-canvas"], t["--dp-scrim"]);
      expect(contrast(over(t["--dp-surface"], t["--dp-line"]), t["--dp-surface"]), `${palette} the hairline's edge`).toBeLessThan(1.5);
      expect(contrast(t["--dp-surface"], veil), `${palette} the dialog's fill against the veiled ground`).toBeLessThan(1.2);
    }
    // The audit's numbers: the expressive dialog stands 1.09:1 from the ground behind the veil; the veil moves the canvas 1.03:1.
    const expressive = cssBlock(tokens, PALETTES.expressive);
    expect(contrast(expressive["--dp-surface"], over(expressive["--dp-canvas"], expressive["--dp-scrim"]))).toBeCloseTo(1.09, 2);
    expect(contrast(expressive["--dp-canvas"], over(expressive["--dp-canvas"], expressive["--dp-scrim"]))).toBeCloseTo(1.03, 2);
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

  it("draws with exactly those tokens: the charts' bars, the progress fill and a toned progress's fill name them", () => {
    const sources = sourceFiles();
    expect(sources["openui/charts.tsx"]).toContain(`const BAR = "bg-${BAR_TOKEN.slice(2)}"`);
    expect(sources["openui/parts.tsx"]).toContain(`bg-${PROGRESS_TOKEN.slice(2)}`);
    // A toned bar is its tone's ink, measured above as text (4.5:1), so past a graphic's 3:1.
    for (const tone of TONES) expect(TONE_FILL[tone]).toBe(`bg-${TONE_TOKEN[tone].slice(2)}`);
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

describe("states the opacity hid: each pair measured in every palette, composited the way the browser does (card 1 of the design audit)", () => {
  const index = readSource("index.css");
  const GROUNDS = ["--dp-canvas", "--dp-surface", "--dp-card", "--dp-terminal-head"];
  const each = (check: (palette: string, t: Record<string, string>) => void) => {
    for (const [palette, selector] of Object.entries(PALETTES)) check(palette, cssBlock(tokens, selector));
  };
  /** The class tokens of the first match's first group (a `className` string), as written in `file`. */
  const classesOf = (file: string, re: RegExp) => {
    const match = re.exec(readSource(file));
    expect(match, `${file}: ${re}`).not.toBeNull();
    return match![1].split(/\s+/);
  };
  /** The alpha, 0 to 1, a class of `classes` with this prefix writes (`bg-dp-danger/15` for `bg-dp-danger/`). */
  const alphaOf = (classes: string[], prefix: string) => {
    const found = classes.find((c) => c.startsWith(prefix));
    expect(found, `${prefix}… in ${classes.join(" ")}`).toBeDefined();
    return Number(found!.slice(prefix.length)) / 100;
  };
  /** --dp-danger-on-soft, danger a step toward the ink, as tokens.css mixes it. */
  const dangerOnSoft = (t: Record<string, string>) => {
    const mix = /^color-mix\(in srgb, var\((--dp-[\w-]+)\) (\d+)%, var\((--dp-[\w-]+)\)\)$/.exec(cssBlock(tokens, ":root")["--dp-danger-on-soft"])!;
    return blend(t[mix[3]], t[mix[1]], Number(mix[2]) / 100);
  };

  it("writes the usage meter's hint in text-3, at 4.5:1 on the title bar's surface and under the pointer, where opacity-70 read 3.4:1 to 4.3:1", () => {
    const hint = classesOf("shell/UsageMeter.tsx", /<span className="([^"]*)">· \{emptyHint\}<\/span>/);
    expect(hint).toEqual(["text-dp-text-3"]);
    expect(readSource("shell/TitleBar.tsx")).toContain("dp-glass-strong");
    each((palette, t) => {
      // The title bar is a dp-glass-strong: the surface. The button is a ghost, which fills with --dp-hover under the pointer.
      expect(contrast(t["--dp-text-3"], t["--dp-surface"]), `${palette} hint on the title bar`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["--dp-text-3"], over(t["--dp-surface"], t["--dp-hover"])), `${palette} hint under the pointer`).toBeGreaterThanOrEqual(4.5);
    });
    // What it read before, the button's text-2 at 70 % over the surface: the audit's 3.67:1 in calm and 4.27:1 in electric.
    for (const palette of ["calm", "electric"] as const) {
      const t = cssBlock(tokens, PALETTES[palette]);
      expect(contrast(blend(t["--dp-surface"], t["--dp-text-2"], 0.7), t["--dp-surface"]), `${palette} the old hint`).toBeLessThan(4.5);
    }
  });

  it("writes the tooltips' second lines (the folder, the live count) at 4.5:1 on the tooltip's inverse ground; text-3 is no ink there", () => {
    // The tooltip is bg-foreground text-background: the ink under the canvas colour, so the quiet line is the canvas colour at an alpha.
    expect(readSource("components/ui/tooltip.tsx")).toMatch(/bg-foreground[^"]*text-background/);
    expect(index).toMatch(/--background: var\(--dp-canvas\);/);
    expect(index).toMatch(/--foreground: var\(--dp-text\);/);
    const alphas: number[] = [];
    for (const file of ["shell/GitChip.tsx", "shell/WorkspaceTabs.tsx", "agents/LaunchFolderBar.tsx"]) {
      const source = readSource(file);
      expect(source, `${file} fades no hint line with opacity`).not.toMatch(/opacity-70/);
      const found = [...source.matchAll(/text-background\/(\d+)/g)].map((m) => Number(m[1]) / 100);
      expect(found.length, `${file} writes its hint's second line`).toBeGreaterThan(0);
      alphas.push(...found);
    }
    each((palette, t) => {
      for (const alpha of alphas) {
        expect(contrast(blend(t["--dp-text"], t["--dp-canvas"], alpha), t["--dp-text"]), `${palette} /${alpha * 100} on the tooltip`).toBeGreaterThanOrEqual(4.5);
      }
      // The card's own suggestion, for the record: text-3 on the tooltip's ground does not read in any palette.
      expect(contrast(t["--dp-text-3"], t["--dp-text"]), `${palette} text-3 on the tooltip`).toBeLessThan(4.5);
    });
    // The step below (/80) is what electric cannot carry: the alpha chosen is the least that holds.
    const electric = cssBlock(tokens, PALETTES.electric);
    expect(contrast(blend(electric["--dp-text"], electric["--dp-canvas"], 0.8), electric["--dp-text"])).toBeLessThan(4.5);
    // The audit's number: opacity-70 read 3.60:1 there.
    expect(contrast(blend(electric["--dp-text"], electric["--dp-canvas"], 0.7), electric["--dp-text"])).toBeCloseTo(3.6, 1);
  });

  it("rings a stopped agent's dot in text-3 at full strength: 3:1 on every ground, and still a step quieter than idle's text-2", () => {
    const look = (state: string) => classesOf("nodes/terminal/StatusDot.tsx", new RegExp(`\\n  ${state}: "([^"]*)"`));
    const stopped = look("stopped");
    expect(stopped).toContain("border-dp-text-3");
    expect(stopped.filter((c) => c.includes("opacity"))).toEqual([]);
    expect(look("idle")).toContain("border-dp-text-2");
    each((palette, t) => {
      for (const ground of GROUNDS) {
        const ring = contrast(t["--dp-text-3"], t[ground]);
        expect(ring, `${palette} stopped ring on ${ground}`).toBeGreaterThanOrEqual(3);
        expect(ring, `${palette} stopped ring quieter than idle's on ${ground}`).toBeLessThan(contrast(t["--dp-text-2"], t[ground]));
      }
    });
    // The audit's number: the ring at opacity-60 read 2.47:1 in calm.
    const calm = cssBlock(tokens, PALETTES.calm);
    expect(contrast(blend(calm["--dp-surface"], calm["--dp-text-3"], 0.6), calm["--dp-surface"])).toBeCloseTo(2.47, 1);
  });

  it("keeps a destructive button's label at 4.5:1 on its fill, at rest and under the pointer, on the surfaces and cards it sits on", () => {
    const classes = classesOf("components/ui/button.tsx", /destructive:\s*"([^"]*)"/);
    const rest = alphaOf(classes, "bg-dp-danger/");
    const hover = alphaOf(classes, "hover:bg-dp-danger/");
    expect(hover, "the pointer steps the fill up").toBeGreaterThan(rest);
    expect(classes).toContain("text-dp-danger");
    expect(classes).toContain("hover:text-dp-danger-on-soft");
    expect(cssBlock(index, "@theme inline")["--color-dp-danger-on-soft"]).toBe("var(--dp-danger-on-soft)");
    each((palette, t) => {
      // Dialogs, panels and the loops bar are surfaces; a board's card is a card. None is drawn straight on the canvas
      // (where electric's danger/10 reads 4.2:1 at rest, as it did before).
      for (const ground of ["--dp-surface", "--dp-card"]) {
        expect(contrast(t["--dp-danger"], blend(t[ground], t["--dp-danger"], rest)), `${palette} at rest on ${ground}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(dangerOnSoft(t), blend(t[ground], t["--dp-danger"], hover)), `${palette} under the pointer on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    // The audit's number: danger itself on danger/20 in expressive, the default palette.
    const expressive = cssBlock(tokens, PALETTES.expressive);
    expect(contrast(expressive["--dp-danger"], blend(expressive["--dp-surface"], expressive["--dp-danger"], 0.2))).toBeCloseTo(4.26, 1);
    // And the step /20 cannot take with the lifted label either, in electric on a card: why the fill is /15.
    const electric = cssBlock(tokens, PALETTES.electric);
    expect(contrast(dangerOnSoft(electric), blend(electric["--dp-card"], electric["--dp-danger"], 0.2))).toBeLessThan(4.5);
  });

  it("gives a menu's destructive row the same pair on its focus fill, in every palette (the dark: step is gone)", () => {
    const row = classesOf("components/ui/dropdown-menu.tsx", /"(group\/dropdown-menu-item[^"]*)"/);
    const fill = alphaOf(row, "data-[variant=destructive]:focus:bg-dp-danger/");
    expect(row).toContain("data-[variant=destructive]:focus:text-dp-danger-on-soft");
    expect(row.filter((c) => c.startsWith("dark:") && c.includes("destructive"))).toEqual([]);
    each((palette, t) => {
      // A menu is the surface (index.css, the data-slot rule).
      expect(contrast(dangerOnSoft(t), blend(t["--dp-surface"], t["--dp-danger"], fill)), `${palette} focused row`).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("brings the composer's focus to the bar, in the shared accent ring that clears 3:1 on the canvas", () => {
    const bar = classesOf("shell/CommandBar.tsx", /data-command-bar className="([^"]*)"/);
    expect(bar).toEqual(expect.arrayContaining(["has-[textarea:focus-visible]:ring-2", "has-[textarea:focus-visible]:ring-dp-accent/70"]));
    // The field has none of its own: it is outline-none, so the bar draws it.
    expect(readSource("agents/CommandInput.tsx")).toMatch(/caret-dp-accent outline-none/);
    each((palette, t) => {
      for (const ground of ["--dp-canvas", "--dp-surface"]) {
        expect(contrast(blend(t[ground], t["--dp-accent"], 0.7), t[ground]), `${palette} bar ring on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    });
  });

  it("steps the accent button's hover clearly (accent/85, no brightness filter), with its label still at 4.5:1 on the hover fill", () => {
    const base = classesOf("components/ui/button.tsx", /default:\s*"([^"]*)"/);
    const hover = alphaOf(base, "hover:bg-dp-accent/");
    const accent = /export function AccentButton[\s\S]*?\n}(?:\r?\n|$)/.exec(readSource("shell/buttons.tsx"))![0];
    // The Button's own hover is the accent's: AccentButton restates none (a twMerge override would win over it).
    expect(accent).not.toMatch(/hover:|brightness|filter/);
    each((palette, t) => {
      for (const ground of ["--dp-canvas", "--dp-surface", "--dp-card"]) {
        const lit = blend(t[ground], t["--dp-accent"], hover);
        expect(contrast(t["--dp-on-accent"], lit), `${palette} label on the hover fill over ${ground}`).toBeGreaterThanOrEqual(4.5);
        // It moved 1.09:1 to 1.10:1 with brightness-110: now a step an eye sees.
        expect(contrast(lit, t["--dp-accent"]), `${palette} hover against rest over ${ground}`).toBeGreaterThanOrEqual(1.25);
      }
    });
  });

  it("greys a row that draws its reason by its ink, never by opacity: text-3 reads 4.5:1 on the menu, the terminal head and under the pointer", () => {
    const palette = readSource("commands/Palette.tsx");
    expect(palette, "the palette's rows").not.toMatch(/data-\[disabled=true\]:opacity-50/);
    expect(palette).toContain('line.disabled !== null ? "truncate text-dp-text-3" : "truncate text-dp-text"');
    expect(palette).toContain('<span className="ml-auto shrink-0 text-xs text-dp-text-3">{line.disabled}</span>');
    const plan = readSource("nodes/kanban/PlanMenu.tsx");
    expect(plan).toContain('<DropdownMenuItem disabled className="text-dp-text-3 data-disabled:opacity-100">');
    expect(plan).toContain('<span className="ml-auto text-xs text-dp-text-3">{t.noCards}</span>');
    expect(readSource("mission/RouterToggle.tsx"), "the inert router switch").not.toMatch(/opacity-50/);
    const agents = readSource("agents/AgentMenu.tsx");
    expect(agents).toContain("disabled:opacity-100");
    expect(agents.match(/group-disabled\/button:text-dp-text-3/g)).toHaveLength(3);
    each((name, t) => {
      for (const ground of ["--dp-surface", "--dp-terminal-head"]) {
        expect(contrast(t["--dp-text-3"], t[ground]), `${name} reason on ${ground}`).toBeGreaterThanOrEqual(4.5);
        // A menu and the palette fill a row under the pointer (--dp-hover).
        expect(contrast(t["--dp-text-3"], over(t[ground], t["--dp-hover"])), `${name} reason under the pointer on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
      // The audit's number: the reason at opacity-50 read about 2.4:1; under 3:1 in every palette.
      expect(contrast(blend(t["--dp-surface"], t["--dp-text-3"], 0.5), t["--dp-surface"]), `${name} the old reason`).toBeLessThan(3);
    });
  });
});
