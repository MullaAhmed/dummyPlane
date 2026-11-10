import { messages } from "@/i18n";
import { agentsMessages } from "./messages";

/**
 * A pantheon is a themed set of names (DC, Marvel…): each group draws its
 * agents' names from its own (spec theme §9.1). The first ones were mythologies.
 */
export type PantheonId = "dc" | "marvel" | "throne-of-glass" | "star-wars" | "lord-of-the-rings";

export interface Pantheon {
  id: PantheonId;
  label: string;
  /** One word each, letters only: a name is typed after `@`, quoted in a command line and used as a folder name. */
  names: readonly string[];
}

export const PANTHEONS: readonly Pantheon[] = [
  {
    id: "dc",
    get label() {
      return messages(agentsMessages).pantheons.dc;
    },
    names: ["Batman", "Superman", "Aquaman", "Flash", "Cyborg", "Robin", "Batgirl", "Nightwing", "Zatanna", "Raven", "Starfire", "Shazam", "Supergirl", "Hawkgirl", "Catwoman", "Joker"],
  },
  {
    id: "marvel",
    get label() {
      return messages(agentsMessages).pantheons.marvel;
    },
    names: ["Thor", "Hulk", "Loki", "Wolverine", "Storm", "Rogue", "Cyclops", "Ironman", "Deadpool", "Vision", "Groot", "Gamora", "Daredevil", "Hawkeye", "Wanda", "Spiderman"],
  },
  {
    id: "throne-of-glass",
    get label() {
      return messages(agentsMessages).pantheons["throne-of-glass"];
    },
    names: ["Celaena", "Aelin", "Rowan", "Dorian", "Chaol", "Manon", "Nehemia", "Lysandra", "Aedion", "Elide", "Fenrys", "Lorcan", "Yrene", "Nesryn", "Kaltain", "Abraxos"],
  },
  {
    id: "star-wars",
    get label() {
      return messages(agentsMessages).pantheons["star-wars"];
    },
    names: ["Luke", "Leia", "Han", "Yoda", "Chewbacca", "Anakin", "Ahsoka", "Padme", "Kenobi", "Rey", "Finn", "Lando", "Mando", "Grogu", "Maul", "Vader"],
  },
  {
    id: "lord-of-the-rings",
    get label() {
      return messages(agentsMessages).pantheons["lord-of-the-rings"];
    },
    names: ["Frodo", "Samwise", "Gandalf", "Aragorn", "Legolas", "Gimli", "Boromir", "Faramir", "Galadriel", "Elrond", "Arwen", "Eowyn", "Theoden", "Bilbo", "Pippin", "Eomer"],
  },
];

/**
 * The mythologies of the first versions are still saved in old workspaces and
 * groups. Each reads as one of the sets above, spread so that groups which had
 * their own set keep a set of their own.
 */
const LEGACY_SETS: ReadonlyMap<string, PantheonId> = new Map<string, PantheonId>([
  ["egyptian", "dc"],
  ["greek", "marvel"],
  ["norse", "throne-of-glass"],
  ["japanese", "star-wars"],
  ["celtic", "lord-of-the-rings"],
  ["hindu", "dc"],
  ["aztec", "marvel"],
  ["mesopotamian", "throne-of-glass"],
  ["slavic", "star-wars"],
  ["chinese", "lord-of-the-rings"],
  ["roman", "dc"],
  ["yoruba", "marvel"],
]);

/** The set an id stands for: a legacy mythology maps to one of today's sets, any other unknown id to the first. */
export function pantheonById(id: string | null | undefined): Pantheon {
  const wanted = id ? (LEGACY_SETS.get(id) ?? id) : undefined;
  return PANTHEONS.find((p) => p.id === wanted) ?? PANTHEONS[0];
}

/** The first set not used in the workspace; once all are, the first one again. */
export function nextPantheon(used: readonly (string | null | undefined)[]): PantheonId {
  const taken = new Set(used.filter(Boolean).map((id) => pantheonById(id).id));
  return (PANTHEONS.find((p) => !taken.has(p.id)) ?? PANTHEONS[0]).id;
}

/** The first name of the set nobody in the workspace has; then "Batman 2", "Superman 2"… */
export function nextName(pantheon: string, taken: readonly string[]): string {
  const names = pantheonById(pantheon).names;
  const used = new Set(taken.map((name) => name.toLowerCase()));
  for (let round = 1; ; round++) {
    for (const name of names) {
      const candidate = round === 1 ? name : `${name} ${round}`;
      if (!used.has(candidate.toLowerCase())) return candidate;
    }
  }
}
