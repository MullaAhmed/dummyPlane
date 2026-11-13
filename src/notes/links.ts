import { isNoteName } from "./names";

export interface WikiLink {
  target: string;
  label: string;
}

export interface LinkedNote {
  name: string;
  text: string;
}

export interface Edge {
  from: string;
  to: string;
}

const FENCE = /^(```|~~~)/;
const INLINE_CODE = /`[^`\n]*`/g;
const WIKILINK = /\[\[([^[\]\n]+)\]\]/g;

/**
 * The text without its fenced code, by the reader's rules (`./markdown` parseMarkdown): a line that starts a fence
 * once trimmed (an indented one too) opens it, a line starting with the same marker closes it, and one never closed
 * runs to the end. What the reader shows as code is no link.
 */
function withoutFences(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const fence = FENCE.exec(lines[i].trim());
    if (!fence) {
      kept.push(lines[i]);
      continue;
    }
    for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++);
  }
  return kept.join("\n");
}

/** `[[target]]` or `[[target|label]]`; null when the target could not be a note. */
export function readLink(inner: string): WikiLink | null {
  const bar = inner.indexOf("|");
  const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  const label = bar === -1 ? target : inner.slice(bar + 1).trim();
  return isNoteName(target) ? { target, label: label || target } : null;
}

/** The note's links, in order, code left out. */
export function linksIn(text: string): WikiLink[] {
  const prose = withoutFences(text).replace(INLINE_CODE, "");
  return [...prose.matchAll(WIKILINK)].flatMap((match) => readLink(match[1]) ?? []);
}

const key = (name: string) => name.toLowerCase();

/** The note a link means: names compare without their case, as in Obsidian. */
export function noteNamed<N extends { name: string }>(notes: readonly N[], name: string): N | null {
  return notes.find((note) => key(note.name) === key(name)) ?? null;
}

/** The notes that link to `name`, itself left out. */
export function backlinks<N extends LinkedNote>(notes: readonly N[], name: string): N[] {
  return notes.filter((note) => key(note.name) !== key(name) && linksIn(note.text).some((link) => key(link.target) === key(name)));
}

/** The links between existing notes, named as the notes are: one per pair, a note answering another draws no second line. */
export function edges(notes: readonly LinkedNote[]): Edge[] {
  const found = new Map<string, Edge>();
  for (const note of notes) {
    for (const link of linksIn(note.text)) {
      const target = noteNamed(notes, link.target);
      if (!target || target === note) continue;
      const pair = [note.name, target.name].sort().join("\0");
      if (!found.has(pair)) found.set(pair, { from: note.name, to: target.name });
    }
  }
  return [...found.values()];
}
