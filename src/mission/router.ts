import type { AgentId } from "@/ipc/pty";

/** How hard a sub-task is: with the router on, it chooses the agent's model. */
export type Level = "faible" | "moyen" | "eleve" | "extreme";

/**
 * The models dummyPlane names, the current family, lightest first: the only place their ids are written. The router's
 * levels and the edit panel's choices both read them, so a new version is one line here.
 */
const MODELS = {
  haiku: { model: "claude-haiku-5-5", modelLabel: "Haiku 5.5" },
  sonnet: { model: "claude-sonnet-5-5", modelLabel: "Sonnet 5.5" },
  opus: { model: "claude-opus-5-5", modelLabel: "Opus 5.5" },
  fable: { model: "claude-fable-5-2", modelLabel: "Fable 5.2" },
} as const;

export const LEVELS: Record<Level, { label: string; model: string; modelLabel: string }> = {
  faible: { label: "low", ...MODELS.haiku },
  moyen: { label: "medium", ...MODELS.sonnet },
  eleve: { label: "high", ...MODELS.opus },
  extreme: { label: "extreme", ...MODELS.fable },
};

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

/** A level's key, accents and case aside. */
export function readLevel(raw: unknown): Level | undefined {
  if (typeof raw !== "string") return undefined;
  const folded = fold(raw);
  return (Object.keys(LEVELS) as Level[]).find((level) => level === folded);
}

/** The table the router reads, as a sentence's tail: "low Haiku 5.5, medium Sonnet 5.5, …". Built from LEVELS, never retyped. */
export const ROUTER_LEVELS = (Object.values(LEVELS) as { label: string; modelLabel: string }[]).map((l) => `${l.label} ${l.modelLabel}`).join(", ");

/**
 * The CLIs besides Claude that dummyPlane passes a model to, whose levels the user maps in Settings: Codex alone
 * (`-m`). Claude's levels are LEVELS'. Ollama's model is what its terminal launches, never a sub-agent's or a team
 * agent's, and the other CLIs take no model from dummyPlane.
 */
export const MAPPED_CLIS = ["codex"] as const;
export type MappedCli = (typeof MAPPED_CLIS)[number];
const LEVEL_KEYS = Object.keys(LEVELS) as Level[];

/** A model for each level of a mapped CLI, as the user wrote it in Settings; a level left out is not routed on that CLI. */
export type CliLevels = Partial<Record<MappedCli, Partial<Record<Level, string>>>>;

/**
 * A model id another CLI is started with: what Rust's `checked_model` lets into a command line (64 characters at
 * most, a letter or digit first, then letters, digits and `-._[]`), never a Claude name, which a non-Claude terminal
 * is never given (`@/nodes/terminal/launch`).
 */
const CLI_MODEL = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,63}$/;
/** A Claude model or alias (opus, claude-sonnet-5-5…): never passed to another CLI. */
export const CLAUDE_MODEL_NAME = /^(claude|haiku|sonnet|opus|fable)/i;

/** A model typed for a mapped CLI, trimmed, or undefined when empty or not one its command line would take. */
export function readCliModel(raw: unknown): string | undefined {
  const model = typeof raw === "string" ? raw.trim() : "";
  return CLI_MODEL.test(model) && !CLAUDE_MODEL_NAME.test(model) ? model : undefined;
}

/** A stored level map, checked: an unknown CLI, an unknown level or a model no command line would take is dropped. */
export function readCliLevels(raw: unknown): CliLevels {
  const levels: CliLevels = {};
  if (typeof raw !== "object" || raw === null) return levels;
  for (const cli of MAPPED_CLIS) {
    const stored = (raw as Record<string, unknown>)[cli];
    if (typeof stored !== "object" || stored === null) continue;
    const models: Partial<Record<Level, string>> = {};
    for (const level of LEVEL_KEYS) {
      const model = readCliModel((stored as Record<string, unknown>)[level]);
      if (model) models[level] = model;
    }
    if (Object.keys(models).length) levels[cli] = models;
  }
  return levels;
}

const isMapped = (cli: AgentId): cli is MappedCli => (MAPPED_CLIS as readonly string[]).includes(cli);

/**
 * The model a level picks on `cli`: Claude's from LEVELS, another CLI's from the user's map (`levels`); none when
 * that CLI has no model for the level, or takes none from dummyPlane.
 */
export function levelModel(cli: AgentId, level: Level, levels: CliLevels): string | undefined {
  if (cli === "claude") return LEVELS[level].model;
  return isMapped(cli) ? levels[cli]?.[level] : undefined;
}

/** Whether any level picks a model on `cli`: always on Claude, on another CLI once the user mapped one. */
export function cliRouted(cli: AgentId, levels: CliLevels): boolean {
  return LEVEL_KEYS.some((level) => levelModel(cli, level, levels) !== undefined);
}

/** The models a terminal's edit panel offers for its next launch (`--model`): the current family, lightest first. */
export const MODEL_CHOICES: readonly { model: string; modelLabel: string }[] = Object.values(MODELS);

/** A Claude model's id, family and version: `claude-fable-5-1`; never a date (`claude-sonnet-4-20250514`). */
const CLAUDE_ID = /^claude-([a-z]+)-(\d{1,2})-(\d{1,2})$/;

/**
 * "Haiku 5.5" for the models dummyPlane chooses; a Claude model of another version by its family and version (a
 * terminal a mission started on `claude-fable-5-1` says "Fable 5.1"); the name itself for any other.
 */
export function modelLabel(model: string): string {
  const known = MODEL_CHOICES.find((choice) => choice.model === model)?.modelLabel;
  if (known) return known;
  const id = CLAUDE_ID.exec(model);
  return id ? `${id[1].charAt(0).toUpperCase()}${id[1].slice(1)} ${id[2]}.${id[3]}` : model;
}

/**
 * A model as a settings file names it: "Opus 5.5" for a model dummyPlane knows, an alias as written with its
 * first letter up ("opus" → "Opus", "sonnet[1m]" → "Sonnet[1m]"). Never a version an alias doesn't name.
 */
export function settingsModelLabel(model: string): string {
  const known = modelLabel(model);
  return known !== model ? known : model.charAt(0).toUpperCase() + model.slice(1);
}

/** Claude Code's effort levels, lightest first: what `claude --effort` takes (checked against Claude Code 2.1.322). */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** A stored effort level, checked: anything else (a level of another version, a typo) is no level. */
export const readEffort = (raw: unknown): EffortLevel | undefined => ((EFFORT_LEVELS as readonly unknown[]).includes(raw) ? (raw as EffortLevel) : undefined);
