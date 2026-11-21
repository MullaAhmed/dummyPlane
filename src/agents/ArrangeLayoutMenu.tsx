import { useState } from "react";
import { useArrangeLayout } from "@/app/arrangeLayoutSetting";
import { useUiRequest } from "@/commands/uiRequests";
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { useMessages } from "@/i18n";
import { shellMessages } from "@/shell/messages";
import { arrangeAs, type ArrangeTarget } from "./arrangeAs";
import { ARRANGE_LAYOUTS, type ArrangeLayout } from "./arrangeLayout";
import { agentsMessages } from "./messages";
import { POINT_MENU_ROW, PointMenu } from "./PointMenu";
import type { Point } from "./terminals";

interface Asked {
  workspaceId: string;
  target: ArrangeTarget;
  at: Point;
}

/**
 * The list of layouts an "Arrange as…" offers (the palette's Arrange as… and Arrange the group as…; the rings' Arrange wedges
 * arrange at once in the saved layout and never open it): the seven of the
 * Settings, the saved one ticked and under the keyboard, at the point asked for. Up and Down move, Enter or a click
 * picks and arranges (./arrangeAs.ts), Escape closes and moves nothing. It is a PointMenu, like "Other agent…" (./OtherAgentMenu.tsx).
 */
export function ArrangeLayoutMenu() {
  const t = useMessages(shellMessages).settings;
  const label = useMessages(agentsMessages).arrangeMenu.label;
  const saved = useArrangeLayout();
  const [asked, setAsked] = useState<Asked | null>(null);

  useUiRequest("arrangeMenu", (request) => {
    setAsked({ workspaceId: request.workspaceId, target: request.target, at: request.at });
    return true;
  });

  const pick = (layout: ArrangeLayout) => {
    setAsked(null);
    if (asked) arrangeAs(asked.workspaceId, asked.target, layout);
  };

  return (
    <PointMenu at={asked?.at ?? null} label={label} onClose={() => setAsked(null)} className="w-44 p-1" anchorProps={{ "data-arrange-anchor": "" }}>
      <DropdownMenuRadioGroup value={saved}>
        {ARRANGE_LAYOUTS.map((layout) => (
          <DropdownMenuRadioItem key={layout} value={layout} className={POINT_MENU_ROW} onSelect={() => pick(layout)}>
            {t.arrangeLayouts[layout]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </PointMenu>
  );
}
