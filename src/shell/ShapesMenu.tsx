import { useState } from "react";
import { Circle, Diamond, Frame, Minus, MoveUpRight, Shapes, Square, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMessages } from "@/i18n";
import type { ShapeTool } from "./tools";
import { ToolButton } from "./buttons";
import { shellMessages } from "./messages";

const SHAPES: { tool: ShapeTool; Icon: LucideIcon }[] = [
  { tool: "rectangle", Icon: Square },
  { tool: "ellipse", Icon: Circle },
  { tool: "diamond", Icon: Diamond },
  { tool: "line", Icon: Minus },
  { tool: "arrow", Icon: MoveUpRight },
  { tool: "frame", Icon: Frame },
];

/** The SHAPES menu of the rail; `current` is Excalidraw's active tool. */
export function ShapesMenu(props: { active: boolean; current: string; onPick: (tool: ShapeTool) => void }) {
  const { active, current, onPick } = props;
  const t = useMessages(shellMessages).shapes;
  const [open, setOpen] = useState(false);
  // The button keeps the last shape: using it takes that shape as the tool, like the pen.
  const [last, setLast] = useState<ShapeTool>("rectangle");
  const shape = SHAPES.find(({ tool }) => tool === current);
  if (shape && shape.tool !== last) setLast(shape.tool);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onPick(last);
      }}
    >
      <PopoverTrigger asChild>
        <ToolButton label={t.title} active={active}>
          <Shapes />
        </ToolButton>
      </PopoverTrigger>
      <PopoverContent side="right" sideOffset={12} className="flex w-60 flex-col gap-2 rounded-lg">
        <p className="dp-label">{t.title}</p>
        {/* One shape at a time: a click takes it, even the one in force, and closes. The value shows the current tool. */}
        <ToggleGroup type="single" value={shape?.tool ?? ""} aria-label={t.title} spacing={2} className="grid w-full grid-cols-3">
          {SHAPES.map(({ tool, Icon }) => (
            <ToggleGroupItem
              key={tool}
              value={tool}
              data-shape={tool}
              onClick={() => {
                setLast(tool);
                onPick(tool);
                setOpen(false);
              }}
              className="h-auto min-w-0 flex-col gap-1 rounded-md border border-transparent bg-dp-card px-0 py-2 text-xs font-normal text-dp-text-2 transition-[color,background-color,border-color,transform] duration-150 ease-out hover:bg-dp-hover hover:text-dp-text active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-dp-accent/50 data-[state=on]:border-dp-accent data-[state=on]:bg-dp-accent-soft data-[state=on]:text-dp-text motion-reduce:transition-none"
            >
              <Icon />
              {t[tool]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </PopoverContent>
    </Popover>
  );
}
