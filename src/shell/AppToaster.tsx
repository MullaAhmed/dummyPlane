import { useTheme } from "@/app/theme";
import { Toaster } from "@/components/ui/sonner";

/** Toasts sit above the zoom control: 14 px margin, 32 px control, 12 px gap. */
export const TOAST_BOTTOM = 58;

/** The app's toasts, in the app's theme, all in the bottom-right corner. */
export function AppToaster() {
  const theme = useTheme();
  return <Toaster theme={theme} position="bottom-right" offset={{ bottom: TOAST_BOTTOM, right: 12 }} />;
}
