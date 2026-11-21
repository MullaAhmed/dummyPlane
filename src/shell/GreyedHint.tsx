import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Hint, type HintSide } from "./buttons";

/**
 * The app's hint on a control that may be greyed (`disabled`): on a wrapper, since a disabled button takes
 * neither the pointer nor the keyboard's focus, and the wrapper takes the pointer. Without a `label` the control
 * stands alone: no wrapper, no empty hint. The wrapper is `className`'s (a block by default).
 */
export function GreyedHint({ label, side, className, children }: { label: ReactNode; side?: HintSide; className?: string; children: ReactElement }) {
  if (!label) return children;
  return (
    <Hint label={label} side={side}>
      <span className={cn("block", className)}>{children}</span>
    </Hint>
  );
}
