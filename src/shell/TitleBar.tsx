import type { ReactNode } from "react";
import { TITLE_BAR_HEIGHT } from "./layout";
import { Logo } from "./Logo";
import { WindowControls } from "./WindowControls";

/**
 * The title bar: the logo, `leading` (the project picker,
 * or the app's name), `center` (the search field), `trailing` (the usage and
 * agent counts), the window buttons in the corner. Three columns: the sides
 * take at least their content's width and share the rest equally, so the
 * middle sits on the center of what the window buttons leave whenever the sides
 * allow it, and shrinks rather than slide under the usage meter on a narrow window.
 * The window buttons are outside the columns and never shrink: on a window too
 * narrow for both sides (960 px with an update and a model limit), the trailing
 * side is cut, never Minimize, Maximize or Close.
 * The bar, its columns and their two spacers carry Tauri's bare drag attribute:
 * a click aimed at them moves the window, a double-click maximizes it; a click on
 * any button inside does not.
 */
export function TitleBar({ leading, center, trailing }: { leading: ReactNode; center?: ReactNode; trailing?: ReactNode }) {
  return (
    <div
      data-tauri-drag-region=""
      className="dp-glass-strong flex w-full shrink-0 items-stretch rounded-none border-x-0 border-t-0"
      style={{ height: TITLE_BAR_HEIGHT }}
    >
      <div
        data-tauri-drag-region=""
        data-title-columns
        className="grid min-w-0 flex-1 items-center overflow-hidden pl-3"
        style={{ gridTemplateColumns: "minmax(max-content, 1fr) minmax(0, auto) minmax(max-content, 1fr)" }}
      >
        <div className="flex h-full items-center gap-2">
          <span data-tauri-drag-region="" className="flex h-full items-center">
            <Logo />
          </span>
          {leading}
          <div data-tauri-drag-region="" className="h-full flex-1" />
        </div>
        <div className="flex min-w-0 justify-center px-2">{center}</div>
        <div className="flex h-full items-center gap-2 pr-2">
          <div data-tauri-drag-region="" className="h-full flex-1" />
          {trailing}
        </div>
      </div>
      <WindowControls />
    </div>
  );
}
