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
  /**
   * The most it may get, kind by kind: what its spawner has, set by Rust's check (a kind with no cap is left out) and
   * read again at each launch. A sub-agent gets at most what its spawner has, so a restricted one cannot widen its children.
   */
  ceiling?: Partial<Record<ExtraKind, string[]>>;
}

export const EXTRA_KINDS = ["skills", "mcpServers", "plugins"] as const;
export type ExtraKind = (typeof EXTRA_KINDS)[number];

/** What restricts a sub-agent's spawner: its own pick, and the switches it set off in its Edit panel (`ExtensionChoice`, Claude). */
export interface Spawner {
  extras?: SubagentExtras;
  extensions?: unknown;
}

/** Why a listed item cannot be picked: dummyPlane's server, a plugin's own item, a project server the user has not approved, a name Codex's line cannot carry. */
export type ExtraLock = "own" | "plugin" | "approval" | "name";

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

/** The kinds of a stored pick or ceiling, each a list of names (an empty one kept: it means none). */
function kindsOf(raw: unknown): Partial<Record<ExtraKind, string[]>> {
  const kinds: Partial<Record<ExtraKind, string[]>> = {};
  if (typeof raw !== "object" || raw === null) return kinds;
  for (const kind of EXTRA_KINDS) {
    const list = names((raw as Record<string, unknown>)[kind]);
    if (list) kinds[kind] = list;
  }
  return kinds;
}

/** A stored pick, checked: each kind a list of names (an empty one kept: it means none); undefined when no kind is picked. */
export function readSubagentExtras(raw: unknown): SubagentExtras | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const extras: SubagentExtras = kindsOf(raw);
  if (Object.keys(extras).length === 0) return undefined;
  const ceiling = kindsOf((raw as Record<string, unknown>).ceiling);
  if (Object.keys(ceiling).length) extras.ceiling = ceiling;
  return extras;
}

/** The skills, MCP servers and plugins a sub-agent on `agent` in `cwd` (with this profile folder, for Claude) could be given. */
export const subagentExtras = (agent: AgentId, cwd: string, configDir?: string) =>
  call<InstalledExtras>("subagent_extras", { agent, cwd, configDir: configDir ?? null });

/**
 * A pick as Rust checked it against what the sub-agent's CLI loads and what its `spawner` has (none when nothing
 * restricts it), its ceiling in it; rejects with why it is refused.
 */
export const checkSubagentExtras = (agent: AgentId, cwd: string, configDir: string | undefined, pick: SubagentExtras, spawner?: Spawner) =>
  call<unknown>("check_subagent_extras", { agent, cwd, configDir: configDir ?? null, pick, ...(spawner ? { spawner } : {}) }).then((raw) => readSubagentExtras(raw) ?? {});
