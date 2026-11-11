import type { MouseEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A click must not take the keyboard off the canvas: Delete and Escape keep working after it. */
export const keepCanvasFocus = (event: MouseEvent) => event.preventDefault();

/**
 * One of the selection panel's action buttons (Duplicate, Delete…), side by side with the others.
 * A destructive one stays as quiet as its neighbours until it is pointed at.
 */
export function PanelAction({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-label={label}
      onMouseDown={keepCanvasFocus}
      onClick={onClick}
      className={cn(
        // No side padding: two or three of them share a drawing panel's 200 px, "Duplicate" and its icon included.
        "flex-1 gap-1.5 rounded-md px-0 text-xs font-normal text-dp-text-2 hover:text-dp-text",
        danger && "hover:bg-dp-danger/10 hover:text-dp-danger focus-visible:ring-dp-danger",
      )}
    >
      {icon}
      {label}
    </Button>
  );
}
