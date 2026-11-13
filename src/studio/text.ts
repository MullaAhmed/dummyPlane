export type Eol = "\n" | "\r\n";

/** The ending most lines use. CodeMirror works in LF: a CRLF file must come back in CRLF. */
export function detectEol(text: string): Eol {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

export const toLf = (text: string) => text.replace(/\r\n?/g, "\n");

export const withEol = (lfText: string, eol: Eol) => (eol === "\n" ? lfText : lfText.replace(/\n/g, eol));

/**
 * The text to write for the editor's buffer (`lf`, in LF), given `raw`, the text as the disk has it: the lines
 * before the first change and after the last keep the ending they had there, those between take `eol`, the file's
 * dominant one. A file that mixes endings, or holds a lone CR, comes back as it was but for what was edited.
 */
export function withEndings(raw: string, lf: string, eol: Eol): string {
  const before = raw.split(/\r\n|\r|\n/);
  const endings = raw.match(/\r\n|\r|\n/g) ?? [];
  const after = lf.split("\n");
  const room = Math.min(before.length, after.length);
  let head = 0;
  while (head < room && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < room - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return after
    .map((line, i) => {
      if (i === after.length - 1) return line;
      const old = i < head ? endings[i] : i >= after.length - tail ? endings[i - after.length + before.length] : undefined;
      return line + (old ?? eol);
    })
    .join("");
}

export interface Replacement {
  from: number;
  to: number;
  insert: string;
}

/** What differs between two texts, as one replacement: a reload then leaves the cursor where it was. */
export function smallestChange(before: string, after: string): Replacement | null {
  if (before === after) return null;
  const shortest = Math.min(before.length, after.length);
  let start = 0;
  while (start < shortest && before[start] === after[start]) start++;
  let end = 0;
  while (end < shortest - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}
