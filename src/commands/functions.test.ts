import { describe, expect, it } from "vitest";
import { labelOf, sectionOf, type Command, type CommandContext } from "./command";
import { functionSections } from "./functions";

const ctx: CommandContext = { project: true, workspaceId: "w1", terminalCount: 1, terminalId: null };
const command = (id: string, label: string, section: string, available = true): Command => ({
  id,
  label,
  section,
  keywords: [],
  available: () => available,
  run: () => undefined,
});

describe("functionSections (spec fenêtre §7.3)", () => {
  const commands = [
    command("terminal.next", "Next terminal", "Navigation"),
    command("workspace.new", "New workspace", "Workspaces"),
    command("terminal.pause", "Pause", "Terminal · Batman", false),
    command("canvas.overview", "Overview", "Navigation"),
    command("palette.functions", "Search for a function…", "Navigation"),
  ];

  it("lists the available functions by section, in the registry's order, without itself", () => {
    expect(functionSections(commands, ctx, "").map((s) => [s.label, s.items.map((c) => c.label)])).toEqual([
      ["Navigation", ["Next terminal", "Overview"]],
      ["Workspaces", ["New workspace"]],
    ]);
  });

  it("names a line and its section after the moment, shows its key, and why it is greyed", () => {
    const rename: Command = {
      id: "terminal.rename",
      label: (c) => `Renommer ${c.terminalId}`,
      section: (c) => `Terminal · ${c.terminalId}`,
      keywords: [],
      keys: "F2",
      available: () => true,
      run: () => undefined,
    };
    const codex: Command = {
      id: "agent.launch.codex",
      label: "Launch Codex",
      section: "Agents",
      keywords: [],
      available: () => true,
      disabled: () => "codex introuvable dans le PATH",
      run: () => undefined,
    };
    const sections = functionSections([rename, codex], { ...ctx, terminalId: "Batman" }, "");
    expect(sections.map((s) => s.label)).toEqual(["Terminal · Batman", "Agents"]);
    expect(sections[0].items[0]).toMatchObject({ label: "Renommer Batman", hint: "F2", disabled: null });
    expect(sections[1].items[0]).toMatchObject({ label: "Launch Codex", hint: null, disabled: "codex introuvable dans le PATH" });
    expect(labelOf(rename, { ...ctx, terminalId: "Cyborg" })).toBe("Renommer Cyborg");
    expect(sectionOf(codex, ctx)).toBe("Agents");
  });

  it("puts the recent functions first, most recent first, when nothing is typed, without repeating them below", () => {
    const sections = functionSections(commands, ctx, "", ["workspace.new", "canvas.overview", "gone"]);
    expect(sections.map((s) => [s.label, s.items.map((c) => c.label)])).toEqual([
      ["Recent", ["New workspace", "Overview"]],
      ["Navigation", ["Next terminal"]],
    ]);
    expect(sections[0].items[0].section).toBe("Workspaces");
  });

  it("keeps a recent function first while searching when the words typed start its words, never for a loose match", () => {
    expect(functionSections(commands, ctx, "over", ["canvas.overview"])[0].label).toBe("Recent");
    expect(functionSections(commands, ctx, "new wo", ["canvas.overview"]).map((s) => s.label)).toEqual(["Workspaces"]);
    // "nxt" finds Next terminal by its letters only: no promotion.
    expect(functionSections(commands, ctx, "nxt", ["terminal.next"])[0].label).toBe("Navigation");
  });

  it("ranks each section by the search", () => {
    expect(functionSections(commands, ctx, "ov").map((s) => [s.label, s.items.map((c) => c.label)])).toEqual([["Navigation", ["Overview"]]]);
  });
});
