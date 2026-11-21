import { expect, it } from "vitest";
import { sourceFiles } from "./cssBlocks";

/** The app's chrome and primitives: what docs/design-system.md governs most directly. */
const CHROME = /^(components|shell|home|app)\//;
const chrome = () => Object.entries(sourceFiles()).filter(([file]) => CHROME.test(file));

it("imports `cn` from the project's own helper, never straight from the npm package", () => {
  for (const [file, text] of chrome()) {
    expect(/from "cn"/.test(text), `${file}: import { cn } from "@/lib/utils"`).toBe(false);
  }
});

// Radius, motion and weight hold in every file of src: sweep.test.ts and motion.test.ts.

it("eases a press on `scale`: Tailwind sets the `scale` property, which a `transform` in the transition list never reaches", () => {
  for (const file of ["components/ui/button.tsx", "canvas/SelectionPanel.tsx"]) {
    const text = sourceFiles()[file];
    const lists = text.match(/transition-\[[^\]]*\]/g) ?? [];
    expect(lists.filter((list) => list.includes("transform")), `${file}: name \`scale\`, not \`transform\``).toEqual([]);
  }
  expect(sourceFiles()["components/ui/button.tsx"]).toMatch(/transition-\[[^\]]*\bscale\b[^\]]*\][^"]*active:scale-\[0\.97\]/);
});

it("sizes controls on the h-7 / h-8 / h-9 scale: the rail buttons and the icon buttons come from the Button's sizes", () => {
  const buttons = sourceFiles()["shell/buttons.tsx"];
  expect(/\bh-8\.5\b/.test(buttons), "an off-scale 34 px rail button").toBe(false);
  expect(buttons).toContain('size="icon-lg"');
  expect(buttons).toContain('size="icon-sm"');
});

it("names no control through a native title in the shared button kit: the hint carries it", () => {
  const buttons = sourceFiles()["shell/buttons.tsx"];
  // The word appears in the comments explaining why; no JSX attribute `title=`.
  expect(/\btitle=/.test(buttons)).toBe(false);
});

it("does not call the fleet's manager a fleet in the texts users read", () => {
  for (const [file, text] of chrome().filter(([file]) => file.endsWith("messages.ts"))) {
    expect(text.match(/["'`][^"'`\n]*orchestrat[^"'`\n]*["'`]/gi) ?? [], `${file}: say Fleet`).toEqual([]);
  }
});

it("writes the names of an unnamed agent and the search shortcut in the messages, not in the components", () => {
  const files = sourceFiles();
  for (const file of ["shell/CloseAgentDialog.tsx", "shell/CloseGroupDialog.tsx", "shell/UpdateDialog.tsx"]) {
    expect(/\|\| "Agent"/.test(files[file]), `${file}: use fallbackAgent`).toBe(false);
  }
  expect(files["shell/SearchField.tsx"]).not.toContain(">Ctrl+P<");
});

it("shows the palettes' names from the messages, and the title bar's meters in the app's hint", () => {
  const files = sourceFiles();
  expect(files["shell/SettingsMenu.tsx"]).not.toContain("PALETTES[palette].name");
  expect(files["shell/SettingsMenu.tsx"]).toContain("t.palettes[palette]");
  expect(/\btitle=/.test(files["shell/UsageMeter.tsx"].replace(/<Section title=|title=\{u\.notSentHint\}|title=\{u\.co2Hint\}/g, "")), "UsageMeter's trigger keeps a native title").toBe(false);
});

it("gives every menu row one anatomy: 32 px (min-h-8), the UI step, an 8 px gap, in the dropdown menu's items and the select's", () => {
  const rows: [string, string[]][] = [
    ["components/ui/dropdown-menu.tsx", ["dropdown-menu-item", "dropdown-menu-checkbox-item", "dropdown-menu-radio-item", "dropdown-menu-sub-trigger"]],
    ["components/ui/select.tsx", ["select-item"]],
  ];
  for (const [file, slots] of rows) {
    const text = sourceFiles()[file];
    for (const slot of slots) {
      const at = text.indexOf(`data-slot="${slot}"`);
      expect(at, `${file} renders ${slot}`).toBeGreaterThanOrEqual(0);
      const classes = /"([^"]*)"/.exec(text.slice(text.indexOf("className", at)))![1].split(/\s+/);
      expect(classes, `${slot} is 32 px high`).toContain("min-h-8");
      expect(classes, `${slot} is set in the UI step`).toContain("text-(length:--text-ui)");
      expect(classes, `${slot} keeps an 8 px gap after its icon`).toContain("gap-2");
      expect(classes.filter((c) => /^(py-0\.5|py-1\.5|h-\d|text-(xs|sm|base))$/.test(c)), `${slot} sets no row size of its own`).toEqual([]);
    }
  }
});
