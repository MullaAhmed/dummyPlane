import { useEffect, useState, type ComponentProps } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { Hint } from "./buttons";
import { shellMessages } from "./messages";
import { closeWindow, minimizeWindow, toggleMaximizeWindow, windowStore } from "./windowState";

/** Whether the window is maximized, read again after every resize: the button, a double-click on the strip, Win+Up, snapping. */
function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let alive = true;
    const read = () =>
      void appWindow.isMaximized().then(
        (value) => {
          if (!alive) return;
          setMaximized(value);
          windowStore.setState({ maximized: value });
        },
        () => undefined,
      );
    read();
    const unlisten = appWindow.onResized(read);
    return () => {
      alive = false;
      void unlisten.then((stop) => stop());
    };
  }, []);
  return maximized;
}

/**
 * A caption button, as Windows draws them: the title bar's full height, 46 wide,
 * square, no press scale. Its name shows in the same hint as the bar's other
 * buttons (below), not a native title: the counters beside it use hints.
 */
function WindowButton({ label, danger, className, ...props }: ComponentProps<"button"> & { label: string; danger?: boolean }) {
  return (
    <Hint label={label} side="bottom">
      <Button
        type="button"
        variant="ghost"
        aria-label={label}
        className={cn(
          "h-full w-[46px] rounded-none border-0 px-0 text-dp-text-2 hover:text-dp-text focus-visible:ring-inset active:scale-100",
          danger && "hover:bg-dp-danger hover:text-dp-surface",
          className,
        )}
        {...props}
      />
    </Hint>
  );
}

/** Minimize, Maximize / Restore, Close dummyPlane, Windows-style in the title bar's corner. */
export function WindowControls() {
  const t = useMessages(shellMessages).window;
  const maximized = useMaximized();
  return (
    <div className="flex h-full shrink-0 items-stretch">
      <WindowButton label={t.minimize} onClick={minimizeWindow}>
        <Minus />
      </WindowButton>
      <WindowButton
        label={maximized ? t.restore : t.maximize}
        onClick={toggleMaximizeWindow}
      >
        {maximized ? <Copy /> : <Square />}
      </WindowButton>
      {/* close, not destroy: onCloseRequested saves first (src/app/close.ts). */}
      <WindowButton label={t.close} danger onClick={closeWindow}>
        <X />
      </WindowButton>
    </div>
  );
}
