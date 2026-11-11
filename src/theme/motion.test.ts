import { describe, expect, it, vi } from "vitest";

// Slow under the load of the full suite: this file's tests get their own timeout.
vi.setConfig({ testTimeout: 30_000 });
import { readSource, sourceFiles } from "./cssBlocks";

/**
 * The micro-interactions' rules (docs/design-system.md, Motion and Interaction): one ease-out
 * curve, exits faster than entries, popovers from their trigger, nothing animated that the
 * keyboard set off, and under reduced motion no movement but the colour and opacity cues.
 */
const index = readSource("index.css");

/** The class string of a shadcn part, as written in its file: the first string after `data-slot="<slot>"`. */
function slotClasses(file: string, slot: string): string[] {
  const text = readSource(file);
  const at = text.indexOf(`data-slot="${slot}"`);
  expect(at, `${file} renders ${slot}`).toBeGreaterThanOrEqual(0);
  return /"([^"]*)"/.exec(text.slice(text.indexOf("className", at)))![1].split(/\s+/);
}

/** The body of the first rule whose selector is exactly `selector`, optionally inside the at-rule `within`. */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `index.css has a rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

const OVERLAYS: [string, string][] = [
  ["components/ui/dialog.tsx", "dialog-overlay"],
  ["components/ui/dialog.tsx", "dialog-content"],
  ["components/ui/dropdown-menu.tsx", "dropdown-menu-content"],
  ["components/ui/dropdown-menu.tsx", "dropdown-menu-sub-content"],
  ["components/ui/select.tsx", "select-content"],
  ["components/ui/popover.tsx", "popover-content"],
];

describe("overlays: one curve, a quicker exit, popovers from their trigger", () => {
  it.each(OVERLAYS)("%s %s enters on the house curve in --dp-dur and leaves in --dp-dur-fast", (file, slot) => {
    const classes = slotClasses(file, slot);
    expect(classes).toEqual(expect.arrayContaining(["duration-(--dp-dur)", "ease-(--dp-ease-out)", "data-closed:duration-(--dp-dur-fast)"]));
  });

  it("scales a popover from its trigger, from 95% and never from nothing, like the menus and selects", () => {
    expect(slotClasses("components/ui/popover.tsx", "popover-content")).toEqual(
      expect.arrayContaining(["origin-(--radix-popover-content-transform-origin)", "data-open:zoom-in-95", "data-closed:zoom-out-95"]),
    );
    for (const [file, slot, origin] of [
      ["components/ui/dropdown-menu.tsx", "dropdown-menu-content", "origin-(--radix-dropdown-menu-content-transform-origin)"],
      ["components/ui/select.tsx", "select-content", "origin-(--radix-select-content-transform-origin)"],
      ["components/ui/tooltip.tsx", "tooltip-content", "origin-(--radix-tooltip-content-transform-origin)"],
    ]) {
      expect(slotClasses(file, slot), slot).toContain(origin);
    }
    // A dialog is not anchored to a trigger: it stays centred, with no origin.
    expect(slotClasses("components/ui/dialog.tsx", "dialog-content").filter((c) => c.startsWith("origin-"))).toEqual([]);
    for (const [file, text] of Object.entries(sourceFiles())) {
      expect(text.match(/\bzoom-(in|out)(-0)?(?![\w-])|scale\(0\)/g) ?? [], `${file}: start a scale at 0.9 or more`).toEqual([]);
    }
  });

  it("drops the popover's dead skin classes: the data-slot rule in index.css draws its surface", () => {
    const classes = slotClasses("components/ui/popover.tsx", "popover-content");
    for (const dead of ["rounded-xl", "bg-dp-surface-2", "shadow-dp", "border-dp-line"]) expect(classes).not.toContain(dead);
    expect(index).toMatch(/\[data-slot="popover-content"\],[^{]*\{[^}]*background: var\(--dp-surface\);[^}]*border-radius: var\(--radius-lg\)/);
  });

  it("opens a surface the keyboard asked for at once: [data-instant] runs no animation, outside any layer", () => {
    expect(ruleBody(index, "[data-instant]")).toMatch(/animation: none !important/);
    expect(index.slice(0, index.indexOf("[data-instant] {"))).not.toMatch(/@layer [\w-]+ \{[^}]*$/);
  });
});

describe("reduced motion: gentler, not zero", () => {
  it("lets the overlays fade but neither zoom nor slide, in one unlayered rule over every *-content slot", () => {
    const reduce = /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-slot\$="-content"\] \{([^}]*)\}/.exec(index);
    expect(reduce, "the overlays' reduced-motion rule").not.toBeNull();
    const vars = Object.fromEntries([...reduce![1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    expect(vars).toEqual({
      "--tw-enter-scale": "1",
      "--tw-exit-scale": "1",
      "--tw-enter-translate-x": "0",
      "--tw-enter-translate-y": "0",
      "--tw-exit-translate-x": "0",
      "--tw-exit-translate-y": "0",
    });
    // The opacity is left alone: they still fade.
    expect(reduce![1]).not.toMatch(/opacity/);
  });

  it("fades toasts where sonner would drop every transition", () => {
    expect(index).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\[data-sonner-toaster\] \[data-sonner-toast\] \{\s*transition: opacity var\(--dp-dur\) var\(--dp-ease-out\) !important;\s*\}/);
  });

  it("keeps the controls' colour fades and stops only their press", () => {
    const button = readSource("components/ui/button.tsx");
    expect(button).toContain("motion-reduce:transition-[color,background-color] motion-reduce:active:scale-100");
    const toggle = readSource("components/ui/toggle.tsx");
    expect(toggle).toContain("motion-reduce:transition-[color,background-color,border-color] motion-reduce:active:scale-100");
    for (const file of ["button", "input", "select", "textarea", "toggle"]) {
      expect(readSource(`components/ui/${file}.tsx`), file).not.toContain("motion-reduce:transition-none");
    }
  });

  it("moves the switch's thumb on the tokens, and not at all under reduced motion", () => {
    expect(slotClasses("components/ui/switch.tsx", "switch-thumb")).toEqual(
      expect.arrayContaining(["transition-transform", "duration-(--dp-dur-fast)", "ease-(--dp-ease-out)", "motion-reduce:transition-none"]),
    );
  });

  it("lets the waiting notice fade in without its rise", () => {
    const notice = readSource("shell/WaitingNotice.tsx");
    expect(notice).toContain("slide-in-from-bottom-1");
    expect(notice).toContain("motion-reduce:slide-in-from-bottom-0");
    expect(notice).not.toContain("motion-reduce:animate-none");
  });

  it("spins a spinner only when motion is welcome", () => {
    for (const [file, text] of Object.entries(sourceFiles())) {
      expect(text.match(/(?<![\w:-])animate-spin\b/g) ?? [], `${file}: motion-safe:animate-spin`).toEqual([]);
    }
  });
});

describe("press: every pressable answers the same way", () => {
  it("presses a toggle like a button: 0.97, eased on `scale`, on the tokens", () => {
    const toggle = readSource("components/ui/toggle.tsx");
    const list = /transition-\[([^\]]*)\]/.exec(toggle)![1].split(",");
    expect(list).toEqual(["color", "background-color", "border-color", "scale"]);
    expect(toggle).toMatch(/duration-\(--dp-dur-fast\) ease-\(--dp-ease-out\)[^"]*active:scale-\[0\.97\]/);
  });
});

describe("nothing the keyboard sets off, nor what the pointer sweeps, is animated", () => {
  it("snaps the palette's selection and the fill of dense rows: no transition on them", () => {
    const palette = /const ITEM =\s*"([^"]*)"/.exec(readSource("commands/Palette.tsx"))![1];
    expect(palette).toContain("data-[selected=true]:bg-dp-accent-soft");
    expect(palette).not.toMatch(/transition|duration-/);
    const rows: [string, RegExp][] = [
      ["git/GitWindow.tsx", /"group flex h-7 items-center gap-2 px-3 text-xs[^"]*"/],
      ["review/ReviewPanel.tsx", /const ROW =\s*"[^"]*"/],
      ["review/DiffRow.tsx", /onClick && "cursor-pointer[^"]*"/],
      ["studio/CodeWorkspace.tsx", /"flex h-7 w-full items-center gap-1 pr-2[^"]*"/],
      ["notes/NotesDialog.tsx", /"block w-full px-3 py-1\.5 text-left[^"]*"/],
      ["canvas/ExtensionList.tsx", /"group\/row flex min-h-10[^"]*"/],
    ];
    for (const [file, row] of rows) {
      const classes = row.exec(readSource(file));
      expect(classes, `${file} keeps its row`).not.toBeNull();
      expect(classes![0], file).not.toMatch(/transition|duration-/);
    }
  });

  it("opens the radial ring at once: no entrance keyframe left", () => {
    for (const [file, text] of Object.entries(sourceFiles())) expect(text, file).not.toMatch(/dp-radial-in/);
  });

  it("puts the zen and reading exit button there at once: a shortcut put it there", () => {
    expect(readSource("shell/ModeExit.tsx")).not.toMatch(/starting:/);
  });

  it("names `rotate`, `scale` or `translate` where Tailwind sets them: no transition list names a bare `transform`", () => {
    for (const [file, text] of Object.entries(sourceFiles())) {
      expect(text.match(/transition-\[[^\]]*\btransform\b[^\]]*\]/g) ?? [], file).toEqual([]);
    }
  });

  it("does not press-scale a workspace tab: it selects like a browser tab", () => {
    const tabs = readSource("shell/WorkspaceTabs.tsx");
    expect(tabs).toContain("hover:text-inherit active:scale-100");
    expect(tabs).not.toContain("active:scale-[0.98]");
  });
});

