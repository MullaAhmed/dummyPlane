import type { ComponentProps } from "react";
import { Eraser, Hand, Image as ImageIcon, Maximize, MousePointer2, Plus, Type } from "lucide-react";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { fitScene } from "@/canvas/viewActions";
import { AgentMenu } from "@/fleet/AgentMenu";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { ToolButton } from "./buttons";
import { shellMessages } from "./messages";
import { PenMenu } from "./PenMenu";
import { ShapesMenu } from "./ShapesMenu";
import { railToolOf, type ShapeTool } from "./tools";

type Tool = "selection" | "hand" | "text" | "eraser" | "image" | ShapeTool;

const setTool = (type: Tool) => canvasStore.getState().api?.setActiveTool({ type });

const Separator = () => <span aria-hidden className="my-1 h-px w-6 bg-dp-line" />;

/** A rail button: the shared ToolButton plus focus, press and disabled feedback. */
const RAIL_BUTTON =
  "rounded-md transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

function RailButton(props: ComponentProps<typeof ToolButton>) {
  return <ToolButton {...props} className={cn(RAIL_BUTTON, props.className)} />;
}

/**
 * The canvas tools, floating on the left (spec identité §5.4). They replace
 * Excalidraw's toolbar and follow its active tool, keyboard shortcuts included.
 */
export function ToolRail() {
  const t = useMessages(shellMessages).toolRail;
  const tool = useCanvas((s) => s.view.tool);
  const active = railToolOf(tool);
  return (
    <nav className="dp-glass absolute left-3 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-lg p-1">
      <RailButton label={t.selection} active={active === "selection"} onClick={() => setTool("selection")}>
        <MousePointer2 />
      </RailButton>
      <RailButton label={t.hand} active={active === "hand"} onClick={() => setTool("hand")}>
        <Hand />
      </RailButton>
      <ShapesMenu active={active === "shapes"} current={tool} onPick={setTool} />
      <RailButton label={t.text} active={active === "text"} onClick={() => setTool("text")}>
        <Type />
      </RailButton>
      <PenMenu active={active === "pen"} />
      <RailButton label={t.eraser} active={active === "eraser"} onClick={() => setTool("eraser")}>
        <Eraser />
      </RailButton>
      <RailButton label={t.image} active={active === "image"} onClick={() => setTool("image")}>
        <ImageIcon />
      </RailButton>
      <Separator />
      <AgentMenu
        answersRequests
        trigger={(open) => (
          <RailButton label={t.launchAgent} active={open} className={open ? undefined : "text-dp-accent"}>
            <Plus />
          </RailButton>
        )}
      />
      <Separator />
      <RailButton label={t.fitView} onClick={fitScene}>
        <Maximize />
      </RailButton>
    </nav>
  );
}
