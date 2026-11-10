import { useRef, useState, type ReactNode } from "react";
import { ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNativeKeyDown } from "@/lib/useNativeKeyDown";
import { cn } from "@/lib/utils";

/**
 * The last line of a node's foot, a Fleet's or an agent's: one folded
 * line, "Message …"; opened, the command bar's field in its compact form
 * below it. Whether it is open is the node's: `onOpenChange` keeps it there.
 * `field` receives whether to take the keyboard: only opening it by hand
 * does, a node mounted already open (reload, panned back into view) must not
 * take it from what the user is typing in.
 */
export function MessageBar(props: { label: string; open: boolean; onOpenChange: (open: boolean) => void; field: (autoFocus: boolean) => ReactNode }) {
  const { label, open, onOpenChange, field } = props;
  const toggle = useRef<HTMLButtonElement>(null);
  const [focusOnOpen, setFocusOnOpen] = useState(false);
  // Keys on the line never reach the canvas: Backspace there would delete the node.
  useNativeKeyDown(toggle, () => undefined);
  return (
    <>
      <Button
        ref={toggle}
        type="button"
        variant="ghost"
        aria-expanded={open}
        onClick={() => {
          setFocusOnOpen(!open);
          onOpenChange(!open);
        }}
        // Inset ring: the node's rounded frame would clip one drawn outside a full-width line.
        className="h-8 w-full justify-between rounded-none px-3 text-xs font-normal text-dp-text-2 hover:text-dp-text focus-visible:ring-inset"
      >
        {label}
        <ChevronUp
          aria-hidden
          className={cn("size-4 text-dp-text-3 transition-transform duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none", open && "rotate-180")}
        />
      </Button>
      {open && <div className="px-3 pb-3">{field(focusOnOpen)}</div>}
    </>
  );
}
