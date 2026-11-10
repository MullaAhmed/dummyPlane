import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { Bot, X } from "lucide-react";
import { useTheme } from "@/app/theme";
import { useCanvas } from "@/canvas/canvasStore";
import { removeNode } from "@/fleet/terminals";
import { useMessages } from "@/i18n";
import { nodeNameOf, useNodes } from "@/store/nodes";
import { HeaderButton } from "@/nodes/terminal/TerminalHeader";
import { frameStyle } from "@/nodes/terminal/frame";
import { StatusDot } from "@/nodes/terminal/StatusDot";
import type { SubagentLine } from "./ipc";
import { subagentMessages } from "./messages";
import { subagentNodesStore, useSubagentEntry, useSubagentNode } from "./store";
import { parentLabel, subagentTitle } from "./title";

/**
 * Terminal ink, from the palette's tokens: terminals stay dark in every
 * palette, so a light palette writes them with its light head colour.
 */
function inks(light: boolean): CSSProperties {
  const fg = light ? "var(--dp-terminal-head)" : "var(--dp-text)";
  return {
    "--sa-fg": fg,
    "--sa-dim": `color-mix(in srgb, ${fg} 58%, var(--dp-terminal))`,
    // The ❯ and ● markers in the terminal's own ink at full strength: the accent (the palette's ink) can be the body's own hue (calm).
    "--sa-tool": fg,
    "--sa-error": `color-mix(in srgb, var(--dp-danger) 65%, ${fg})`,
    "--sa-ok": `color-mix(in srgb, var(--dp-ok) 60%, ${fg})`,
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
 * Its lines come from its transcript; it turns grey when it is done.
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
  const light = useTheme() === "light";
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

  return (
    <div
      data-subagent={entry?.agentId ?? ""}
      data-state={done ? "done" : "running"}
      className="relative flex h-full flex-col overflow-hidden rounded-xl bg-dp-terminal font-mono transition-[filter,opacity] duration-300"
      style={{
        ...frameStyle(selected, false),
        ...inks(light),
        ...(done ? { filter: "grayscale(1)", opacity: 0.62 } : {}),
      }}
    >
      <header title={title} className="flex h-8 shrink-0 items-center gap-2 border-b border-dp-line bg-dp-terminal-head px-2 font-sans text-xs text-dp-text">
        <Bot aria-hidden className="size-4 shrink-0 text-dp-text-2" />
        {entry && <span className="shrink-0 text-dp-text-3">{t.from(parentLabel(parent, terminalName, t.terminal))}</span>}
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {/* The agents' signature: its dot and a quiet word, as in a terminal's header. */}
        <span className="flex shrink-0 items-center gap-2 text-dp-text-2">
          <StatusDot state={done ? "done" : "working"} />
          {done ? t.done : t.running}
        </span>
        <HeaderButton label={t.close} onClick={close}>
          <X />
        </HeaderButton>
      </header>
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
