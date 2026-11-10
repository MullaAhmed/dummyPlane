import { useState, type ComponentProps, type FocusEvent, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Labelled = { label: string };
export type HintSide = "top" | "right" | "bottom" | "left";

/** Whether the keyboard brought the focus: a focus handed back after a click (a menu that closes) is not. */
function keyboardFocus(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * What a button does, in a tooltip, on hover and on keyboard focus. It stays shut
 * while the button's own menu or popover is open (`expanded`): it would cover it.
 */
export function Hint({ label, side = "top", expanded = false, children }: { label: ReactNode; side?: HintSide; expanded?: boolean; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  // A menu that opens closes the hint for good: it does not spring back when the menu closes.
  if (expanded && open) setOpen(false);
  return (
    <Tooltip open={open && !expanded} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A button of the floating rails (spec identité §5.4, §5.5): 36 × 34, the active
 * one in the accent. Its name shows as a hint on the rail's open side
 * (`hintSide`); a menu it opens passes `aria-expanded`, which keeps the hint shut.
 */
export function ToolButton({
  label,
  active = false,
  hintSide = "right",
  className,
  onFocus,
  ...props
}: ComponentProps<"button"> & Labelled & { active?: boolean; hintSide?: HintSide }) {
  const expanded = props["aria-expanded"] === true || props["aria-expanded"] === "true";
  return (
    <Hint label={label} side={hintSide} expanded={expanded}>
      <Button
        type="button"
        variant="ghost"
        aria-label={label}
        aria-pressed={active}
        onFocus={(event: FocusEvent<HTMLButtonElement>) => {
          onFocus?.(event);
          // Radix opens the hint on any focus unless told otherwise: only the keyboard's shows it.
          if (!keyboardFocus(event.currentTarget)) event.preventDefault();
        }}
        className={cn(
          "relative h-8.5 w-9 rounded-md px-0 text-dp-text-2 hover:text-dp-text [&_svg:not([class*='size-'])]:size-4",
          active && "bg-dp-accent-soft text-dp-accent-ink hover:bg-dp-accent-soft hover:text-dp-accent-ink aria-expanded:bg-dp-accent-soft aria-expanded:text-dp-accent-ink",
          className,
        )}
        {...props}
      />
    </Hint>
  );
}

/**
 * A small icon button of panels, tabs and bars. It keeps the native `title`:
 * the panels that use it put their own hints around it.
 */
export function IconButton({ label, className, ...props }: ComponentProps<"button"> & Labelled) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={label}
      aria-label={label}
      className={cn("size-7 rounded-md text-dp-text-2 hover:text-dp-text [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    />
  );
}

/** The main action of a screen or a popover (spec identité §4.4): the accent, brighter under the pointer. */
export function AccentButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <Button
      type="button"
      className={cn(
        "h-8 rounded-md px-4 text-(length:--text-ui) transition-[color,background-color,transform,filter] hover:bg-dp-accent hover:brightness-110 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}
