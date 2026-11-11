import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { Bot, X } from "lucide-react";
import { usePalette } from "@/app/theme";
import { useCanvas } from "@/canvas/canvasStore";
import { removeNode } from "@/agents/terminals";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { nodeNameOf, useNodes } from "@/store/nodes";
import { HeaderButton, NodeHeader, NodeHeaderEnd, NodeTitle } from "@/nodes/terminal/NodeHeader";
import { frameStyle, NODE_FRAME } from "@/nodes/terminal/frame";
import { STATUS_TEXT } from "@/nodes/terminal/StatusPill";
import { StatusDot } from "@/nodes/terminal/StatusDot";
import { terminalThemeFor, type TerminalTheme } from "@/nodes/terminal/terminalTheme";
import type { SubagentLine } from "./ipc";
import { subagentMessages } from "./messages";
import { subagentNodesStore, useSubagentEntry, useSubagentNode } from "./store";
import { parentLabel, subagentAbout, subagentDetail, subagentTitle, subagentType } from "./title";

/**
 * Terminal ink: the palette's terminal theme, the one its xterms draw with, so
 * a subagent's transcript reads like the terminal it sits beside: the text in
 * its light color, the prompt and results in its dim text, errors in its red,
 * the report in its green. Done, its text steps back to the dim ink (4.5:1 or
 * more on the body in every palette): no opacity nor grayscale over the node,
 * which took its text under 3:1 (an opacity shows the canvas through).
 */
function inks(theme: TerminalTheme, done: boolean): CSSProperties {
  const fg = done ? theme.brightBlack : theme.foreground;
  return {
    "--sa-fg": fg,
    "--sa-dim": theme.brightBlack,
    // The ❯ and ● markers in the terminal's own ink: the accent (the palette's ink) can be the body's own hue (calm).
    "--sa-tool": fg,
    "--sa-error": theme.red,
    "--sa-ok": theme.green,
  } as CSSProperties;
}

function Line({ line }: { line: SubagentLine }) {
  const t = useMessages(subagentMessages);
  switch (line.kind) {
    case "prompt":
      return (
        <div className="whitespace-pre-wrap break-words text-[color:var(--sa-dim)]">
          <span className="text-[color:var(--sa-tool)]">❯ </span>
          {line.text}
        </div>
      );
    case "tool":
      return (
        <div className="truncate" title={line.text}>
          <span className="text-[color:var(--sa-tool)]">● </span>
          {line.text}
        </div>
      );
    case "result":
    case "error":
      return (
        <div className={`flex gap-1 ${line.kind === "error" ? "text-[color:var(--sa-error)]" : "text-[color:var(--sa-dim)]"}`}>
          <span className="shrink-0 pl-1">⎿</span>
          <span className="min-w-0 whitespace-pre-wrap break-words">{line.text}</span>
        </div>
      );
    case "report":
      return (
        <div className="whitespace-pre-wrap break-words">
          <span className="text-[color:var(--sa-ok)]">✓ {t.report} </span>
          {line.text}
        </div>
      );
    default:
      return <div className="whitespace-pre-wrap break-words">{line.text}</div>;
  }
}

/**
 * A subagent of a Claude session (its Agent tool), shown as a read-only
 * terminal: it has no process of its own, it runs inside its parent's Claude.
 * Its lines come from its transcript; its text steps back to the dim ink when
 * it is done. Its header says its type over what it was asked, as a spawned
 * terminal says its name over its task.
 */
export function SubagentNode({ nodeId }: { nodeId: string }) {
  const t = useMessages(subagentMessages);
  const entry = useSubagentNode(nodeId);
  const parent = useSubagentEntry(entry?.parentAgentId);
  const terminalName = useNodes((s) => (entry ? nodeNameOf(s.nodes[entry.nodeId]) : ""));
  const selected = useCanvas((s) => s.view.selectedIds.includes(nodeId));
  // A folded group hides its members (NodeHost knows its terminals only).
  const hidden = useCanvas((s) => {
    const frameId = s.api?.getSceneElements().find((e) => e.id === nodeId)?.frameId;
    return !!frameId && s.frames.some((f) => f.id === frameId && f.group?.folded);
  });
  const palette = usePalette();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const lines = entry?.lines;

  // Follows the newest line, like a terminal, unless the user scrolled up.
  useLayoutEffect(() => {
    const view = scrollRef.current;
    if (view && stuck.current) view.scrollTop = view.scrollHeight;
  }, [lines]);

  if (hidden) return null;
  const done = entry?.state !== "running";
  const close = () => {
    if (entry) subagentNodesStore.getState().dismiss(entry.agentId);
    removeNode(nodeId);
  };
  const title = entry ? subagentTitle(entry) : t.ended;
  const about = entry ? subagentAbout(entry) : "";
  const from = entry && <span className="max-w-28 shrink-0 truncate text-dp-text-3">{t.from(parentLabel(parent, terminalName, t.terminal))}</span>;

  return (
    <div
      data-subagent={entry?.agentId ?? ""}
      data-state={done ? "done" : "running"}
      className={cn(NODE_FRAME, "bg-dp-terminal font-mono")}
      style={{ ...frameStyle(selected, false), ...inks(terminalThemeFor(palette), done) }}
    >
      {/* The task line's tooltip says it all: no native title beside it. */}
      <NodeHeader title={about ? undefined : title} className="font-sans text-dp-text">
        <Bot aria-hidden className="size-4 shrink-0 text-dp-text-2" />
        {entry && about ? (
          <NodeTitle
            name={
              <span className="flex min-w-0 items-baseline gap-2">
                {from}
                <span className="min-w-0 truncate text-(length:--text-ui) font-medium">{subagentType(entry)}</span>
              </span>
            }
            line={about}
            detail={subagentDetail(entry)}
          />
        ) : (
          <>
            {from}
            <span className="min-w-0 truncate text-(length:--text-ui) font-medium">{title}</span>
          </>
        )}
        <NodeHeaderEnd>
          {/* The agents' signature: its dot and a quiet word, as in a terminal's header. */}
          <span className={STATUS_TEXT}>
            <StatusDot state={done ? "done" : "working"} />
            {done ? t.done : t.running}
          </span>
          <HeaderButton label={t.close} onClick={close}>
            <X />
          </HeaderButton>
        </NodeHeaderEnd>
      </NodeHeader>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const view = e.currentTarget;
          stuck.current = view.scrollHeight - view.scrollTop - view.clientHeight < 24;
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs leading-4.5 text-[color:var(--sa-fg)] select-text"
      >
        {!entry && <div className="text-[color:var(--sa-dim)]">{t.ended}</div>}
        {entry && entry.lines.length === 0 && <div className="text-[color:var(--sa-dim)]">{t.waiting}</div>}
        {entry?.lines.map((line, i) => <Line key={i} line={line} />)}
      </div>
    </div>
  );
}
