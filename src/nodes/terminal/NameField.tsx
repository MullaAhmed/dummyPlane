import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n";
import { useNativeKeyDown } from "@/lib/useNativeKeyDown";
import { nodesMessages } from "@/nodes/messages";

/**
 * The name of a node in its header; a double-click edits it (the caller can
 * also start it, the palette's "Rename"), Enter or a click elsewhere keeps it,
 * Escape cancels. `onCommit` gets the trimmed text when it changed, empty
 * included: what an empty name means is the node's to say.
 */
export function NameField(props: { value: string; editing: boolean; onEditingChange: (editing: boolean) => void; onCommit: (name: string) => void }) {
  const { value, editing, onEditingChange, onCommit } = props;
  const t = useMessages(nodesMessages).header;
  if (!editing) {
    return (
      <span className="min-w-0 truncate text-(length:--text-ui) font-medium text-dp-text" onDoubleClick={() => onEditingChange(true)} title={t.doubleClickRename}>
        {value}
      </span>
    );
  }
  return (
    <NameInput
      initial={value}
      onDone={(name) => {
        if (name !== null && name !== value) onCommit(name);
        onEditingChange(false);
      }}
    />
  );
}

/**
 * Mounted while editing, so its key listener finds the field. Its keys are
 * handled natively, and stop there (useNativeKeyDown): Excalidraw would take an
 * Escape to deactivate the node, and a Backspace after it to delete it.
 */
function NameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useNativeKeyDown(input, (e) => {
    // Enter that accepts an IME's candidate is not Enter for the field.
    if (e.isComposing) return;
    if (e.key === "Enter") input.current?.blur();
    if (e.key === "Escape") {
      cancelled.current = true;
      onDone(null);
    }
  });
  return (
    <Input
      ref={input}
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => {
        if (!cancelled.current) onDone(draft.trim());
      }}
      className="h-7 max-w-52 min-w-0 flex-1 rounded-md bg-dp-field px-1.5 text-(length:--text-ui) font-medium md:text-(length:--text-ui)"
    />
  );
}
