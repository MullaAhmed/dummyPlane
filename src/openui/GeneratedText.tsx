import { lazy, Suspense } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { cn } from "@/lib/utils";
import type { OutputActions } from "./actions";
import { looksLikeOpenUI } from "./detect";
import { Markdown, Source } from "./parts";

/** OpenUI's parser and renderer, loaded the first time some text is OpenUI Lang. */
const OpenUIView = lazy(() => import("./OpenUIView"));

export interface GeneratedTextProps {
  text: string;
  /** The text is still arriving: a name used before it is defined is not an error yet. */
  isStreaming?: boolean;
  /** What its Buttons do (send to an agent); without, they are disabled. */
  actions?: OutputActions;
  /** Show the raw text instead (the output node's "Show source"). */
  source?: boolean;
  className?: string;
}

/**
 * Text an agent or a model wrote, shown in the app's own style: OpenUI Lang
 * (a program with a `root =` line) through dummyPlane's library, anything
 * else as Markdown, so plain text and Markdown read as they always did.
 * OpenUI itself loads only when a text needs it (`./OpenUIView.tsx`); until
 * it is there, or if it cannot load, the raw text shows: never a blank.
 */
export function GeneratedText(props: GeneratedTextProps) {
  const { text, source = false, className } = props;
  if (source) return <Source text={text} />;
  if (!looksLikeOpenUI(text)) return <Markdown text={text} className={cn("text-sm", className)} />;
  return (
    <ErrorBoundary scope="generated text" fallback={() => <Source text={text} />}>
      <Suspense fallback={<Source text={text} />}>
        <OpenUIView {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
