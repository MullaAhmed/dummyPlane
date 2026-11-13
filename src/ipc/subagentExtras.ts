import { call } from "./invoke";
import type { AgentId } from "./pty";

/**
 * What a parent agent picked for its sub-agent with spawn_agent (`agents::extras`): by kind, the skills, MCP servers
 * and plugins it gets among those its CLI loads in its folder. A kind left out gets the CLI's defaults; an empty list
 * none of that kind. A plugin's own skills and MCP servers come with the plugin; dummyPlane's server is always kept.
 * Stored on the sub-agent's terminal and read at each of its launches, where Rust checks every name again.
 */
export interface SubagentExtras {
  skills?: string[];
  mcpServers?: string[];
  plugins?: string[];
}

export const EXTRA_KINDS = ["skills", "mcpServers", "plugins"] as const;
export type ExtraKind = (typeof EXTRA_KINDS)[number];

/** Why a listed item cannot be picked: dummyPlane's server, a plugin's own item, a server off in the user's settings, a name Codex's line cannot carry. */
export type ExtraLock = "own" | "plugin" | "off" | "name";

/** One skill, MCP server or plugin a sub-agent can be given. Mirrors Rust's `Extra`. */
export interface ExtraItem {
  name: string;
  description?: string;
  /** On when the pick leaves its kind out. */
  on: boolean;
  /** The plugin it comes with (`name@marketplace`). */
  plugin?: string;
  locked?: ExtraLock;
}

/** What a sub-agent's CLI loads in its folder. Mirrors Rust's `Installed`. */
export type InstalledExtras = Record<ExtraKind, ExtraItem[]>;

const names = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  return [...new Set(raw.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean))];
};

/** A stored pick, checked: each kind a list of names (an empty one kept: it means none); undefined when no kind is picked. */
export function readSubagentExtras(raw: unknown): SubagentExtras | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const extras: SubagentExtras = {};
  for (const kind of EXTRA_KINDS) {
    const list = names(r[kind]);
    if (list) extras[kind] = list;
  }
  return Object.keys(extras).length ? extras : undefined;
}

/** The skills, MCP servers and plugins a sub-agent on `agent` in `cwd` (with this profile folder, for Claude) could be given. */
export const subagentExtras = (agent: AgentId, cwd: string, configDir?: string) =>
  call<InstalledExtras>("subagent_extras", { agent, cwd, configDir: configDir ?? null });

/** A pick as Rust checked it against what the sub-agent's CLI loads; rejects with why it is refused. */
export const checkSubagentExtras = (agent: AgentId, cwd: string, configDir: string | undefined, pick: SubagentExtras) =>
  call<unknown>("check_subagent_extras", { agent, cwd, configDir: configDir ?? null, pick }).then((raw) => readSubagentExtras(raw) ?? {});
