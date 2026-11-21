import { messages } from "@/i18n";
import { agentsMessages } from "./messages";

/**
 * A pantheon is a themed set of names (DC, Marvel…): each group draws its
 * agents' names from its own. The first ones were mythologies.
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

/**
 * A name's first word: "Batman 2" is "batman" too. An agent named by the same word as another reads as the same agent
 * (a report, a `message_agent`, an `@`), so the numbered ones count against the plain name as it does against them.
 */
const stem = (name: string) => name.replace(/\s+\d+$/, "").toLowerCase();

/**
 * The first name of the set that nobody has (`taken`: the agents alive or on the canvas in the project, and the
 * members of its running missions). Once the whole set is in use, the first free name of another set, in order, so
 * that no agent is named after one that is still there; "Batman 2", "Superman 2"… only when every set is in use.
 */
export function nextName(pantheon: string, taken: readonly string[]): string {
  const own = pantheonById(pantheon);
  const used = new Set(taken.map((name) => name.toLowerCase()));
  const stems = new Set(taken.map(stem));
  const free = (names: readonly string[]) => names.find((name) => !stems.has(name.toLowerCase()));
  const first = free(own.names);
  if (first) return first;
  // The sets after its own, wrapping round to those before it.
  const at = PANTHEONS.findIndex((p) => p.id === own.id);
  for (let i = 1; i < PANTHEONS.length; i++) {
    const other = free(PANTHEONS[(at + i) % PANTHEONS.length].names);
    if (other) return other;
  }
  for (let round = 2; ; round++) {
    for (const name of own.names) {
      const candidate = `${name} ${round}`;
      if (!used.has(candidate.toLowerCase())) return candidate;
    }
  }
}
