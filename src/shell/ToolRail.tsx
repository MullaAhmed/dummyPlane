import { Eraser, Hand, Image as ImageIcon, Maximize, MousePointer2, Plus, Type } from "lucide-react";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { fitScene } from "@/canvas/viewActions";
import { AgentMenu } from "@/fleet/AgentMenu";
import { useMessages } from "@/i18n";
import { ToolButton } from "./buttons";
import { IconsMenu } from "./IconsMenu";
import { shellMessages } from "./messages";
import { PenMenu } from "./PenMenu";
import { ShapesMenu } from "./ShapesMenu";
import { railToolOf, type ShapeTool } from "./tools";

type Tool = "selection" | "hand" | "text" | "eraser" | "image" | ShapeTool;

const setTool = (type: Tool) => canvasStore.getState().api?.setActiveTool({ type });

const Separator = () => <span aria-hidden className="my-1 h-px w-6 bg-dp-line" />;

/**
 * The canvas tools, floating on the left (spec identité §5.4). They replace
 * Excalidraw's toolbar and follow its active tool, keyboard shortcuts included.
 */
export function ToolRail() {
  const t = useMessages(shellMessages).toolRail;
  const tool = useCanvas((s) => s.view.tool);
  const active = railToolOf(tool);
  return (
    <nav className="dp-glass absolute left-3 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-[14px] p-[5px]">
      <ToolButton label={t.selection} active={active === "selection"} onClick={() => setTool("selection")}>
        <MousePointer2 />
      </ToolButton>
      <ToolButton label={t.hand} active={active === "hand"} onClick={() => setTool("hand")}>
        <Hand />
      </ToolButton>
      <ShapesMenu active={active === "shapes"} current={tool} onPick={setTool} />
      <ToolButton label={t.text} active={active === "text"} onClick={() => setTool("text")}>
        <Type />
      </ToolButton>
      <PenMenu active={active === "pen"} />
      <ToolButton label={t.eraser} active={active === "eraser"} onClick={() => setTool("eraser")}>
        <Eraser />
      </ToolButton>
      <ToolButton label={t.image} active={active === "image"} onClick={() => setTool("image")}>
        <ImageIcon />
      </ToolButton>
      <IconsMenu />
      <Separator />
      <AgentMenu
        answersRequests
        trigger={(open) => (
          <ToolButton label={t.launchAgent} active={open} className={open ? undefined : "text-dp-accent"}>
            <Plus />
          </ToolButton>
        )}
      />
      <Separator />
      <ToolButton label={t.fitView} onClick={fitScene}>
        <Maximize />
      </ToolButton>
    </nav>
  );
}
