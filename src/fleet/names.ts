import { messages } from "@/i18n";
import { fleetMessages } from "./messages";

/** Spec theme §9.1: each group draws its agents' names from its own pantheon. */
export type PantheonId =
  | "egyptian"
  | "greek"
  | "norse"
  | "japanese"
  | "celtic"
  | "hindu"
  | "aztec"
  | "mesopotamian"
  | "slavic"
  | "chinese"
  | "roman"
  | "yoruba";

export interface Pantheon {
  id: PantheonId;
  label: string;
  names: readonly string[];
}

export const PANTHEONS: readonly Pantheon[] = [
  {
    id: "egyptian",
    get label() {
      return messages(fleetMessages).pantheons.egyptian;
    },
    names: ["Isis", "Osiris", "Horus", "Anubis", "Thot", "Rê", "Bastet", "Sekhmet", "Ptah", "Hathor", "Nout", "Seth", "Maât", "Amon", "Khnoum", "Sobek"],
  },
  {
    id: "greek",
    get label() {
      return messages(fleetMessages).pantheons.greek;
    },
    names: ["Athéna", "Apollon", "Artémis", "Hermès", "Héra", "Zeus", "Poséidon", "Déméter", "Héphaïstos", "Arès", "Aphrodite", "Dionysos", "Hestia", "Perséphone", "Hadès", "Éos"],
  },
  {
    id: "norse",
    get label() {
      return messages(fleetMessages).pantheons.norse;
    },
    names: ["Odin", "Thor", "Freyja", "Loki", "Frigg", "Baldr", "Týr", "Heimdall", "Idunn", "Njörd", "Freyr", "Skadi", "Bragi", "Sif", "Vidar", "Hel"],
  },
  {
    id: "japanese",
    get label() {
      return messages(fleetMessages).pantheons.japanese;
    },
    names: ["Amaterasu", "Susanoo", "Tsukuyomi", "Inari", "Raijin", "Fūjin", "Hachiman", "Benzaiten", "Izanagi", "Izanami", "Ebisu", "Kannon", "Daikoku", "Ryūjin", "Sarutahiko", "Ōkuninushi"],
  },
  {
    id: "celtic",
    get label() {
      return messages(fleetMessages).pantheons.celtic;
    },
    names: ["Lugh", "Brigid", "Dagda", "Morrigan", "Cernunnos", "Epona", "Ogma", "Nuada", "Belenos", "Danu", "Taranis", "Rhiannon", "Arawn", "Manannán", "Aengus", "Boann"],
  },
  {
    id: "hindu",
    get label() {
      return messages(fleetMessages).pantheons.hindu;
    },
    names: ["Shiva", "Vishnu", "Brahma", "Lakshmi", "Ganesh", "Saraswati", "Parvati", "Durga", "Indra", "Agni", "Hanuman", "Kali", "Surya", "Varuna", "Krishna", "Rama"],
  },
  {
    id: "aztec",
    get label() {
      return messages(fleetMessages).pantheons.aztec;
    },
    names: ["Quetzalcoatl", "Tezcatlipoca", "Huitzilopochtli", "Tlaloc", "Xochiquetzal", "Chalchiuhtlicue", "Mictlantecuhtli", "Coatlicue", "Xipe", "Mixcoatl", "Tonatiuh", "Ehecatl", "Centeotl", "Xolotl", "Metztli", "Coyolxauhqui"],
  },
  {
    id: "mesopotamian",
    get label() {
      return messages(fleetMessages).pantheons.mesopotamian;
    },
    names: ["Inanna", "Enki", "Enlil", "Marduk", "Ishtar", "Shamash", "Nanna", "Ninurta", "Ereshkigal", "Tiamat", "Anu", "Nabu", "Nergal", "Ninhursag", "Dumuzi", "Ashur"],
  },
  {
    id: "slavic",
    get label() {
      return messages(fleetMessages).pantheons.slavic;
    },
    names: ["Perun", "Veles", "Mokosh", "Svarog", "Dazhbog", "Stribog", "Lada", "Jarilo", "Morana", "Zorya", "Triglav", "Svetovid", "Kupala", "Rod", "Dodola", "Simargl"],
  },
  {
    id: "chinese",
    get label() {
      return messages(fleetMessages).pantheons.chinese;
    },
    names: ["Guanyin", "Nüwa", "Fuxi", "Pangu", "Houyi", "Nezha", "Erlang", "Mazu", "Shennong", "Zhurong", "Gonggong", "Leigong", "Caishen", "Xiwangmu", "Yandi", "Huangdi"],
  },
  {
    id: "roman",
    get label() {
      return messages(fleetMessages).pantheons.roman;
    },
    names: ["Jupiter", "Junon", "Minerve", "Mars", "Vénus", "Mercure", "Neptune", "Vulcain", "Diane", "Cérès", "Janus", "Vesta", "Bacchus", "Pluton", "Aurore", "Faunus"],
  },
  {
    id: "yoruba",
    get label() {
      return messages(fleetMessages).pantheons.yoruba;
    },
    names: ["Obatala", "Oshun", "Shango", "Yemoja", "Ogun", "Eshu", "Orunmila", "Oya", "Olokun", "Osanyin", "Oshosi", "Babalu", "Aganju", "Obba", "Yewa", "Ibeji"],
  },
];

/** The first pantheon not used in the workspace; past the twelfth, the first one again. */
export function nextPantheon(used: readonly (string | null | undefined)[]): PantheonId {
  const taken = new Set(used.filter(Boolean));
  return (PANTHEONS.find((p) => !taken.has(p.id)) ?? PANTHEONS[0]).id;
}

/** The first name of the pantheon nobody in the workspace has; then "Isis 2", "Osiris 2"… */
export function nextName(pantheon: string, taken: readonly string[]): string {
  const names = (PANTHEONS.find((p) => p.id === pantheon) ?? PANTHEONS[0]).names;
  const used = new Set(taken.map((name) => name.toLowerCase()));
  for (let round = 1; ; round++) {
    for (const name of names) {
      const candidate = round === 1 ? name : `${name} ${round}`;
      if (!used.has(candidate.toLowerCase())) return candidate;
    }
  }
}
