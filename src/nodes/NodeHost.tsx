import { memo, useEffect, useRef } from "react";
import type { NonDeleted, ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import { useCanvas } from "@/canvas/canvasStore";
import { nodeKindOf } from "@/canvas/nodeElement";
import { keepOutOfTabOrder } from "@/canvas/tabStops";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CrashNotice } from "@/shell/CrashNotice";
import { FileNode } from "./file/FileNode";
import { KanbanNode } from "./kanban/KanbanNode";
import { NoteNode } from "./note/NoteNode";
import { FleetNode } from "./fleet/FleetNode";
import { OutputNode } from "./output/OutputNode";
import { SubagentNode } from "./subagent/SubagentNode";
import { TerminalNode } from "./terminal/TerminalNode";
import { useMessages } from "@/i18n";
import { nodesMessages } from "./messages";

/**
 * Renders the dummyPlane node behind an Excalidraw embeddable, chosen by its kind.
 * A render error stays in the node's frame; its process keeps running. The
 * node's id is on a wrapper that draws no box (`contents`): the node a press on
 * its controls activates (canvas/liveControls.ts), whatever its kind.
 */
export const NodeHost = memo(function NodeHost({ element }: { element: NonDeleted<ExcalidrawEmbeddableElement> }) {
  const box = useRef<HTMLDivElement>(null);
  // Only the active node is in the Tab order: the others' buttons and fields came ahead of the rails (tabStops.ts).
  const active = useCanvas((s) => s.activeNode === element.id);
  useEffect(() => (box.current && !active ? keepOutOfTabOrder(box.current) : undefined), [active]);
  return (
    <div ref={box} data-node-id={element.id} className="contents">
      <ErrorBoundary scope="node" fallback={(error, retry) => <CrashNotice error={error} retry={retry} compact />}>
        <NodeOfKind element={element} />
      </ErrorBoundary>
    </div>
  );
}, (prev, next) => prev.element.id === next.element.id);

function NodeOfKind({ element }: { element: NonDeleted<ExcalidrawEmbeddableElement> }) {
  const t = useMessages(nodesMessages);
  // A folded group keeps its terminals off the screen; their processes and screens go on.
  const hidden = useCanvas((s) => s.frames.some((f) => f.group?.folded && f.memberIds.includes(element.id)));
  if (hidden) return null;
  switch (nodeKindOf(element)) {
    case "terminal":
      return <TerminalNode nodeId={element.id} />;
    case "kanban":
      return <KanbanNode nodeId={element.id} />;
    case "note":
      return <NoteNode nodeId={element.id} />;
    case "fleet":
      return <FleetNode nodeId={element.id} />;
    case "file":
      return <FileNode nodeId={element.id} />;
    case "subagent":
      return <SubagentNode nodeId={element.id} />;
    case "output":
      return <OutputNode nodeId={element.id} />;
    default:
      return <div className="grid h-full place-items-center rounded-md border border-dp-line bg-dp-surface text-dp-text-2">{t.unknownNode}</div>;
  }
}
