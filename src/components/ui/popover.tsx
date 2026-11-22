import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { OVERLAY_COLLISION_PADDING } from "@/shell/overlayBounds";

/**
 * Never past the window: no taller than the room Radix measured on its side, inside the collision
 * padding (under the title bar, 8 px from the edges); what does not fit scrolls inside.
 */
const POPOVER_BOUNDS = "max-h-(--radix-popover-content-available-height) overflow-x-hidden overflow-y-auto";

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 10,
  collisionPadding = OVERLAY_COLLISION_PADDING,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 p-3 text-dp-text outline-none origin-(--radix-popover-content-transform-origin) duration-(--dp-dur) ease-(--dp-ease-out) data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-(--dp-dur-fast)",
          POPOVER_BOUNDS,
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
