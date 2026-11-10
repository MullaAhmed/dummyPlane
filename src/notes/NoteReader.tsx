import { useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Checkbox } from "@/components/ui/checkbox";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { noteNamed } from "./links";
import { parseInline, parseMarkdown, type Block } from "./markdown";
import { notesMessages } from "./messages";

interface Props {
  text: string;
  notes: readonly { name: string }[];
  /** A wikilink to an existing note. */
  onOpen: (name: string) => void;
  /** A wikilink to a note that does not exist yet. */
  onCreate: (name: string) => void;
}

/** Hierarchy from size, then from ink: the three smallest levels share a size and step down in colour. */
const HEADINGS = ["text-lg", "text-base", "text-sm", "text-sm text-dp-text-2", "text-sm text-dp-text-2", "text-sm text-dp-text-2"];
/**
 * A link inside the prose stays a bare <button>: it must wrap with the words around it,
 * which shadcn's inline-flex Button, a control of its own height, cannot.
 */
const LINK =
  "rounded-sm underline underline-offset-2 transition-colors duration-150 ease-out hover:bg-dp-hover focus-visible:ring-2 focus-visible:ring-dp-accent/50 focus-visible:outline-none motion-reduce:transition-none";

/** A note, read: elements built by React from the parsed text, never HTML (spec notes §3). */
export function NoteReader({ text, notes, onOpen, onCreate }: Props) {
  const t = useMessages(notesMessages);
  const blocks = useMemo(() => parseMarkdown(text), [text]);

  const line = (source: string) =>
    parseInline(source).map((span, i) => {
      switch (span.kind) {
        case "text":
          return span.text;
        case "strong":
          return <strong key={i}>{span.text}</strong>;
        case "em":
          return <em key={i}>{span.text}</em>;
        case "strike":
          return <s key={i}>{span.text}</s>;
        case "code":
          return (
            <code key={i} className="rounded-sm bg-dp-field px-1 font-mono text-xs">
              {span.text}
            </code>
          );
        case "link":
          return (
            <button key={i} type="button" title={span.url} onClick={() => void openUrl(span.url)} className={cn("text-dp-accent-ink", LINK)}>
              {span.label}
            </button>
          );
        case "wikilink": {
          const target = noteNamed(notes, span.target);
          return (
            <button
              key={i}
              type="button"
              title={target ? target.name : t.deadLink(span.target)}
              onClick={() => (target ? onOpen(target.name) : onCreate(span.target))}
              className={cn(LINK, target ? "text-dp-accent-ink" : "text-dp-text-3 decoration-dotted")}
            >
              {span.label}
            </button>
          );
        }
      }
    });

  const block = (item: Block, i: number) => {
    switch (item.kind) {
      case "heading": {
        const Heading = `h${item.level}` as "h1";
        return (
          <Heading key={i} className={cn("mt-4 font-medium text-dp-text first:mt-0", HEADINGS[item.level - 1])}>
            {line(item.text)}
          </Heading>
        );
      }
      case "paragraph":
        return <p key={i}>{line(item.text)}</p>;
      case "quote":
        return (
          <blockquote key={i} className="border-l border-dp-line pl-3 text-dp-text-2">
            {line(item.text)}
          </blockquote>
        );
      case "rule":
        // A rule in the note's text is the document's own <hr>, not an interface divider.
        return <hr key={i} className="border-dp-line" />;
      case "code":
        return (
          <pre key={i} className="overflow-x-auto rounded-lg bg-dp-field p-3 font-mono text-xs leading-normal">
            <code>{item.text}</code>
          </pre>
        );
      case "list": {
        const List = item.ordered ? "ol" : "ul";
        return (
          <List key={i} className={cn("pl-5", item.ordered ? "list-decimal" : "list-disc")}>
            {item.items.map((entry, j) => (
              <li key={j} className={cn(entry.checked !== undefined && "list-none")}>
                {/* The note's own state, read here, changed in the editor. */}
                {entry.checked !== undefined && (
                  <Checkbox
                    checked={entry.checked}
                    disabled
                    aria-readonly
                    className="mr-1 -ml-5 inline-flex border-dp-text-3 align-middle disabled:cursor-default disabled:opacity-100"
                  />
                )}
                {line(entry.text)}
              </li>
            ))}
          </List>
        );
      }
    }
  };

  return (
    <div data-reader className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5">
      {blocks.length === 0 ? (
        <p className="text-xs text-dp-text-3">{t.emptyNote}</p>
      ) : (
        // About 72 characters a line at 14px: a reading measure, not the window's width.
        <div className="mx-auto flex max-w-xl flex-col gap-3 text-sm leading-6 text-dp-text">{blocks.map(block)}</div>
      )}
    </div>
  );
}
