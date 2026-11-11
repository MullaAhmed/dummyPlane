import { useEffect, useRef } from "react";
import { StickyNote, X } from "lucide-react";
import { AGENTS } from "@/agents/catalog";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { useMessages } from "@/i18n";
import { useNativeKeyDown } from "@/lib/useNativeKeyDown";
import { MAX_NOTE_TEXT } from "@/nodes/types";
import { Hint } from "@/shell/buttons";
import { nodesStore, useNodes, type NodeRecord } from "@/store/nodes";
import { frameStyle } from "../terminal/frame";
import { MissingNode } from "../terminal/MissingNode";
import { HeaderButton } from "../terminal/NodeHeader";
import { noteMessages } from "./messages";
import { deleteNote } from "./notes";

/** What a note's title calls its host: an agent's name (its agent's when it has none), a Fleet's. */
function hostName(record: NodeRecord | undefined): string {
  if (record?.kind === "terminal") return record.payload.name || AGENTS[record.payload.agent].label;
  return record?.kind === "fleet" ? record.payload.name : "";
}

/**
 * A quick note (src/nodes/note): a small card of plain text beside a terminal
 * or a Fleet, on the panels' surface and inks, so it reads the same in the
 * three palettes. Its title names its host; once the host has closed, it says
 * it stands alone. Its ✕ deletes it, and a note with text can be taken back.
 */
export function NoteNode({ nodeId }: { nodeId: string }) {
  const t = useMessages(noteMessages);
  const text = useNodes((s) => {
    const record = s.nodes[nodeId];
    return record?.kind === "note" ? record.payload.text : null;
  });
  const hostId = useCanvas((s) => s.noteHosts[nodeId]);
  const host = useNodes((s) => (hostId ? hostName(s.nodes[hostId]) : ""));
  const selected = useCanvas((s) => s.view.selectedIds.includes(nodeId));
  // Its host's group folded: the note goes off the screen with it, as the group's terminals do.
  const hidden = useCanvas((s) => hostId !== undefined && s.frames.some((f) => f.group?.folded && f.memberIds.includes(hostId)));
  const field = useRef<HTMLTextAreaElement>(null);

  // Its keys are its own, as a name being edited keeps its (useNativeKeyDown): Excalidraw would take Delete or
  // Ctrl+Z for the note itself. Escape leaves the note: the note let go and unselected, so no key acts on it.
  useNativeKeyDown(field, (event) => {
    if (event.key !== "Escape" || event.isComposing) return;
    field.current?.blur();
    canvasStore.getState().api?.updateScene({ appState: { activeEmbeddable: null, selectedElementIds: {}, selectedGroupIds: {} } });
  });

  // The wheel scrolls a long note's text, not the canvas (Excalidraw listens below React's root); a short one lets the canvas pan.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    const listener = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && element.scrollHeight > element.clientHeight) event.stopPropagation();
    };
    element.addEventListener("wheel", listener);
    return () => element.removeEventListener("wheel", listener);
  }, [text === null, hidden]);

  if (hidden) return null;
  if (text === null) return <MissingNode text={t.notFound} />;

  const title = hostId ? t.titleOf(host) : t.title;
  return (
    <div data-note={nodeId} className="flex h-full flex-col overflow-hidden rounded-lg bg-dp-surface text-dp-text" style={frameStyle(selected, false)}>
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-dp-line pr-1 pl-3">
        <StickyNote aria-hidden className="size-3.5 shrink-0 text-dp-text-2" />
        {hostId ? (
          <span className="min-w-0 truncate text-xs text-dp-text-2">{title}</span>
        ) : (
          <Hint label={t.alone} side="bottom">
            <span tabIndex={0} data-alone className="min-w-0 truncate rounded-sm text-xs text-dp-text-2 outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/70">
              {title}
            </span>
          </Hint>
        )}
        <div className="ml-auto flex shrink-0 items-center">
          <HeaderButton label={t.delete} onClick={() => deleteNote(nodeId)}>
            <X />
          </HeaderButton>
        </div>
      </header>
      <textarea
        ref={field}
        aria-label={t.field(hostId ? host : "")}
        placeholder={t.placeholder}
        value={text}
        maxLength={MAX_NOTE_TEXT}
        spellCheck
        onChange={(event) => nodesStore.getState().update(nodeId, { text: event.target.value })}
        className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2 text-(length:--text-ui) leading-5 text-dp-text outline-none placeholder:text-dp-text-3 focus-visible:ring-2 focus-visible:ring-dp-accent/70 focus-visible:ring-inset"
      />
    </div>
  );
}
