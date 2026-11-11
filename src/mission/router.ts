/** How hard a sub-task is (spec update §3): with the router on, it chooses the agent's model. */
export type Level = "faible" | "moyen" | "eleve" | "extreme";

export const LEVELS: Record<Level, { label: string; model: string; modelLabel: string }> = {
  faible: { label: "low", model: "claude-haiku-5-5", modelLabel: "Haiku 5.5" },
  moyen: { label: "medium", model: "claude-sonnet-5-5", modelLabel: "Sonnet 5.5" },
  eleve: { label: "high", model: "claude-opus-5-5", modelLabel: "Opus 5.5" },
  extreme: { label: "extreme", model: "claude-fable-5-1", modelLabel: "Fable 5.1" },
};

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

/** A level's key, accents and case aside. */
export function readLevel(raw: unknown): Level | undefined {
  if (typeof raw !== "string") return undefined;
  const folded = fold(raw);
  return (Object.keys(LEVELS) as Level[]).find((level) => level === folded);
}

/** The model of a sub-task: only with the mission's router on and a level given. */
export function modelFor(mission: { router?: boolean }, task: { level?: Level }): string | undefined {
  return mission.router && task.level ? LEVELS[task.level].model : undefined;
}

/** The models a terminal's edit panel offers for its next launch (`--model`): the current family, lightest first. */
export const MODEL_CHOICES: readonly { model: string; modelLabel: string }[] = [
  { model: "claude-haiku-5-5", modelLabel: "Haiku 5.5" },
  { model: "claude-sonnet-5-5", modelLabel: "Sonnet 5.5" },
  { model: "claude-opus-5-5", modelLabel: "Opus 5.5" },
  { model: "claude-fable-5-2", modelLabel: "Fable 5.2" },
];

/** "Haiku 5.5" for the models dummyPlane chooses, the name itself for any other. */
export function modelLabel(model: string): string {
  return [...MODEL_CHOICES, ...Object.values(LEVELS)].find((known) => known.model === model)?.modelLabel ?? model;
}
