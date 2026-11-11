import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The header of a node of the canvas, a terminal's or a Fleet's: one 36px row on
 * the terminal's head colour, so the two read as one system. It is a size
 * container (`head`): what only a wide node has room for hides by the node's own
 * width (WIDE_ONLY), not the window's.
 */
export function NodeHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      {...props}
      className={cn("@container/head flex h-9 shrink-0 items-center gap-2 border-b border-dp-line bg-dp-terminal-head px-3 text-xs", className)}
    />
  );
}

/** What sits at the header's end: the quiet facts, then the actions. It never shrinks, so the name gives way first. */
export function NodeHeaderEnd({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("ml-auto flex shrink-0 items-center gap-1", className)} />;
}

/**
 * A node's name over what it was asked (a sub-agent's task), within the 36px
 * row: two 16px lines, the name as ever, then the task on one 12px line in the
 * secondary text role, ellipsed. Its whole line and an excerpt of the task show
 * in a tooltip; the line is a button, so the keyboard reaches it too. It gives
 * way like the name: the header's end never shrinks.
 */
export function NodeTitle(props: { name: ReactNode; line: string; detail: string }) {
  const { name, line, detail } = props;
  return (
    <div data-node-title className="flex min-w-0 flex-col leading-4">
      {name}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-task-line
            className="min-w-0 truncate rounded-sm text-left text-xs text-dp-text-2 outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/70"
          >
            {line}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" sideOffset={6} className="max-w-sm flex-col items-start gap-1 whitespace-pre-line">
          <span className="font-medium">{line}</span>
          {detail && detail !== line && <span>{detail}</span>}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Shown from 28rem of header on: the chips, the clock. A narrower node keeps the room for its name. */
export const WIDE_ONLY = "hidden @md/head:flex";

/** The quiet icon buttons of a header: muted until pointed at. */
const HEADER_ICON = "rounded-md text-dp-text-2 hover:text-dp-text";

/** An icon action of a header; its name shows in a tooltip, the glyph alone not always saying it. */
export function HeaderButton(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={props.label} onClick={props.onClick} className={HEADER_ICON}>
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {props.label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Set by a menu item that gives the keyboard elsewhere (a new note's text): the closing menu leaves it there. */
let keepFocus = false;

/** Called from a menu item's onSelect: the menu, as it closes, does not hand the keyboard back to its "⋯". */
export function keepFocusAfterMenu() {
  keepFocus = true;
}

/**
 * The header's one overflow menu, "⋯": the actions a node needs now and then
 * (a terminal's Review, Restart, Minimize…, a Fleet's Pause all…), kept off the
 * row so its name has room. The same tooltip as the header's other buttons,
 * never over its own open menu, nor when the closing menu hands the focus back
 * to the button: only a new hover (or a focus from elsewhere) shows it again.
 */
export function HeaderMenu(props: { label: string; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [tip, setTip] = useState(false);
  const quiet = useRef(false);
  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (open) setTip(false);
        else quiet.current = true;
      }}
    >
      <Tooltip open={tip} onOpenChange={(open) => setTip(open && !menuOpen && !quiet.current)}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={props.label}
              className={HEADER_ICON}
              onPointerEnter={() => (quiet.current = false)}
              onBlur={() => (quiet.current = false)}
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {props.label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="w-56"
        onCloseAutoFocus={(event) => {
          if (!keepFocus) return;
          keepFocus = false;
          event.preventDefault();
        }}
      >
        {props.children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
