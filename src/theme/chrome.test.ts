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

it("writes radii on the scale (sm, md, lg, xl), never a pixel value", () => {
  for (const [file, text] of chrome()) {
    expect(text.match(/\brounded-\[\d+(\.\d+)?px\]|\brounded-\[min\(/g) ?? [], `${file}: a hard-coded radius`).toEqual([]);
  }
});

it("moves on the motion tokens: no hard-coded duration or ease on a utility, no transition-all, no ease-in", () => {
  for (const [file, text] of chrome()) {
    // Not preceded by a word or a dash: `ease-(--dp-ease-out)` holds an `ease-out` of its own.
    expect(text.match(/(?<![\w-])duration-\d+\b/g) ?? [], `${file}: duration-(--dp-dur-fast) or duration-(--dp-dur)`).toEqual([]);
    expect(text.match(/(?<![\w-])ease-(out|in|in-out|linear)\b/g) ?? [], `${file}: ease-(--dp-ease-out)`).toEqual([]);
    expect(/transition-all/.test(text), `${file}: list the transitioned properties`).toBe(false);
  }
});

it("eases a press on `scale`: Tailwind sets the `scale` property, which a `transform` in the transition list never reaches", () => {
  for (const file of ["components/ui/button.tsx", "canvas/SelectionPanel.tsx"]) {
    const text = sourceFiles()[file];
    const lists = text.match(/transition-\[[^\]]*\]/g) ?? [];
    expect(lists.filter((list) => list.includes("transform")), `${file}: name \`scale\`, not \`transform\``).toEqual([]);
  }
  expect(sourceFiles()["components/ui/button.tsx"]).toMatch(/transition-\[[^\]]*\bscale\b[^\]]*\][^"]*active:scale-\[0\.97\]/);
});

it("keeps chrome headings at weight 600 at most", () => {
  for (const [file, text] of chrome()) {
    expect(text.match(/\bfont-(bold|extrabold|black)\b/g) ?? [], `${file}: weight 700 in chrome`).toEqual([]);
  }
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
