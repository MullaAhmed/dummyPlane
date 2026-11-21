import type { CSSProperties } from "react";
import { useTheme } from "@/app/theme";
import { Toaster } from "@/components/ui/sonner";
import { LANE_BOTTOM, LANE_RIGHT } from "./layout";
import { TOAST_WIDTH, useToastOffset } from "./toastLift";

/** Toasts stand at the lane's foot (shell/layout.ts): one gap above the command band, clear of the zoom control. */
export const TOAST_BOTTOM = LANE_BOTTOM;

/** And on the lane's edge: clear of the activity rail, the right edge the lane's surfaces share. */
export const TOAST_RIGHT = LANE_RIGHT;

/**
 * The app's toasts, in the app's theme, all in the bottom-right corner, at the right lane's foot and its width: kept off
 * an open work window (left of it, or down in the bottom band) and clear of a rail popover while one is open.
 */
export function AppToaster() {
  const theme = useTheme();
  const offset = useToastOffset({ bottom: TOAST_BOTTOM, right: TOAST_RIGHT });
  return <Toaster theme={theme} position="bottom-right" offset={offset} style={{ "--width": `${TOAST_WIDTH}px` } as CSSProperties} />;
}
