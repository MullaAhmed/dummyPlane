import { useRef, useState } from "react";
import { useArrangeLayout } from "@/app/arrangeLayoutSetting";
import { useUiRequest } from "@/commands/uiRequests";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMessages } from "@/i18n";
import { shellMessages } from "@/shell/messages";
import { arrangeAs, type ArrangeTarget } from "./arrangeAs";
import { ARRANGE_LAYOUTS, type ArrangeLayout } from "./arrangeLayout";
import { agentsMessages } from "./messages";
import type { Point } from "./terminals";

interface Asked {
  workspaceId: string;
  target: ArrangeTarget;
  at: Point;
}

/**
 * The list of layouts an "Arrange as…" offers (the ring's Arrange wedge, the palette's Arrange as…): the seven of the
 * Settings, the saved one ticked and under the keyboard, at the point asked for. Up and Down move, Enter or a click
 * picks and arranges (./arrangeAs.ts), Escape closes and moves nothing.
 */
export function ArrangeLayoutMenu() {
  const t = useMessages(shellMessages).settings;
  const label = useMessages(agentsMessages).arrangeMenu.label;
  const saved = useArrangeLayout();
  const [asked, setAsked] = useState<Asked | null>(null);
  const content = useRef<HTMLDivElement>(null);

  useUiRequest("arrangeMenu", (request) => {
    setAsked({ workspaceId: request.workspaceId, target: request.target, at: request.at });
    return true;
  });

  // The saved layout is under the keyboard first, where the menu would put the content itself. Radix's menu content takes
  // it though its type leaves it out (the menu cancels its own entry focus the same way); a test holds it to it.
  const savedFirst = {
    onOpenAutoFocus: (event: Event) => {
      event.preventDefault();
      content.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    },
  };

  const pick = (layout: ArrangeLayout) => {
    setAsked(null);
    if (asked) arrangeAs(asked.workspaceId, asked.target, layout);
  };

  return (
    <DropdownMenu open={asked !== null} onOpenChange={(open) => !open && setAsked(null)}>
      {/* A point of the window for the menu to hang from: nothing to see or to press. */}
      <DropdownMenuTrigger asChild>
        <span aria-hidden data-arrange-anchor style={{ position: "fixed", left: asked?.at.x ?? 0, top: asked?.at.y ?? 0, width: 1, height: 1, pointerEvents: "none" }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={content}
        aria-label={label}
        side="bottom"
        align="start"
        sideOffset={2}
        collisionPadding={12}
        loop
        className="w-44 p-1"
        {...savedFirst}
        // No trigger to give the keyboard back to: the canvas keeps what it had.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuRadioGroup value={saved}>
          {ARRANGE_LAYOUTS.map((layout) => (
            <DropdownMenuRadioItem key={layout} value={layout} className="h-8 gap-2.5 pr-8 pl-2 text-(length:--text-ui)" onSelect={() => pick(layout)}>
              {t.arrangeLayouts[layout]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
