import { expect, it } from "vitest";
import { readSource, sourceFiles } from "./cssBlocks";

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

// Radius, motion, weight, the section label and the palette's tokens hold in every file of src: sweep.test.ts and motion.test.ts.

it("imports `cn` from the project's own helper, never straight from the npm package", () => {
  for (const [file, text] of panels()) {
    expect(/from "cn"/.test(text), `${file}: import { cn } from "@/lib/utils"`).toBe(false);
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
  for (const file of ["loops/LoopsDialog.tsx", "presets/SavePresetDialog.tsx", "nodes/terminal/TerminalOptionsDialog.tsx"]) {
    expect(files[file], `${file}: QuietButton`).toContain("<QuietButton");
    expect(/<AccentButton[^>]*size="lg"/.test(files[file]), `${file}: AccentButton size="lg"`).toBe(true);
  }
});

it("puts a problem where the empty state would be, with one action at most under its lines (InlineProblem)", () => {
  const problem = sourceFiles()["components/InlineProblem.tsx"];
  // Among a list's rows it takes the empty state's padding; in a pane, its middle.
  expect(problem).toContain('list: "flex justify-center px-3 py-4"');
  expect(problem).toContain('pane: "flex flex-1 items-center justify-center p-6"');
  // One action, not a list of them; it may keep the keyboard where it is (a panel of the canvas's).
  expect(problem).toContain("action?: { label: string; onClick: () => void; onMouseDown?:");
});

it("says what a pane or a list has nothing to show in one place: EmptyState, not a copy in each panel", () => {
  const files = sourceFiles();
  for (const [file, text] of Object.entries(files)) {
    if (file === "components/EmptyState.tsx") continue;
    expect(text, `${file}: the pane's empty state`).not.toContain("grid flex-1 place-items-center p-6 text-center text-xs text-dp-text-2");
    expect(text, `${file}: the list's empty state`).not.toContain("px-3 py-4 text-center text-xs text-dp-text-2");
  }
  for (const file of ["git/GitDiff.tsx", "git/HistoryTab.tsx", "review/ReviewPanel.tsx", "studio/CodeWorkspace.tsx", "notes/NotesWorkspace.tsx"]) {
    expect(files[file], `${file}: EmptyState`).toContain("<EmptyState");
  }
});

it("shows a skeleton where Code Studio and Notes will be, not the bare canvas, while they load", () => {
  const view = sourceFiles()["shell/ProjectView.tsx"];
  expect(view).not.toContain("<Suspense fallback={null}>");
  expect(view.match(/<Suspense fallback={<PanelSkeleton /g)).toHaveLength(2);
});

it("writes the empty and loading rules down: EmptyState's opt-in grace and the workspaces' PanelSkeleton (docs/design-system.md)", () => {
  const files = sourceFiles();
  const doc = readSource("../docs/design-system.md");
  const at = doc.indexOf("\n## Empty and loading states");
  expect(at).toBeGreaterThan(0);
  const part = doc.slice(at, doc.indexOf("\n## ", at + 1));
  const grace = files["components/EmptyState.tsx"].match(/export const GRACE_MS = (\d+);/)?.[1];
  expect(grace).toBeDefined();
  expect(part).toContain(`\`GRACE_MS\` (${grace}ms)`);
  for (const word of ["EmptyState", "PanelSkeleton", "Suspense", "InlineProblem", "opts in", "still"]) expect(part, word).toContain(word);
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
