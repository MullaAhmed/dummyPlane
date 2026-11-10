import { useMemo, useRef, type ReactNode } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type ThreadMessage } from "@assistant-ui/react";

/** The thread behind the field stays empty: what is sent goes to terminals, not to a chat. */
const NO_MESSAGES: readonly ThreadMessage[] = [];

/** The text a send carries: its text parts, in order. */
export function messageText(message: AppendMessage): string {
  return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/**
 * An assistant-ui composer with no model behind it. Its `ComposerPrimitive`s
 * (Root, Input, Send) work as in a chat, but a send hands the text to
 * `onSend` and the thread never runs, so Send is never held back waiting for
 * a reply that will not come.
 */
export function LocalComposer({ onSend, children }: { onSend: (text: string) => void; children: ReactNode }) {
  const latest = useRef(onSend);
  latest.current = onSend;
  // One adapter for the composer's life: the runtime reads it again after every render.
  const store = useMemo(
    () => ({
      messages: NO_MESSAGES,
      isRunning: false,
      // Resolves whatever becomes of the command: a rejection would put the sent text back in the field.
      onNew: async (message: AppendMessage) => {
        latest.current(messageText(message));
      },
    }),
    [],
  );
  const runtime = useExternalStoreRuntime(store);
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
