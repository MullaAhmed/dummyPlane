import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A path cut from its start, so that its end (the file's name) stays in view. The right-to-left
 * box does the cutting; `<bdi>` keeps the path itself left-to-right, or a leading dot or
 * underscore would be drawn at the end (`.github/ci.yml` as `github/ci.yml.`), as HistoryTab does.
 */
export function PathTail({ path, className }: { path: string; className?: string }) {
  return (
    <span data-path-tail className={cn("min-w-0 flex-1 truncate", className)} style={{ direction: "rtl", textAlign: "left" }}>
      <bdi>{path}</bdi>
    </span>
  );
}

/** Whether a `truncate` text inside `root` is cut: its full text is wider than its box. */
export function isCut(root: Element | null): boolean {
  if (!root) return false;
  const boxes = [root, ...root.querySelectorAll(".truncate")].filter((box) => box.classList.contains("truncate"));
  return boxes.some((box) => box.scrollWidth > box.clientWidth);
}

/**
 * The app's hint on a row whose text may be cut: it opens only when it says something the row
 * does not, that is when the row's text is cut, or `always` (what the row only shows as a sign).
 * On hover and on keyboard focus, in the palette's colours: never a native title. The row keeps
 * the same element either way, so a hint that does not open never costs it its focus.
 */
export function CutHint({ label, always = false, side = "right", children }: { label: ReactNode; always?: boolean; side?: "top" | "right" | "bottom" | "left"; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && (always || isCut(trigger.current)))}>
      <TooltipTrigger asChild ref={trigger}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={8} className="max-w-md break-all">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
