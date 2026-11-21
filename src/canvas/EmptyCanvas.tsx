import { FUNCTIONS_SHORTCUT } from "@/commands/shortcuts";
import { useMessages } from "@/i18n";
import { keyLabel } from "@/i18n/format";
import { canvasMessages } from "./messages";

/** Whether the scene holds nothing on screen: no node, no drawing (a deleted element is not on screen). */
export const isEmptyScene = (elements: readonly { isDeleted: boolean }[]): boolean => elements.every((element) => element.isDeleted);

/**
 * The first empty canvas's invitation: the two ways to start an agent that exist (the ring of a right-click, and the
 * palette's functions), in two quiet lines, there until the canvas holds something. Text only, under the canvas and
 * out of the pointer's way: a right-click through it still opens the ring.
 */
export function EmptyCanvas({ show }: { show: boolean }) {
  const t = useMessages(canvasMessages).empty;
  if (!show) return null;
  // Centred between the bars (the top row 72 px, the command bar's band 60 px).
  return (
    <div data-empty-canvas className="pointer-events-none absolute inset-0 grid place-items-center pt-18 pb-15 text-center">
      <div className="grid gap-1">
        <p className="text-(length:--text-ui) text-dp-text-2">{t.rightClick}</p>
        <p className="text-xs text-dp-text-3">{t.palette(keyLabel(FUNCTIONS_SHORTCUT))}</p>
      </div>
    </div>
  );
}
