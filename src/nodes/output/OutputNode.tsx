import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, LayoutPanelTop, X } from "lucide-react";
import { toast } from "sonner";
import { removeNode } from "@/agents/terminals";
import { useCanvas } from "@/canvas/canvasStore";
import { nodeLink } from "@/canvas/nodeElement";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { formatClock } from "@/i18n/format";
import { useMessages } from "@/i18n";
import { notify } from "@/mission/events";
import { oneLine } from "@/mission/mission";
import { HeaderButton, HeaderMenu, NodeHeader, NodeHeaderEnd, NodeTitle } from "@/nodes/terminal/NodeHeader";
import { MissingNode } from "@/nodes/terminal/MissingNode";
import { frameStyle, NODE_FRAME } from "@/nodes/terminal/frame";
import { GeneratedText } from "@/openui/GeneratedText";
import type { OutputActions } from "@/openui/actions";
import { cn } from "@/lib/utils";
import { nodeNameOf, terminalOf, useNodes } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { outputMessages } from "./messages";

function copy(text: string | Promise<string>, done: string, failed: (error: string) => string) {
  void Promise.resolve(text)
    .then((value) => navigator.clipboard.writeText(value))
    .then(
      () => toast(done),
      (error: unknown) => toast.error(failed(String(error))),
    );
}

/** The output as Markdown text; OpenUI's parser loads on demand. */
const asText = (ui: string) => import("@/openui/plainText").then((m) => m.generatedAsText(ui));

/**
 * What an agent showed with show_output: its OpenUI Lang drawn with
 * dummyPlane's library, read-only. The same header as a terminal's (its name
 * over a line, its buttons, the ⋯ menu); its body scrolls; a Button in it
 * types its message into the agent that showed it, on a click.
 */
export function OutputNode({ nodeId }: { nodeId: string }) {
  const t = useMessages(outputMessages);
  const record = useNodes((s) => s.nodes[nodeId]);
  const payload = record?.kind === "output" ? record.payload : undefined;
  const sourceId = payload?.source ?? "";
  const sourceName = useNodes((s) => (terminalOf(s.nodes[sourceId]) ? nodeNameOf(s.nodes[sourceId]) || "the agent" : ""));
  const selected = useCanvas((s) => s.view.selectedIds.includes(nodeId));
  const [source, setSource] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const title = payload?.title || t.untitled;

  // The wheel scrolls the output, not the canvas; Ctrl+wheel still zooms (Excalidraw listens below React's root).
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const listener = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
    };
    element.addEventListener("wheel", listener);
    return () => element.removeEventListener("wheel", listener);
  }, [payload !== undefined]);

  const actions = useMemo<OutputActions>(
    () =>
      sourceName
        ? {
            send: (message, label) => {
              if (!isRunning(sourceId)) {
                toast(t.notSent(sourceName));
                return;
              }
              notify(sourceId, `The user clicked “${oneLine(label)}” in your output “${oneLine(title)}”: ${oneLine(message)}`);
              toast(t.sent(label, sourceName));
            },
          }
        : {},
    [sourceId, sourceName, title, t],
  );

  if (!payload) return <MissingNode text={t.missing} />;
  const line = sourceName ? t.from(sourceName) : t.fromGone;
  const updated = payload.updatedAt ? t.updated(formatClock(payload.updatedAt, Date.now())) : "";

  return (
    <div data-output={nodeId} className={cn(NODE_FRAME, "bg-dp-surface text-dp-text")} style={frameStyle(selected, false)}>
      <NodeHeader>
        <LayoutPanelTop aria-hidden className="size-4 shrink-0 text-dp-text-2" />
        <NodeTitle name={<span className="min-w-0 truncate text-(length:--text-ui) font-medium text-dp-text">{title}</span>} line={line} detail={[title, updated].filter(Boolean).join("\n")} />
        <NodeHeaderEnd>
          <HeaderButton label={t.copy} onClick={() => copy(asText(payload.ui), t.copied, t.copyFailed)}>
            <Copy />
          </HeaderButton>
          <HeaderMenu label={t.more}>
            <DropdownMenuItem onSelect={() => setSource((v) => !v)}>{source ? t.showOutput : t.showSource}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copy(payload.ui, t.copied, t.copyFailed)}>{t.copySource}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copy(nodeLink("output", nodeId), t.linkCopied, t.copyFailed)}>{t.copyLink}</DropdownMenuItem>
          </HeaderMenu>
          <HeaderButton label={t.close} onClick={() => removeNode(nodeId)}>
            <X />
          </HeaderButton>
        </NodeHeaderEnd>
      </NodeHeader>
      {/* A native scroller: on the zoomed canvas, a ScrollArea's thumb drag would misread the pointer. */}
      <div ref={body} className="min-h-0 flex-1 overflow-auto p-3 select-text">
        <GeneratedText text={payload.ui} actions={actions} source={source} />
      </div>
    </div>
  );
}
