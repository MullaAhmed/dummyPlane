import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Labelled = { label: string };

/** Shared interaction states of every button here: a specific-property transition, a press, a visible focus ring, a disabled state. */
const INTERACTIVE =
  "transition-[color,background-color,opacity,transform,filter] duration-150 ease-out motion-reduce:transition-none active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 disabled:opacity-50 disabled:pointer-events-none";

/** A button of the floating rails (spec identité §5.4, §5.5): 36 × 34, the active one in the accent. */
export function ToolButton({ label, active = false, className, ...props }: ComponentProps<"button"> & Labelled & { active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "relative grid h-8.5 w-9 shrink-0 place-items-center rounded-md text-dp-text-2 hover:bg-dp-hover hover:text-dp-text [&_svg]:size-4",
        INTERACTIVE,
        active && "bg-dp-accent-soft text-dp-accent-ink hover:bg-dp-accent-soft hover:text-dp-accent-ink",
        className,
      )}
      {...props}
    />
  );
}

/** A small icon button of panels, tabs and bars. */
export function IconButton({ label, className, ...props }: ComponentProps<"button"> & Labelled) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "grid size-6.5 shrink-0 place-items-center rounded-md text-dp-text-2 hover:bg-dp-hover hover:text-dp-text [&_svg]:size-3.5",
        INTERACTIVE,
        className,
      )}
      {...props}
    />
  );
}

/** The main action of a screen or a popover (spec identité §4.4). */
export function AccentButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-dp-accent px-4 text-[13px] font-semibold text-dp-on-accent hover:brightness-110 [&_svg]:size-3.5",
        INTERACTIVE,
        className,
      )}
      {...props}
    />
  );
}
