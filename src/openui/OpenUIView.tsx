import { useMemo, useState } from "react";
import { Renderer } from "@openuidev/react-lang";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { OutputActionsProvider } from "./actions";
import type { GeneratedTextProps } from "./GeneratedText";
import { outputLibrary } from "./library";
import { openuiMessages } from "./messages";
import { readOpenUI } from "./parse";
import { Markdown, Source } from "./parts";

/**
 * OpenUI Lang drawn with dummyPlane's library (`./GeneratedText.tsx` loads it
 * on demand). A text that does not parse to a root reads as Markdown; a
 * program with errors shows what parsed, says that some did not, and keeps its
 * source a click away; a crash while drawing it falls back to Markdown.
 */
export default function OpenUIView(props: GeneratedTextProps) {
  const { text, isStreaming = false, actions, className } = props;
  const t = useMessages(openuiMessages);
  const parsed = useMemo(() => readOpenUI(text), [text]);
  const [open, setOpen] = useState(false);
  if (!parsed) return <Markdown text={text} className={cn("text-sm", className)} />;
  // While it streams, a name not yet defined is only not written yet.
  const broken = parsed.meta.errors.some((error) => (error as { severity?: string }).severity !== "warning") || (!isStreaming && parsed.meta.unresolved.length > 0);
  return (
    <OutputActionsProvider value={actions ?? {}}>
      <div data-openui className={cn("flex min-w-0 flex-col gap-2", className)}>
        <ErrorBoundary scope="generated text" fallback={() => <Markdown text={text} className="text-sm" />}>
          <Renderer response={text} library={outputLibrary} isStreaming={isStreaming} />
        </ErrorBoundary>
        {broken && !isStreaming && (
          <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-dp-text-2">
            {t.notShown}
            <button type="button" className="rounded-sm text-dp-accent-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/70" onClick={() => setOpen((v) => !v)}>
              {open ? t.hideSource : t.showSource}
            </button>
          </p>
        )}
        {broken && open && <Source text={text} />}
      </div>
    </OutputActionsProvider>
  );
}
