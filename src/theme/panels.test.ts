import { expect, it } from "vitest";
import { sourceFiles } from "./cssBlocks";

/** The feature panels and dialogs: what docs/design-system.md governs once the chrome (chrome.test.ts) is done. */
const PANELS = /^(agents|fleet|mission|kanban|nodes\/kanban|nodes\/file|nodes\/output|openui|review|git|notes|studio|loops|accounts|presets|usage)\/|^commands\/(Palette|GoToRow)\.tsx$|^canvas\/overlay\//;

/** Files other tasks own (launch menu, layout and placement code): checked by their owners, not here. */
const OTHER_TASKS = new Set([
  "agents/AgentMenu.tsx",
  "agents/LaunchOptionsForm.tsx",
  "agents/launchAgent.ts",
  "agents/quickActions.ts",
  "agents/groups.ts",
  "agents/ComposeGroup.tsx",
  "agents/groupLayout.ts",
  "agents/flowLayout.ts",
  "agents/spawnLayout.ts",
  "agents/terminals.ts",
  "agents/spawn.ts",
  "canvas/overlay/timeline.ts",
  "canvas/overlay/StepTimelines.tsx",
]);

const panels = () => Object.entries(sourceFiles()).filter(([file]) => PANELS.test(file) && !OTHER_TASKS.has(file));
const components = () => panels().filter(([file]) => file.endsWith(".tsx"));

it("imports `cn` from the project's own helper, never straight from the npm package", () => {
  for (const [file, text] of panels()) {
    expect(/from "cn"/.test(text), `${file}: import { cn } from "@/lib/utils"`).toBe(false);
  }
});

it("writes radii on the scale (sm, md, lg, xl), never a pixel value", () => {
  for (const [file, text] of components()) {
    expect(text.match(/\brounded-\[\d+(\.\d+)?px\]|\brounded-\[min\(/g) ?? [], `${file}: a hard-coded radius`).toEqual([]);
  }
});

it("moves on the motion tokens: no hard-coded duration or ease on a utility, no transition-all, no ease-in", () => {
  for (const [file, text] of components()) {
    // Not preceded by a word or a dash: `ease-(--dp-ease-out)` holds an `ease-out` of its own.
    expect(text.match(/(?<![\w-])duration-\d+\b/g) ?? [], `${file}: duration-(--dp-dur-fast) or duration-(--dp-dur)`).toEqual([]);
    expect(text.match(/(?<![\w-])ease-(out|in|in-out|linear)\b/g) ?? [], `${file}: ease-(--dp-ease-out)`).toEqual([]);
    expect(/transition-all/.test(text), `${file}: list the transitioned properties`).toBe(false);
  }
});

it("keeps headings at weight 600 at most, and never resizes the section label", () => {
  for (const [file, text] of components()) {
    expect(text.match(/\bfont-(bold|extrabold|black)\b/g) ?? [], `${file}: weight 700`).toEqual([]);
    expect(text.match(/\bdp-label[^"'`]*\b(text-(xs|sm|base|\(length)|font-(normal|semibold))/g) ?? [], `${file}: a .dp-label resized`).toEqual([]);
  }
});

it("uses the palette's tokens only: no raw hex, no black or white", () => {
  for (const [file, text] of components()) {
    expect(text.match(/["'`(]#[0-9a-fA-F]{3,8}\b/g) ?? [], `${file}: a raw hex colour`).toEqual([]);
    expect(text.match(/\b(bg|text|border|ring|fill|stroke)-(black|white)\b/g) ?? [], `${file}: black or white`).toEqual([]);
  }
});

it("does not call the fleet's manager a fleet in the texts users read", () => {
  for (const [file, text] of panels().filter(([file]) => file.endsWith("messages.ts"))) {
    // The `${…}` of a template is code (a key like `r.fleets`), not words.
    const words = text.replace(/\$\{[^}]*\}/g, "");
    expect(words.match(/["'`][^"'`\n]*orchestrat[^"'`\n]*["'`]/gi) ?? [], `${file}: say Fleet`).toEqual([]);
  }
});

it("names no control through a native title where the shared hint exists (the panel's rows, Remote Control's phone, the resume toast)", () => {
  const files = sourceFiles();
  for (const file of ["agents/RemoteButton.tsx", "agents/AgentRow.tsx", "agents/ResumeAllToast.tsx"]) {
    expect(/\btitle=/.test(files[file]), `${file}: a Hint, not a native title`).toBe(false);
  }
});

it("sizes Remote Control's phone like the header's other icon buttons: the Button's icon-sm, through the shared kit", () => {
  const remote = sourceFiles()["agents/RemoteButton.tsx"];
  expect(remote).toContain("<IconButton");
  expect(/\bsize-5\b/.test(remote), "a hand-sized 20 px phone").toBe(false);
});

it("gives the floating panels one header: an icon, a title in text-sm medium, the actions after, 40 px high", () => {
  const files = sourceFiles();
  const header = "flex h-10 shrink-0 items-center gap-2 border-b border-dp-line px-3";
  for (const file of ["agents/AgentsPanel.tsx", "git/GitWindow.tsx", "review/ReviewPanel.tsx"]) {
    expect(files[file], `${file}: the panel header`).toContain(header);
  }
});

it("ends a dialog's footer on the dialogs' kit: Quiet to dismiss, the accent (size lg) to confirm", () => {
  const files = sourceFiles();
  for (const file of ["loops/LoopsDialog.tsx", "presets/SavePresetDialog.tsx"]) {
    expect(files[file], `${file}: QuietButton`).toContain("<QuietButton");
    expect(/<AccentButton[^>]*size="lg"/.test(files[file]), `${file}: AccentButton size="lg"`).toBe(true);
  }
});

it("lists a list's empty state the same way: small, centred, in the second text role", () => {
  const files = sourceFiles();
  for (const [file, text] of [
    ["loops/LoopsDialog.tsx", "py-4 text-center text-xs text-dp-text-2"],
    ["commands/Palette.tsx", "py-4 text-center text-xs text-dp-text-2"],
    ["agents/AgentsPanel.tsx", "py-4 text-center text-xs text-dp-text-2"],
  ]) {
    expect(files[file], `${file}: the empty state`).toContain(text);
  }
});
