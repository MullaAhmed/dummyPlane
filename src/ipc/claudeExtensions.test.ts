import { describe, expect, it } from "vitest";
import { buildSpawnSpec } from "@/nodes/terminal/launch";
import { readTerminalPayload, type TerminalPayload } from "@/nodes/types";
import { canSwitch, isOn, isOwnMcpServer, readExtensionChoice, withItem, withItems, withoutOwnServer, type ExtensionItem } from "./claudeExtensions";

/** An item of the user's, on unless told; or with these fields. */
const item = (id: string, patch: boolean | Partial<ExtensionItem> = true): ExtensionItem => ({
  id,
  name: id,
  source: "user",
  enabled: true,
  ...(typeof patch === "boolean" ? { enabled: patch } : patch),
});

describe("a terminal's choice of skills, plugins, MCP servers and subagents", () => {
  it("keeps only what changes something", () => {
    expect(readExtensionChoice(undefined)).toBeUndefined();
    expect(readExtensionChoice({ skillsOff: [], plugins: {} })).toBeUndefined();
    expect(readExtensionChoice({ skillsOff: ["a", "a", "", 3], mcpOff: "x", plugins: { "p@m": false, "q@m": "yes" } })).toEqual({
      skillsOff: ["a"],
      plugins: { "p@m": false },
    });
  });

  it("turns an item off and back on, back to nothing stored", () => {
    const deploy = item("deploy");
    const off = withItem("skills", deploy, false, undefined);
    expect(off).toEqual({ skillsOff: ["deploy"] });
    expect(isOn("skills", deploy, off)).toBe(false);
    expect(withItem("skills", deploy, true, off)).toBeUndefined();
  });

  it("can turn a plugin on that the user's settings leave off, and forgets it when put back", () => {
    const plugin = item("codex@openai", false);
    const on = withItem("plugins", plugin, true, undefined);
    expect(on).toEqual({ plugins: { "codex@openai": true } });
    expect(isOn("plugins", plugin, on)).toBe(true);
    expect(withItem("plugins", plugin, false, on)).toBeUndefined();
  });

  it("never shows on what the user's own settings turned off", () => {
    expect(isOn("mcp", item("github", false), undefined)).toBe(false);
    expect(isOn("agents", item("tester"), { agentsOff: ["tester"] })).toBe(false);
  });

  it("switches only a plugin, or what the user's settings leave on", () => {
    expect(canSwitch("plugins", item("codex@openai", false))).toBe(true);
    expect(canSwitch("skills", item("deploy"))).toBe(true);
    expect(canSwitch("mcp", item("github", false))).toBe(false);
  });

  it("switches several items in one change, from the choice there is, and leaves one it can't switch alone", () => {
    const off = withItems("skills", [item("a"), item("b"), item("locked", false)], false, { skillsOff: ["c"], agentsOff: ["x"] });
    expect(off).toEqual({ skillsOff: ["c", "a", "b"], agentsOff: ["x"] });
    expect(withItems("skills", [item("a"), item("b"), item("c")], true, off)).toEqual({ agentsOff: ["x"] });
    expect(withItems("mcp", [], false, undefined)).toBeUndefined();
  });

  it("turns every plugin on or off, forgetting each that goes back to the user's settings", () => {
    const plugins = [item("codex@openai"), item("figma@claude", false)];
    const on = withItems("plugins", plugins, true, { plugins: { "codex@openai": false } });
    expect(on).toEqual({ plugins: { "figma@claude": true } });
    expect(withItems("plugins", plugins, false, on)).toEqual({ plugins: { "codex@openai": false } });
  });

  it("is saved with the terminal and given to Claude at launch", () => {
    const stored = readTerminalPayload({ agent: "claude", cwd: "D:/p", extensions: { mcpOff: ["github"], junk: 1 } }) as TerminalPayload;
    expect(stored.extensions).toEqual({ mcpOff: ["github"] });
    expect(buildSpawnSpec(stored, "new").claude?.extensions).toEqual({ mcpOff: ["github"] });
    expect(buildSpawnSpec({ ...stored, extensions: undefined }, "new").claude?.extensions).toBeUndefined();
  });
});

describe("a plugin's skill", () => {
  const skill = item("codex:rescue", { source: "plugin", fixed: "plugin", plugin: "codex@openai", enabled: true });

  it("has no switch of its own, and a choice of its name changes nothing", () => {
    expect(canSwitch("skills", skill)).toBe(false);
    expect(withItems("skills", [skill], false, undefined)).toBeUndefined();
    expect(isOn("skills", skill, { skillsOff: ["codex:rescue"] })).toBe(true);
  });

  it("is on and off with its plugin, as this terminal's choice switches it", () => {
    expect(isOn("skills", skill, { plugins: { "codex@openai": false } })).toBe(false);
    const offInSettings = { ...skill, enabled: false };
    expect(isOn("skills", offInSettings, undefined)).toBe(false);
    expect(isOn("skills", offInSettings, { plugins: { "codex@openai": true } })).toBe(true);
  });
});

describe("dummyPlane's own MCP server, the Fleet's mission tools", () => {
  it("is recognised by its name, whatever the case or the spaces", () => {
    expect(isOwnMcpServer("dummyplane")).toBe(true);
    expect(isOwnMcpServer(" DummyPlane ")).toBe(true);
    expect(isOwnMcpServer("github")).toBe(false);
    expect(isOwnMcpServer("plugin_dummyplane_x")).toBe(false);
  });

  it("is one fixed row of the MCP list: any other entry of its name is left out, and only from that list", () => {
    const own = item("dummyplane", { source: "app", fixed: "own" });
    const lists = withoutOwnServer({
      skills: [item("dummyplane")],
      plugins: [],
      mcp: [item("dummyplane"), item("DummyPlane"), own, item("github")],
      agents: [],
    });
    expect(lists.mcp).toEqual([own, item("github")]);
    expect(lists.skills.map((i) => i.id)).toEqual(["dummyplane"]);
    // Always on, whatever a choice says.
    expect(isOn("mcp", own, { mcpOff: ["dummyplane"] })).toBe(true);
    expect(canSwitch("mcp", own)).toBe(false);
  });

  it("is never stored in a choice, even one saved by an older build or edited by hand", () => {
    expect(readExtensionChoice({ mcpOff: ["dummyplane", "github", "DummyPlane"] })).toEqual({ mcpOff: ["github"] });
    expect(readExtensionChoice({ mcpOff: ["dummyplane"] })).toBeUndefined();
    expect(withItem("mcp", item("dummyplane"), false, { mcpOff: ["github"] })).toEqual({ mcpOff: ["github"] });
    expect(withItems("mcp", [item("dummyplane"), item("github")], false, undefined)).toEqual({ mcpOff: ["github"] });
  });

  it("has no switch, and is not given to Claude as a deny rule at launch", () => {
    expect(canSwitch("mcp", item("dummyplane"))).toBe(false);
    const stored = readTerminalPayload({ agent: "claude", cwd: "D:/p", extensions: { mcpOff: ["dummyplane"] } }) as TerminalPayload;
    expect(stored.extensions).toBeUndefined();
    const spec = buildSpawnSpec({ ...stored, extensions: { mcpOff: ["dummyplane", "github"] } }, "new");
    expect(spec.claude?.extensions).toEqual({ mcpOff: ["github"] });
  });
});
