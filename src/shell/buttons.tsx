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

/** Whether the button's own menu or popover is open: its `aria-expanded`, which keeps the hint shut. */
const isExpanded = (props: ComponentProps<"button">) => props["aria-expanded"] === true || props["aria-expanded"] === "true";

/**
 * A button's onFocus that also stops Radix opening the hint on a focus the pointer
 * brought (a menu that closes hands it back): only the keyboard's shows it.
 */
const keyboardOnlyHint =
  (onFocus: ComponentProps<"button">["onFocus"]) =>
  (event: FocusEvent<HTMLButtonElement>) => {
    onFocus?.(event);
    if (!keyboardFocus(event.currentTarget)) event.preventDefault();
  };

/**
 * A Button that names itself in a hint (`hint`) on hover and on keyboard focus, shut while its
 * own menu or popover is open. The kit's buttons and the title bar's meters are built on it.
 */
export function HintedButton({
  hint,
  hintSide = "bottom",
  onFocus,
  ...props
}: ComponentProps<typeof Button> & { hint: ReactNode; hintSide?: HintSide }) {
  return (
    <Hint label={hint} side={hintSide} expanded={isExpanded(props)}>
      <Button type="button" onFocus={keyboardOnlyHint(onFocus)} {...props} />
    </Hint>
  );
}

/**
 * A button of the floating rails (spec identité §5.4, §5.5): 36 × 36, the active
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
  return (
    <HintedButton
      hint={label}
      hintSide={hintSide}
      variant="ghost"
      size="icon-lg"
      aria-label={label}
      aria-pressed={active}
      onFocus={onFocus}
      className={cn(
        "relative text-dp-text-2 hover:text-dp-text [&_svg:not([class*='size-'])]:size-4",
        active && "bg-dp-accent-soft text-dp-accent-ink hover:bg-dp-accent-soft hover:text-dp-accent-ink aria-expanded:bg-dp-accent-soft aria-expanded:text-dp-accent-ink",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A small icon button of panels, tabs and bars: 28 px. Its name shows in the same hint as
 * the rails' (`hintSide`, below by default), never in a native `title`: the two would stack,
 * and a bar mixing them would show two kinds of tooltip.
 */
export function IconButton({
  label,
  hintSide = "bottom",
  className,
  onFocus,
  ...props
}: ComponentProps<"button"> & Labelled & { hintSide?: HintSide }) {
  return (
    <HintedButton
      hint={label}
      hintSide={hintSide}
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      onFocus={onFocus}
      className={cn("text-dp-text-2 hover:text-dp-text [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    />
  );
}

/** The dismissing action of a dialog (Cancel, Later): ghost and a step quieter than its primary, `lg` like it. */
export function QuietButton({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button type="button" variant="ghost" size="lg" className={cn("text-dp-text-2 hover:text-dp-text", className)} {...props} />;
}

/**
 * The main action of a screen or a popover (spec identité §4.4): the accent, brighter under the
 * pointer. It takes the Button's `size` (`lg` for a dialog's primary action).
 */
export function AccentButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      className={cn(
        "px-4 text-(length:--text-ui) transition-[color,background-color,scale,filter] hover:bg-dp-accent hover:brightness-110 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}
