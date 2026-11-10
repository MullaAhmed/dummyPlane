import { useState } from "react";
import { PenLine, Pipette } from "lucide-react";
import { canvasStore } from "@/canvas/canvasStore";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMessages } from "@/i18n";
import { useTheme } from "@/app/theme";
import { displayColorFor, sceneColorFor } from "@/theme/sceneColors";
import { PEN_COLORS } from "@/theme/penColors";
import { PEN_WIDTHS } from "./tools";
import { Hint, ToolButton } from "./buttons";
import { shellMessages } from "./messages";

/**
 * A swatch: a 24 px dot filled by its inline colour. The chosen one carries a
 * ring in the accent, the others a hairline ring on hover; no scale but the press.
 */
const SWATCH =
  "size-6 rounded-full min-w-0 p-0 ring-offset-2 ring-offset-dp-surface hover:ring-2 hover:ring-dp-line data-[state=on]:ring-2 data-[state=on]:ring-dp-accent transition-[box-shadow,scale] duration-(--dp-dur-fast) ease-(--dp-ease-out) active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-dp-accent/50 motion-reduce:transition-none";
/** A width: a 32 px square, the chosen one on the accent's soft surface. */
const WIDTH =
  "size-8 min-w-0 rounded-md border border-transparent bg-dp-card p-0 hover:bg-dp-hover data-[state=on]:border-dp-accent data-[state=on]:bg-dp-accent-soft transition-[background-color,border-color,scale] duration-(--dp-dur-fast) ease-(--dp-ease-out) active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-dp-accent/50 motion-reduce:transition-none";

/** Pen tool with its color and width menu (spec habillage §5.3). */
export function PenMenu({ active }: { active: boolean }) {
  const t = useMessages(shellMessages).pen;
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const [color, setColor] = useState(PEN_COLORS[0].scene);
  const [width, setWidth] = useState(2);

  const choose = (next: { color?: string; width?: number }) => {
    const api = canvasStore.getState().api;
    if (!api) return;
    const nextColor = next.color ?? color;
    const nextWidth = next.width ?? width;
    setColor(nextColor);
    setWidth(nextWidth);
    api.updateScene({
      appState: { currentItemStrokeColor: nextColor, currentItemStrokeWidth: nextWidth },
    });
    api.setActiveTool({ type: "freedraw" });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        // Opening picks the pen with the colour and width in force (shared with the shapes): it writes nothing.
        const api = canvasStore.getState().api;
        if (!api) return;
        const app = api.getAppState();
        setColor(app.currentItemStrokeColor);
        setWidth(app.currentItemStrokeWidth);
        api.setActiveTool({ type: "freedraw" });
      }}
    >
      <PopoverTrigger asChild>
        <ToolButton label={t.button} active={active}>
          <PenLine />
        </ToolButton>
      </PopoverTrigger>
      <PopoverContent side="right" sideOffset={12} className="flex w-60 flex-col gap-3 rounded-lg">
        <section className="flex flex-col gap-2">
          <p className="dp-label">{t.color}</p>
          {/* A click picks even the colour in force: it takes the pen again. The value only shows which one it is. */}
          <ToggleGroup type="single" value={color} aria-label={t.color} spacing={2} className="flex-wrap">
            {PEN_COLORS.map(({ scene }, index) => (
              // The label is the French one stored with the color; the interface shows its own language's.
              // The hint hangs on a span: on the toggle itself it would overwrite its `data-state` (on / off), which the selection ring reads.
              <Hint key={scene} label={t.colors[index]}>
                <span className="inline-flex rounded-full">
                  <ToggleGroupItem
                    value={scene}
                    aria-label={t.colors[index]}
                    onClick={() => choose({ color: scene })}
                    className={SWATCH}
                    style={{ backgroundColor: displayColorFor(scene, theme) }}
                  />
                </span>
              </Hint>
            ))}
            {/* No shadcn colour picker: the native one, behind a swatch of the same size. */}
            <Hint label={t.custom}>
              <label className="relative grid size-6 cursor-pointer place-items-center overflow-hidden rounded-full border border-dp-line text-dp-text-2 transition-[color,background-color,scale] duration-(--dp-dur-fast) ease-(--dp-ease-out) hover:bg-dp-hover hover:text-dp-text active:scale-[0.97] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-dp-accent/50 motion-reduce:transition-none">
                <Pipette aria-hidden className="size-3.5" />
                <input
                  type="color"
                  aria-label={t.custom}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(e) => choose({ color: sceneColorFor(e.target.value, theme) })}
                />
              </label>
            </Hint>
          </ToggleGroup>
        </section>
        <section className="flex flex-col gap-2">
          <p className="dp-label">{t.width}</p>
          <ToggleGroup type="single" value={String(width)} aria-label={t.width} spacing={2}>
            {PEN_WIDTHS.map((w) => (
              <ToggleGroupItem key={w} value={String(w)} aria-label={t.widthN(w)} onClick={() => choose({ width: w })} className={WIDTH}>
                <span className="rounded-full bg-dp-text" style={{ width: w + 2, height: w + 2 }} />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>
      </PopoverContent>
    </Popover>
  );
}
