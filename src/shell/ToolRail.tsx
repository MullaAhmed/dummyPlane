import { Eraser, Hand, Image as ImageIcon, Maximize, MousePointer2, Plus, Type } from "lucide-react";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { fitScene } from "@/canvas/viewActions";
import { Separator as Rule } from "@/components/ui/separator";
import { AgentMenu } from "@/agents/AgentMenu";
import { useMessages } from "@/i18n";
import { ToolButton as RailButton } from "./buttons";
import { shellMessages } from "./messages";
import { PenMenu } from "./PenMenu";
import { ShapesMenu } from "./ShapesMenu";
import { railToolOf, type ShapeTool } from "./tools";

type Tool = "selection" | "hand" | "text" | "eraser" | "image" | ShapeTool;

const setTool = (type: Tool) => canvasStore.getState().api?.setActiveTool({ type });

/** A hairline between the rail's groups: drawing tools, agents, view. */
const Separator = () => <Rule className="my-1 bg-dp-line data-horizontal:w-6" />;

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
      <RailButton toggle label={t.selection} active={active === "selection"} onClick={() => setTool("selection")}>
        <MousePointer2 />
      </RailButton>
      <RailButton toggle label={t.hand} active={active === "hand"} onClick={() => setTool("hand")}>
        <Hand />
      </RailButton>
      <ShapesMenu active={active === "shapes"} current={tool} onPick={setTool} />
      <RailButton toggle label={t.text} active={active === "text"} onClick={() => setTool("text")}>
        <Type />
      </RailButton>
      <PenMenu active={active === "pen"} />
      <RailButton toggle label={t.eraser} active={active === "eraser"} onClick={() => setTool("eraser")}>
        <Eraser />
      </RailButton>
      <RailButton toggle label={t.image} active={active === "image"} onClick={() => setTool("image")}>
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
