import { useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Labelled = { label: string };
export type HintSide = "top" | "right" | "bottom" | "left";

/**
 * What a button does, in a tooltip, on hover and on keyboard focus: a focus Tab, Shift+Tab or an arrow brought,
 * never one the app hands back (TooltipTrigger). It stays shut while the button's own menu or popover is open
 * (`expanded`): it would cover it. It closes when the button loses the keyboard.
 */
export function Hint({ label, side = "top", expanded = false, children }: { label: ReactNode; side?: HintSide; expanded?: boolean; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  // A menu that opens closes the hint for good: it does not spring back when the menu closes.
  if (expanded && open) setOpen(false);
  return (
    <Tooltip open={open && !expanded} onOpenChange={setOpen}>
      <TooltipTrigger asChild onBlur={() => setOpen(false)}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Whether the button's own menu or popover is open: its `aria-expanded`, which keeps the hint shut. */
const isExpanded = (props: ComponentProps<"button">) => props["aria-expanded"] === true || props["aria-expanded"] === "true";

/**
 * A Button that names itself in a hint (`hint`) on hover and on keyboard focus, shut while its
 * own menu or popover is open. The kit's buttons and the title bar's meters are built on it.
 */
export function HintedButton({
  hint,
  hintSide = "bottom",
  ...props
}: ComponentProps<typeof Button> & { hint: ReactNode; hintSide?: HintSide }) {
  return (
    <Hint label={hint} side={hintSide} expanded={isExpanded(props)}>
      <Button type="button" {...props} />
    </Hint>
  );
}

/**
 * A button of the floating rails: 36 × 36, the active
 * one in the accent. Its name shows as a hint on the rail's open side
 * (`hintSide`); a menu it opens passes `aria-expanded`, which keeps the hint shut.
 * Only a real on/off (`toggle`: a canvas tool, a panel shown or hidden) says
 * `aria-pressed`: a one-shot action or a menu would read as "toggle, not pressed".
 * A button that shows where the user is (a workspace) passes `aria-current` instead.
 */
export function ToolButton({
  label,
  active = false,
  toggle = false,
  hintSide = "right",
  className,
  onFocus,
  ...props
}: ComponentProps<"button"> & Labelled & { active?: boolean; toggle?: boolean; hintSide?: HintSide }) {
  return (
    <HintedButton
      hint={label}
      hintSide={hintSide}
      variant="ghost"
      size="icon-lg"
      aria-label={label}
      aria-pressed={toggle ? active : undefined}
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
 * and a bar mixing them would show two kinds of tooltip. `hint` says more than the name
 * when there is more to say (why the button does nothing); the name stays its accessible one.
 */
export function IconButton({
  label,
  hint = label,
  hintSide = "bottom",
  className,
  onFocus,
  ...props
}: ComponentProps<"button"> & Labelled & { hint?: ReactNode; hintSide?: HintSide }) {
  return (
    <HintedButton
      hint={hint}
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
 * The main action of a screen or a popover: the accent, a clear step toward
 * the ground under the pointer (the Button's own accent/85: 1.25:1 or more
 * against its rest in every palette, where a brightness filter moved it 1.1:1).
 * It takes the Button's `size` (`lg` for a dialog's primary action).
 */
export function AccentButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      className={cn(
        "px-4 text-(length:--text-ui) [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}
