import type { TerminalPayload } from "@/nodes/types";

/**
 * What a sub-agent was asked, said in one short line: the task an agent gave
 * with spawn_agent is a brief (markdown, a "You are…" preamble, setup steps,
 * paths), and the raw start of it says little under a name. Pure: the header,
 * the minimized card and the subagent cell all read it.
 */

/** The line's longest: past it, it is cut at a word with "…". */
export const MAX_LINE = 120;
/** The tooltip's excerpt of the task, at most. */
export const MAX_EXCERPT = 400;

/** The words of the sections about how to work, not what to do. */
const HOW_TO =
  "setup|set up|context|background|role|rules|constraints|conventions|notes?|requirements|finish(?:ing)?|when (?:you are|you're) done|done when|deliverables?|tests?|testing|verification|steps|instructions|before you start|files?(?: to \\p{L}+)?|references?|links?|resources|environment|tools?|output|report(?:ing)?";
/** How to end and report: a "Summary:" there says how to report, not the task. */
const AFTER = "finish(?:ing)?|report(?:ing)?|output|deliverables?|when (?:you are|you're) done|done when|verification|tests?|testing";
/** Headings that name no task, though what they head may say it. */
const NAMELESS = "overview|description|brief|introduction|intro|about|details|task|goal|objective|summary|the task|your task";

/**
 * The heading made of one of those words alone, or before a colon, a dash or
 * an aside ("Setup (do this first)"): "Test the spawn layout" is a task.
 */
const headingOf = (words: string) => new RegExp(`^(?:${words})\\s*(?:$|[:(—–]|-\\s)`, "iu");
const BOILERPLATE = headingOf(HOW_TO);
const AFTERWORD = headingOf(AFTER);
const GENERIC = headingOf(NAMELESS);
/** A paragraph that is a how-to label, "Context: …"; "Test the login flow…" is a task. */
const BOILERPLATE_LABEL = new RegExp(`^(?:${HOW_TO})\\s*:`, "iu");

/** A label whose text is the task itself: "Task: fix the header", "Goal — …", "## Goal"; "Task-runner…" is none. */
const LABEL = /^(task|goal|objective|mission|summary|tl;?dr|what to do|your task|the task|assignment|request|ask|problem)(?:\s*(?:[:—–]|\s-)\s*(.*))?$/i;

/** A tag the app puts before a brief, "[dummyPlane · sub-agent of Atlas]". */
const TAG = /^\[[^\]\n]{1,80}\]\s*/;

/** Full stops that end no sentence. */
const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "cf", "mr", "mrs", "ms", "dr", "st", "no", "fig", "approx"]);

/** How many words with letters: a path or a number alone says no task. */
const wordsIn = (text: string) => text.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

type BlockKind = "heading" | "prose" | "item";

interface Block {
  kind: BlockKind;
  text: string;
  /** The heading it sits under, "" before any. */
  section: string;
}

/** Inline markdown and HTML away, whitespace collapsed: the words as they read. */
export function plainText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?(br|p|div|span|b|i|em|strong|code|pre|kbd|sub|sup|details|summary|img|a|u|s)\b[^>]*>/gi, " ")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?=[^\w*]|$)/g, "$1$2")
    .replace(/(^|[^\w])_(?!\s)([^_]+?)_(?=[^\w]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** The brief's paragraphs, headings and list items, without its code, comments and tag. */
function blocksOf(task: string): Block[] {
  const text = task
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    // A fenced block, closed or left open to the end.
    .replace(/^\s*(```|~~~)[^\n]*\n[\s\S]*?(^\s*\1\s*$|(?![\s\S]))/gm, "")
    .trim()
    .replace(TAG, "");
  const blocks: Block[] = [];
  let section = "";
  let open: Block | null = null;
  const close = () => {
    if (open && open.text) blocks.push(open);
    open = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || /^([-*_]\s*){3,}$/.test(line) || line.startsWith("|")) {
      close();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      close();
      section = plainText(heading[1].replace(/\s+#+$/, ""));
      if (section) blocks.push({ kind: "heading", text: section, section });
      continue;
    }
    const item = /^(?:[-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (item) {
      close();
      open = { kind: "item", text: item[1], section };
      continue;
    }
    const body = line.replace(/^>\s?/, "");
    if (open) open.text = `${open.text} ${body}`;
    else open = { kind: "prose", text: body, section };
  }
  close();
  return blocks.map((b) => ({ ...b, text: plainText(b.text) })).filter((b) => /\p{L}/u.test(b.text));
}

/** The sentences of a paragraph; a path's or a version's dot ends none. */
export function sentencesOf(text: string): string[] {
  const out: string[] = [];
  const end = /([.!?…]+)(?=\s+["'“‘(\[\p{Lu}\p{Lo}\d])|([。！？])/gu;
  let start = 0;
  for (let match = end.exec(text); match; match = end.exec(text)) {
    const stop = match.index + match[0].length;
    const word = /(\S+)$/.exec(text.slice(start, match.index))?.[1].toLowerCase() ?? "";
    if (match[1] === "." && ABBREVIATIONS.has(word.replace(/^\W+/, ""))) continue;
    const sentence = text.slice(start, stop).trim();
    if (sentence) out.push(sentence);
    start = stop;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** "You are a senior engineer…": who the agent is, not what it does. */
const ROLE = /^you('| a)re (a|an|the|acting|playing|my|our)\b|^(act|acting) as\b|^(hi|hello|hey)\b[^.!?]*[.!?]?$/i;

/** The words before the task itself, taken off one after the other. */
const LEAD_INS = [
  /^you('| a)re\s+(?=\p{L}+ing\b)/iu,
  /^(your|the) (task|job|goal|mission|assignment|work)( here| now)? (is|will be)( to)?\s*:?\s*/i,
  /^(task|goal|objective|mission)\s*(?:[:—–]|\s-)\s*/i,
  /^(please|kindly)[,\s]+/i,
  /^(i|we) (need|want|would like|'d like) you to\s+/i,
  /^(can|could|would|will) you( please)?\s+/i,
  /^you (should|must|will|need to|have to|are to|are going to)\s+/i,
  /^(we need to|let's|lets)\s+/i,
  /^(then|next|finally),?\s+/i,
  // "First paint is slow", "Now playing…": a task, unless a comma says a lead-in.
  /^(first|now),\s+/i,
];

function withoutLeadIns(sentence: string): string {
  let text = sentence;
  for (let changed = true; changed; ) {
    changed = false;
    for (const lead of LEAD_INS) {
      const next = text.replace(lead, "");
      if (next !== text && next.trim()) {
        text = next;
        changed = true;
      }
    }
  }
  return text;
}

/** Asides in brackets away, while words remain; one left open at the end too. */
function withoutAsides(text: string): string {
  const bare = text
    .replace(/\s*\([^()]*\)/g, "")
    .replace(/\s*\([^()]*$/, "")
    .trim();
  return wordsIn(bare) >= 2 ? bare : text;
}

/** At most `max` characters, cut at a word, with "…". */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** A capital for a plain word, not for a name or a path ("dummyPlane", "src/…"). */
const capitalized = (text: string) => (/^\p{Ll}+(?=[\s,;:]|$)/u.test(text) ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text);

/** One sentence said as a line: no lead-in, no aside, no closing stop, a capital. */
function asLine(sentence: string): string {
  const line = withoutAsides(withoutLeadIns(sentence))
    .replace(/\?$/, "")
    .replace(/[\s.:;,]+$/, "")
    .trim();
  return clip(capitalized(line || sentence.trim()), MAX_LINE);
}

/** A how-to section, by its heading. */
const isBoilerplate = (heading: string) => BOILERPLATE.test(heading);
/** A how-to paragraph, by its label. */
const isHowTo = (prose: string) => BOILERPLATE_LABEL.test(prose);

/**
 * The block that says the task: a labelled one ("Task: …", "## Goal"), else a
 * heading that opens the brief as its title, else the first paragraph outside
 * the how-to sections.
 */
function taskBlock(blocks: Block[]): { text: string; labelled: boolean } | null {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind !== "heading" && AFTERWORD.test(blocks[i].section)) continue;
    const label = LABEL.exec(blocks[i].text);
    if (!label) continue;
    if (label[2]?.trim()) return { text: label[2].trim(), labelled: true };
    // "## Goal" alone: the paragraph or item under it.
    const next = blocks[i + 1];
    if (blocks[i].kind === "heading" && next && next.kind !== "heading") return { text: next.text, labelled: true };
  }
  const top = blocks[0];
  if (top?.kind === "heading" && !isBoilerplate(top.text) && !GENERIC.test(top.text) && wordsIn(top.text) >= 2) return { text: top.text, labelled: true };
  const prose = blocks.filter((b) => b.kind === "prose" && !isBoilerplate(b.section) && !isHowTo(b.text) && wordsIn(b.text) >= 2);
  // A paragraph that only says who the agent is gives way to the next one.
  const first =
    prose.find((b) => sentencesOf(b.text).some((s) => !ROLE.test(s))) ??
    prose[0] ??
    blocks.find((b) => b.kind === "prose") ??
    blocks.find((b) => b.kind === "heading" && !isBoilerplate(b.text) && !GENERIC.test(b.text)) ??
    blocks.find((b) => b.kind === "item") ??
    blocks[0];
  return first ? { text: first.text, labelled: false } : null;
}

/**
 * The task said in a line: its first meaningful sentence, without markdown, a
 * "You are…" preamble or setup boilerplate. Never empty for a task with words.
 */
export function taskSummary(task: string): string {
  const block = taskBlock(blocksOf(task));
  if (!block) return clip(plainText(task.replace(TAG, "")), MAX_LINE);
  const sentences = sentencesOf(block.text);
  // A first sentence that only says who the agent is gives way to the next one.
  const sentence = (!block.labelled && sentences.find((s) => !ROLE.test(s))) || sentences[0] || block.text;
  return asLine(sentence);
}

/**
 * The task as a tooltip reads it: its paragraphs and items from where the task
 * starts, plain text, at most `max` characters cut at a word.
 */
export function taskExcerpt(task: string, max = MAX_EXCERPT): string {
  const blocks = blocksOf(task);
  const start = blocks.findIndex((b) => b.kind !== "heading" && !isBoilerplate(b.section) && !isHowTo(b.text));
  const kept = blocks.slice(Math.max(0, start)).filter((b) => b.kind !== "heading" && !isBoilerplate(b.section));
  const text = (kept.length ? kept : blocks).map((b) => b.text).join("\n");
  return clip(text, max);
}

/** What a spawned terminal shows under its name, and what its tooltip says; null for any other terminal. */
export function spawnedTask(payload: Pick<TerminalPayload, "spawnedBy" | "task" | "title">): { line: string; detail: string } | null {
  if (!payload.spawnedBy && !payload.task) return null;
  const title = payload.title.trim();
  // Its title is the spawner's own, or already said from its task (spawn.ts); one saved before then was the task's raw start.
  const line = payload.task ? title || taskSummary(payload.task) : title && taskSummary(title);
  if (!line) return null;
  const excerpt = payload.task ? taskExcerpt(payload.task) : "";
  return { line, detail: excerpt && excerpt !== line ? excerpt : title || line };
}
