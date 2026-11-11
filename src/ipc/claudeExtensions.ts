import { call } from "./invoke";

/**
 * Where an item is set up: the Claude folder (user), the project's files, the
 * project's entry in `.claude.json` (local), a plugin, Claude Code itself
 * (builtin: Claude in Chrome), the claude.ai account (synced skills, id
 * `anthropic-skills:<name>`), dummyPlane (app: its own MCP server). A plugin's
 * skills (id `<plugin>:<name>`), MCP servers (id `plugin_<plugin>_<server>`,
 * their tools' prefix) and subagents (id `<plugin>:<name>`) are on only while
 * their plugin is.
 */
export type ExtensionSource = "user" | "project" | "local" | "plugin" | "builtin" | "synced" | "app";

/** Why a listed item can't be switched here: a plugin's skill follows its plugin; dummyPlane's own server stays on. */
export type ExtensionFixed = "plugin" | "own";

/** One skill, plugin, MCP server or subagent a Claude terminal can use. Mirrors Rust's `ExtensionItem`. */
export interface ExtensionItem {
  /** What a choice stores: a skill or subagent name, a plugin id (`name@marketplace`), an MCP server name. */
  id: string;
  name: string;
  description?: string;
  source: ExtensionSource;
  /** On without this terminal's choice: what the user's own settings give. */
  enabled: boolean;
  /** Listed, never switched from the panel. */
  fixed?: ExtensionFixed;
  /** The plugin a plugin's skill comes with (`name@marketplace`): the skill is on while the plugin is. */
  plugin?: string;
}

/** What a Claude terminal can find in its folder and its profile, by kind. Mirrors Rust's `ClaudeExtensions`. */
export interface ClaudeExtensions {
  skills: ExtensionItem[];
  plugins: ExtensionItem[];
  mcp: ExtensionItem[];
  agents: ExtensionItem[];
}

/**
 * What one Claude terminal changes from the user's own setup, read at its next
 * launch. Only the changes are kept: absent or empty means the user's setup as
 * it is, and anything installed later is on.
 */
export interface ExtensionChoice {
  /** Skills turned off (`skillOverrides: "off"`). A plugin's skills follow their plugin. */
  skillsOff?: string[];
  /** Subagents Claude may not start (`Agent(name)` denied). */
  agentsOff?: string[];
  /** MCP servers whose tools are denied (`mcp__<name>`). dummyPlane's own server is never listed (`OWN_MCP_SERVER`). */
  mcpOff?: string[];
  /** Plugins turned on or off for this terminal, against the user's settings (`enabledPlugins`). */
  plugins?: Record<string, boolean>;
}

/**
 * dummyPlane's own MCP server (`mcp_files::config_json`): every Claude terminal's
 * tools to talk to dummyPlane (report, step, spawn_agent…), a Fleet's mission
 * tools. Rust lists it once, fixed (source "app"), and never writes it into a
 * deny rule (`extensions.rs`); this is the same rule on this side, so no list
 * shows another entry of that name and no stored choice names it, whatever a
 * saved file or an answer says.
 */
export const OWN_MCP_SERVER = "dummyplane";

export const isOwnMcpServer = (name: string): boolean => name.trim().toLowerCase() === OWN_MCP_SERVER;

/** The skills, plugins, MCP servers and subagents a Claude terminal in `cwd`, with this profile folder, would get. */
export const claudeExtensions = (cwd: string, configDir?: string) =>
  call<ClaudeExtensions>("claude_extensions", { cwd, configDir: configDir ?? null }).then(withoutOwnServer);

/** What a Claude terminal starts on when its launch names no model. Mirrors Rust's `LaunchDefaults`. */
export interface ClaudeLaunchDefaults {
  /** The `model` its settings give (local, then project, then user), as written: an alias or a full name. */
  model?: string;
}

/** The launch defaults of a Claude terminal in `cwd`, with this profile folder; an answer of another shape names nothing. */
export const claudeLaunchDefaults = (cwd: string, configDir?: string): Promise<ClaudeLaunchDefaults> =>
  call<unknown>("claude_launch_defaults", { cwd, configDir: configDir ?? null }).then((raw) => {
    const model = (raw as { model?: unknown } | null | undefined)?.model;
    return typeof model === "string" && model.trim() ? { model: model.trim() } : {};
  });

/** The lists with dummyPlane's own MCP server as its one fixed row: any other entry of that name is dropped. */
export const withoutOwnServer = (lists: ClaudeExtensions): ClaudeExtensions => ({
  ...lists,
  mcp: (lists.mcp ?? []).filter((item) => !(isOwnMcpServer(item.id) || isOwnMcpServer(item.name)) || (item.source === "app" && item.fixed === "own")),
});

const names = (raw: unknown, keep: (name: string) => boolean = () => true): string[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const kept = [...new Set(raw.filter((v): v is string => typeof v === "string" && v.trim() !== "" && keep(v)))];
  return kept.length ? kept : undefined;
};

/** A stored choice, checked; undefined when it changes nothing. */
export function readExtensionChoice(raw: unknown): ExtensionChoice | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const choice: ExtensionChoice = {};
  const skillsOff = names(r.skillsOff);
  const agentsOff = names(r.agentsOff);
  const mcpOff = names(r.mcpOff, (name) => !isOwnMcpServer(name));
  if (skillsOff) choice.skillsOff = skillsOff;
  if (agentsOff) choice.agentsOff = agentsOff;
  if (mcpOff) choice.mcpOff = mcpOff;
  if (typeof r.plugins === "object" && r.plugins !== null && !Array.isArray(r.plugins)) {
    const plugins = Object.fromEntries(Object.entries(r.plugins).filter(([id, on]) => id.trim() !== "" && typeof on === "boolean"));
    if (Object.keys(plugins).length) choice.plugins = plugins as Record<string, boolean>;
  }
  return Object.keys(choice).length ? choice : undefined;
}

/** Whether `item` is on for a terminal with this choice. A fixed item is as it is; a plugin's skill is on with its plugin. */
export function isOn(kind: keyof ClaudeExtensions, item: ExtensionItem, choice: ExtensionChoice | undefined): boolean {
  if (item.fixed === "own") return true;
  if (item.fixed === "plugin") return (item.plugin ? choice?.plugins?.[item.plugin] : undefined) ?? item.enabled;
  switch (kind) {
    case "plugins":
      return choice?.plugins?.[item.id] ?? item.enabled;
    case "skills":
      return item.enabled && !choice?.skillsOff?.includes(item.id);
    case "agents":
      return item.enabled && !choice?.agentsOff?.includes(item.id);
    case "mcp":
      return item.enabled && !choice?.mcpOff?.includes(item.id);
  }
}

/**
 * Whether a terminal's choice can switch `item`. A plugin turns on as well as
 * off; a skill, MCP server or subagent only turns off what the user's settings
 * (or its plugin) leave on.
 */
export function canSwitch(kind: keyof ClaudeExtensions, item: ExtensionItem): boolean {
  if (item.fixed || (kind === "mcp" && isOwnMcpServer(item.id))) return false;
  return kind === "plugins" || item.enabled;
}

/**
 * The choice after `item` is switched to `on`. A plugin switched back to what
 * the user's settings give drops its entry; the result is undefined when the
 * choice no longer changes anything.
 */
export function withItem(kind: keyof ClaudeExtensions, item: ExtensionItem, on: boolean, choice: ExtensionChoice | undefined): ExtensionChoice | undefined {
  const next: ExtensionChoice = { ...choice };
  if (kind === "plugins") {
    const plugins = { ...next.plugins };
    if (on === item.enabled) delete plugins[item.id];
    else plugins[item.id] = on;
    next.plugins = plugins;
  } else {
    const key = kind === "skills" ? "skillsOff" : kind === "agents" ? "agentsOff" : "mcpOff";
    const off = new Set(next[key] ?? []);
    if (on) off.delete(item.id);
    else off.add(item.id);
    next[key] = [...off];
  }
  return readExtensionChoice(next);
}

/**
 * The choice after every one of `items` is switched to `on`, one after the
 * other from `choice`: one change, stored once. An item no choice can switch
 * (`canSwitch`) is left as it is.
 */
export function withItems(kind: keyof ClaudeExtensions, items: readonly ExtensionItem[], on: boolean, choice: ExtensionChoice | undefined): ExtensionChoice | undefined {
  return items.reduce((next, item) => (canSwitch(kind, item) ? withItem(kind, item, on, next) : next), choice);
}
