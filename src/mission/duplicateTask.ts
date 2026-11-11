import { MAX_STORED_TASK } from "@/nodes/types";

/**
 * Two agents on one task: the guard an agent's `spawn_agent`, a Fleet's
 * `add_tasks` and `propose_plan` and the queue's start of a waiting task run
 * through before they open another agent. Pure: `./activeWork` reads who is at
 * work, this decides whether a new task is theirs again.
 *
 * It prefers missing a duplicate to blocking real work: a refusal costs an agent
 * a round trip, and two agents on different parts of one repo are normal.
 */

/** What an agent is doing, as the guard reads it. Only the first three are "at work". */
export type WorkState = "working" | "waiting" | "starting" | "idle" | "stopped" | "done";

/** An agent, and the task it holds if one was given. */
export interface ActiveWork {
  agentId: string;
  name: string;
  state: WorkState;
  /** Its task's title. */
  title?: string;
  /** Its task's brief: the instructions it was given. */
  brief?: string;
  /** The Kanban card it handles. */
  card?: string;
  /** A mission's agent: minutes spent, and its budget. */
  spentMin?: number;
  budgetMin?: number;
}

/** A task about to start. */
export interface Candidate {
  title?: string;
  brief?: string;
  card?: string;
}

const AT_WORK: ReadonlySet<WorkState> = new Set<WorkState>(["working", "waiting", "starting"]);

/** Idle (its turn ended, nothing under way), stopped, exited and done agents hold no task any more. */
export const isAtWork = (state: WorkState) => AT_WORK.has(state);

/** Briefs are compared as far as an agent's payload keeps them (`MAX_STORED_TASK`): a long brief is its own copy. */
const WINDOW = MAX_STORED_TASK;
/** Share of the words two briefs have in common, from which they are one task (Jaccard). */
export const SIMILAR = 0.7;
/** A sentence both briefs repeat, as much as this of its words: a rule they were both given, not the task. */
const SHARED_SENTENCE = 0.8;
/** A brief with fewer different words says too little to be told from another. */
const MIN_WORDS = 5;
/** A title this short ("Fix", "Tests") is a label, not a task. */
const MIN_TITLE = 4;

/** What is left of a title once case, accents, punctuation and spacing are folded. */
export function normalisedTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Words that tell nothing of a task: plain English, and what every agent brief repeats. */
const STOP = new Set(
  (
    "about above after again also always another because been before being between both cannot could does doing done down during each even every " +
    "first from further have having here into itself just keep know last like made make many might more most much must need never next once only " +
    "other over please same shall should since some such sure take than that their them then there these they this those through under until upon " +
    "very want were what when where which while will with within without would your yours " +
    // What every agent brief repeats.
    "agent branch change changed changes code commit commits ensure file files finish finished repo repository report reports step steps task tasks " +
    "using used work working worktree"
  ).split(" "),
);

const plain = (text: string) =>
  text
    .slice(0, WINDOW)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** The words of a text that say something: four letters or more, a plural folded, no stop word; each once, in order. */
function significantWords(text: string): string[] {
  const words: string[] = [];
  for (const raw of plain(text).match(/\p{L}{4,}/gu) ?? []) {
    const word = raw.length > 4 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw;
    if (!STOP.has(raw) && !STOP.has(word) && !words.includes(word)) words.push(word);
  }
  return words;
}

/** The words of each sentence of a text (a full stop, a colon, a semicolon or a line break ends one) that has any. */
const sentencesOf = (text: string): string[][] =>
  text
    .slice(0, WINDOW)
    .split(/(?<=[.!?:;])\s+|\r?\n+/)
    .map(significantWords)
    .filter((words) => words.length > 0);

function jaccard(a: readonly string[], b: readonly string[]): number {
  const other = new Set(b);
  const shared = a.filter((word) => other.has(word)).length;
  return shared / (a.length + b.length - shared);
}

const wordsOfAll = (sentences: readonly (readonly string[])[]) => [...new Set(sentences.flat())];

/**
 * The words of `sentences` that no sentence of `others` repeats. Briefs of one mission share rules
 * ("never push", "logs go in…"): what both repeat is no mark of one task, what is left is.
 */
const unshared = (sentences: readonly string[][], others: readonly string[][]) =>
  wordsOfAll(sentences.filter((sentence) => !others.some((other) => jaccard(sentence, other) >= SHARED_SENTENCE)));

/** Paths, file names and code names: what a brief aims at. `src/a.ts` and `src/b.ts` are two tasks, whatever else is repeated. */
const TARGETS = [
  /[\w@~.-]*[\\/][\w@~./\\-]*/g,
  /\b[\w-]+\.[a-z]{1,5}\b/gi,
  /\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g,
  /\b(?:[A-Z][a-z0-9]+){2,}\b/g,
  /\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g,
];

function targetsOf(text: string): Set<string> {
  const found = new Set<string>();
  for (const pattern of TARGETS) {
    for (const match of text.slice(0, WINDOW).match(pattern) ?? []) {
      // "and/or", "i.e.": a word, not a place; a path is at least `src/mcp` long.
      if (match.length >= (/[\\/]/.test(match) ? 7 : 4)) found.add(match.toLowerCase());
    }
  }
  return found;
}

/** Each brief aims at something the other does not: the same words, two different jobs. */
function differentTargets(a: string, b: string): boolean {
  const ours = targetsOf(a);
  const theirs = targetsOf(b);
  return [...ours].some((target) => !theirs.has(target)) && [...theirs].some((target) => !ours.has(target));
}

/**
 * Whether `candidate` is the task `work` already holds. The same card always is, a different one never;
 * else the same title once folded, or the same brief: most of its words shared (Jaccard {@link SIMILAR}), and most of
 * the words the two do not repeat from each other's sentences too (the rules they share leave the tasks to compare),
 * with enough words to say something — and not two jobs aimed at different files or names.
 */
function sameTask(candidate: Candidate, work: ActiveWork): boolean {
  if (candidate.card && work.card) return candidate.card === work.card;
  if (candidate.brief && work.brief && differentTargets(candidate.brief, work.brief)) return false;
  const title = candidate.title ? normalisedTitle(candidate.title) : "";
  if (title.length >= MIN_TITLE && work.title && normalisedTitle(work.title) === title) return true;
  if (!candidate.brief || !work.brief) return false;
  const ours = significantWords(candidate.brief);
  const theirs = significantWords(work.brief);
  if (ours.length < MIN_WORDS || theirs.length < MIN_WORDS || jaccard(ours, theirs) < SIMILAR) return false;
  const [ourSentences, theirSentences] = [sentencesOf(candidate.brief), sentencesOf(work.brief)];
  const [ourOwn, theirOwn] = [unshared(ourSentences, theirSentences), unshared(theirSentences, ourSentences)];
  // Every sentence repeated: the same brief. Else what each has of its own must be the same task.
  return (ourOwn.length === 0 && theirOwn.length === 0) || (ourOwn.length > 0 && theirOwn.length > 0 && jaccard(ourOwn, theirOwn) >= SIMILAR);
}

/**
 * The agent already on `candidate`'s task, or null. Only agents at work count: working, waiting or
 * starting. The caller itself is never in `active` (`./activeWork` leaves it out).
 */
export function findDuplicateWork(candidate: Candidate, active: readonly ActiveWork[]): ActiveWork | null {
  return active.find((work) => isAtWork(work.state) && sameTask(candidate, work)) ?? null;
}
