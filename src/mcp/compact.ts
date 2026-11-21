import { messages } from "@/i18n";
import { cutWhole } from "@/lib/cut";
import { oneLine } from "@/mission/mission";
import { agentMessages } from "./messages";

/**
 * The size of what the mission's and the boards' tools answer. Claude Code refuses an MCP result of more than 25,000
 * tokens and hands the agent a file path instead of the answer (it warns from 10,000): `mission`, `team` and `board`
 * did so ten times in the sessions of 10 to 13 November, from 65 KB up (`team` alone, pretty-printed, 128 KB for one
 * mission) — and the Manager that resumed had to read those files to learn the mission's state. JSON costs about
 * three characters a token, so 20,000 characters stay under the warning, a third of the smallest answer refused.
 * What does not fit is listed short, or left out with a count and the call that reads the rest (`fitted`).
 */
export const MAX_ANSWER_CHARS = 20_000;

/** A brief, a card's notes or a report in a list: long enough to say what it is, short enough for sixty of them. */
export const LISTED_CHARS = 200;
/** The same, in the answer about one item alone: a whole brief or report is rarely longer. */
export const DETAIL_CHARS = 6_000;

const t = () => messages(agentMessages).answers;

/**
 * `text` on one line, cut to `max` characters; what was left out is counted, with `how`, the call that reads the whole
 * of it (the agent asks with the same tool and one more argument).
 */
export function shortened(text: string, max: number, how: string): string {
  const line = oneLine(text);
  return line.length <= max ? line : `${cutWhole(line, max)}${t().cut(line.length - max, how)}`;
}

/** `shortened` for the answer about one item: its line breaks kept (a brief, a card's notes are written in lines). */
export function shortenedKeepingLines(text: string, max: number, how: string): string {
  return text.length <= max ? text : `${cutWhole(text, max)}${t().cut(text.length - max, how)}`;
}

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;
/** A list the answer breaks into one line per item. */
const isList = (value: unknown): value is object[] => Array.isArray(value) && value.length > 0 && value.every(isObject);

/**
 * JSON with one line for each item of a list of objects (a member, a card, a sub-task) and no indentation: the same
 * data as `JSON.stringify(value, null, 2)`, a fifth of its size, and still one thing to read per line. The lists of
 * texts and the objects with no list of objects in them stay on their line.
 */
export function lined(value: unknown): string {
  if (isList(value)) return `[\n${value.map(lined).join(",\n")}\n]`;
  if (isObject(value) && !Array.isArray(value) && Object.values(value).some((entry) => isList(entry) || (isObject(entry) && !Array.isArray(entry) && Object.values(entry).some(isList)))) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => `${JSON.stringify(key)}:${lined(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * `build(shown)`, the answer with its first `shown` items, for the most items whose answer fits `budget`: every one
 * when they fit, else the biggest list that does (`build` says how many are left out, and how to read them).
 */
export function fitted(total: number, build: (shown: number) => string, budget = MAX_ANSWER_CHARS): string {
  const whole = build(total);
  if (whole.length <= budget) return whole;
  // The answer grows with the items shown: the largest count that fits, found by halving.
  let fits = 0;
  let over = total;
  while (fits + 1 < over) {
    const middle = Math.floor((fits + over) / 2);
    if (build(middle).length <= budget) fits = middle;
    else over = middle;
  }
  return build(fits);
}
