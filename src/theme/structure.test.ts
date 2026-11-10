import { expect, it, vi } from "vitest";

// Slow under the load of the full suite: this file's tests get their own timeout.
vi.setConfig({ testTimeout: 30_000 });
import { TABS_HEIGHT, TITLE_BAR_HEIGHT, TOP_ROW_HEIGHT } from "@/shell/layout";
import { readSource, sourceFiles } from "./cssBlocks";

const index = readSource("index.css");

it("binds Tailwind's dark variant to the dark theme, not to a fixed class (spec identité §4.5)", () => {
  expect(readSource("../index.html")).not.toMatch(/class="dark"/);
  expect(index).toContain('@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));');
});

it("puts menus, popovers, lists, dialogs and toasts on opaque raised surfaces (spec identité §5.10)", () => {
  for (const slot of ["dropdown-menu-content", "dropdown-menu-sub-content", "popover-content", "select-content", "dialog-content"]) {
    expect(index).toContain(`[data-slot="${slot}"]`);
  }
  expect(index).toMatch(/\[data-slot="select-content"\] \{[^}]*background: var\(--dp-surface\)[^}]*border-radius: var\(--radius-lg\)/);
  expect(index).toMatch(/\[data-slot="dialog-content"\] \{[^}]*background: var\(--dp-surface\)[^}]*border-radius: var\(--radius-xl\)/);
  expect(index).toMatch(/\[data-sonner-toast\]\[data-styled="true"\] \{[^}]*background: var\(--dp-surface\)[^}]*border-radius: var\(--radius-lg\)/);
  // The veil under a dialog stays, flat: nothing behind it is blurred.
  expect(index).toMatch(/\[data-slot="dialog-overlay"\] \{\s*background: var\(--dp-scrim\);\s*\}/);
});

it("blurs nothing and has no transparency switch: every surface of the app is opaque", () => {
  const files = { ...sourceFiles(), "../public/first-paint.js": readSource("../public/first-paint.js") };
  for (const [file, text] of Object.entries(files)) {
    expect(text, file).not.toMatch(/backdrop-filter|backdrop-blur|data-transparency|prefers-reduced-transparency|--dp-blur|--dp-glass|--dp-head\b|setTransparency/);
  }
});

it("keeps no rule for Excalidraw's left menu: SelectionPanel replaces its properties panel, and nothing renders the old one", () => {
  expect(readSource("theme/excalidraw.css")).not.toContain("App-menu__left");
});

it("leaves nothing at the top of the canvas but the bars: no top toast, no banner under the tabs", () => {
  const sources = sourceFiles();
  for (const [file, text] of Object.entries(sources)) {
    expect(/position: "top-right"/.test(text), `${file} : toast en haut`).toBe(false);
    expect(/\btop-16\b/.test(text), `${file} : title bar at 64 px, under the tabs`).toBe(false);
  }
});

it("draws the bottom row and its command bar in dense glass: they carry text over dark terminals (spec identité §4.2, §5.8)", () => {
  for (const file of ["shell/CommandBar.tsx", "shell/GitChip.tsx", "shell/ZoomControl.tsx", "shell/WaitingNotice.tsx"]) {
    expect(readSource(file), file).toMatch(/dp-glass-strong/);
    expect(readSource(file), `${file} : light glass under text`).not.toMatch(/dp-glass(?!-strong)\b/);
  }
  expect(readSource("shell/CommandBar.tsx")).toContain("w-[680px]");
  expect(readSource("shell/messages.ts")).toContain('placeholder: "Message agents"');
});

it("rounds the composer on the scale: the bar a floating panel (16), Send and the field controls (8)", () => {
  // 16 = Send's 8 + the bar's 8 of padding: the corners nest.
  expect(readSource("shell/CommandBar.tsx")).toMatch(/data-command-bar className="[^"]*\brounded-xl\b/);
  const input = readSource("agents/CommandInput.tsx");
  const send = input.slice(input.indexOf("<ComposerPrimitive.Send"), input.indexOf("</ComposerPrimitive.Send>"));
  expect(send).toMatch(/rounded-(\[8px\]|md)/);
  // A fleet's field is a control of its own, beside Send.
  expect(input).toMatch(/compact &&\s*"[^"]*\brounded-(\[8px\]|md)/);
  expect(input, "the old odd radius").not.toContain("rounded-[10px]");
});

it("keeps nothing of the habillage shell (spec identité §5.11)", () => {
  const files = sourceFiles();
  for (const gone of ["shell/TopBar.tsx", "shell/DragStrip.tsx", "shell/LeftRail.tsx", "shell/RightRail.tsx", "shell/ActionChips.tsx", "shell/LiveCount.tsx", "shell/ui.tsx", "fleet/FleetPanel.tsx"]) {
    expect(files[gone], gone).toBeUndefined();
  }
  for (const [file, text] of Object.entries(files)) {
    expect(/\bov-chip\b|PillButton|ChipButton|RoundButton|fleetOpen|WindowCorner/.test(text), file).toBe(false);
  }
});

it("stacks the title bar and the tabs: 72 px of canvas under them (spec identité §7)", () => {
  expect([TITLE_BAR_HEIGHT, TABS_HEIGHT, TOP_ROW_HEIGHT]).toEqual([38, 34, 72]);
});

it("out-ranks sonner's own injected style, which comes later in a release build", () => {
  expect(index).toMatch(/\[data-sonner-toaster\] \[data-sonner-toast\]\[data-styled="true"\] \{[^}]*var\(--dp-shadow\)/);
});

it("starts the placement and link layers under the bars, and truncates a long branch name", () => {
  for (const file of ["agents/LinkMode.tsx", "agents/PlacementGhost.tsx"]) {
    const text = readSource(file);
    expect(text, file).not.toMatch(/fixed inset-0 z-40/);
    expect(text, file).toContain("top: TOP_ROW_HEIGHT");
  }
  expect(readSource("shell/GitChip.tsx")).toMatch(/max-w-\[150px\] truncate/);
});
