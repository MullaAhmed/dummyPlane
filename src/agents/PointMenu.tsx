import { useRef, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Point } from "./terminals";

/** One row of a list that opens at a point (the layouts of "Arrange as…", the agents of "Other agent…" and of a group's "Add an agent"): the menu primitive's own row (32 px, the UI step, an 8 px gap), with room for the tick at the right. */
export const POINT_MENU_ROW = "pr-8 pl-2";

/**
 * A list a UI request opens at a point of the window (src/commands/uiRequests.ts), in the app's own menu: the shared
 * dropdown menu, so its surface, hairline, radius, rows, hover and keyboard ring and motion come from the design system
 * once (docs/design-system.md), and a request-opened menu carries `data-instant`. The row ticked is under the keyboard
 * first, else the first one; Up and Down move (and wrap), Enter or a click picks, Escape closes with nothing done.
 */
export function PointMenu({
  at,
  label,
  onClose,
  className,
  anchorProps,
  children,
}: {
  /** The window point it hangs from; null while it is closed. */
  at: Point | null;
  /** What assistive technology names the list by. */
  label: string;
  onClose: () => void;
  className?: string;
  /** Marks of the invisible anchor, for the tests and the page's own lookups. */
  anchorProps?: Record<`data-${string}`, string>;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);

  // The ticked row is under the keyboard first, where the menu would put the content itself (Radix's menu content takes
  // it though its type leaves it out: the menu cancels its own entry focus the same way); a test holds it to it.
  // A list with no row (an empty state) keeps the menu's own: the content has the keyboard, and Escape closes it.
  const focusFirst = {
    onOpenAutoFocus: (event: Event) => {
      const root = content.current;
      const row = root?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ?? root?.querySelector<HTMLElement>('[role^="menuitem"]:not([data-disabled])');
      if (!row) return;
      event.preventDefault();
      row.focus();
    },
  };

  return (
    <DropdownMenu open={at !== null} onOpenChange={(open) => !open && onClose()}>
      {/* A point of the window for the menu to hang from: nothing to see or to press. */}
      <DropdownMenuTrigger asChild>
        <span aria-hidden {...anchorProps} style={{ position: "fixed", left: at?.x ?? 0, top: at?.y ?? 0, width: 1, height: 1, pointerEvents: "none" }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={content}
        aria-label={label}
        side="bottom"
        align="start"
        sideOffset={2}
        loop
        data-instant=""
        className={className}
        {...focusFirst}
        // No trigger to give the keyboard back to: the canvas keeps what it had.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
