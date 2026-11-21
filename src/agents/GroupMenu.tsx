import { useRef, useState, type ReactElement } from "react";
import { ChevronDown } from "lucide-react";
import { toastError } from "@/lib/errorToast";
import { useCanvas } from "@/canvas/canvasStore";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { messages, useMessages } from "@/i18n";
import { GroupNotesItem } from "@/notes/GroupNotesItem";
import { uiStore } from "@/store/ui";
import { shellMessages } from "@/shell/messages";
import { workspacesStore } from "@/store/workspaces";
import { agentsStore, isAvailable, useAgents } from "./agentsStore";
import { pauseAll, resumeAll } from "./broadcast";
import { agentInk, AGENTS, AGENTS_WITHOUT_OPTIONS } from "./catalog";
import { arrangeAs } from "./arrangeAs";
import { ARRANGE_LAYOUTS, type ArrangeLayout } from "./arrangeLayout";
import { agentsMessages } from "./messages";
import { addAgentToGroup, groupMembers, requestCloseGroup, setGroupFolded, setGroupPantheon, ungroup } from "./groups";
import { NamesMenu } from "./NamesMenu";
import { addFleetToGroup } from "@/fleet/fleets";
import { setRemoteControlAll } from "./remoteControl";
import { SpecialityMenu } from "./SpecialityMenu";

/** "Arrange" > a layout: the group's members inside its frame, in the shown workspace, in that layout this once; the setting stays. */
function arrangeGroupAs(groupId: string, layout: ArrangeLayout) {
  const workspaceId = workspacesStore.getState().activeId;
  if (workspaceId) arrangeAs(workspaceId, { kind: "group", id: groupId }, layout);
}

/**
 * The menu of a group: the `⌄` of its label on the canvas, or `trigger`, the ⋯ of its header in the agents panel.
 */
export function GroupMenu({ groupId, trigger }: { groupId: string; trigger?: ReactElement }) {
  const t = useMessages(agentsMessages);
  const layouts = useMessages(shellMessages).settings.arrangeLayouts;
  const [open, setOpen] = useState(false);
  // Rename hands the keyboard to the label's name field once the menu has closed: focus must not come back then.
  const renaming = useRef(false);
  const agents = useAgents((s) => s.agents);
  const speciality = useCanvas((s) => s.frames.find((f) => f.id === groupId)?.group?.speciality);
  const pantheon = useCanvas((s) => s.frames.find((f) => f.id === groupId)?.group?.pantheon);
  const folded = useCanvas((s) => s.frames.find((f) => f.id === groupId)?.group?.folded === true);
  // Only the agents found on this machine, as in the list of the ring's and the palette's Add agent (./GroupAgentMenu.tsx).
  const addable = AGENTS_WITHOUT_OPTIONS.filter((id) => isAvailable(agents, id));
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        // Nothing is known of the agents before the first look: the submenu would open empty.
        if (next && !agentsStore.getState().loaded) void agentsStore.getState().load().catch(() => undefined);
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t.panel.groupMenu}
            // A native title, like the label's fold chevron beside it: no tooltip over the canvas.
            title={t.panel.groupMenu}
            className="pointer-events-auto relative ml-1 size-5 rounded-sm text-dp-text-2 after:absolute after:-inset-0.5 hover:text-dp-text"
          >
            <ChevronDown className="size-3.5" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-48"
        onCloseAutoFocus={(e) => {
          // On the canvas, focus must not come back to the ⌄: it would close Excalidraw's name editor. The panel's ⋯
          // gets it back, so the keyboard keeps its place, unless a pick handed it on: the name field, a dialog, the notes.
          const elsewhere = document.activeElement !== null && document.activeElement !== document.body;
          if (!trigger || renaming.current || elsewhere) e.preventDefault();
          renaming.current = false;
        }}
      >
        {/* After the menu has closed, so its focus handling leaves the name field alone. */}
        <DropdownMenuItem
          onSelect={() => {
            renaming.current = true;
            requestAnimationFrame(() => uiStore.getState().setRenamingGroup(groupId));
          }}
        >
          {t.groupMenu.rename}
        </DropdownMenuItem>
        <SpecialityMenu groupId={groupId} speciality={speciality} onDone={() => setOpen(false)} />
        <NamesMenu current={pantheon} onPick={(id) => setGroupPantheon(groupId, id)} />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t.groupMenu.addAgent}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {addable.map((id) => {
              const meta = AGENTS[id];
              return (
                <DropdownMenuItem
                  key={id}
                  onSelect={() =>
                    void addAgentToGroup(groupId, id).catch((error: unknown) =>
                      toastError(messages(agentsMessages).launchFailed, { error, next: messages(agentsMessages).launchNext }),
                    )
                  }
                >
                  <meta.Icon style={{ color: agentInk(meta.tint) }} /> {meta.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          onSelect={() =>
            void addFleetToGroup(groupId).catch((error: unknown) => toastError(messages(agentsMessages).fleetFailed, { error }))
          }
        >
          {t.groupMenu.linkFleet}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void pauseAll(groupMembers(groupId))}>{t.groupMenu.pauseAll}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void resumeAll(groupMembers(groupId))}>{t.groupMenu.resumeAll}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void setRemoteControlAll(groupMembers(groupId), true)}>{t.remote.turnOn}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void setRemoteControlAll(groupMembers(groupId), false)}>{t.remote.turnOff}</DropdownMenuItem>
        <GroupNotesItem groupId={groupId} />
        <DropdownMenuSeparator />
        {/* Its members inside its frame in a layout of the list, this once (the tree: who opened whom, downward, src/agents/arrangeTree.ts); one undo. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t.groupMenu.arrange}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent data-arrange-layouts>
            {ARRANGE_LAYOUTS.map((layout) => (
              <DropdownMenuItem key={layout} onSelect={() => arrangeGroupAs(groupId, layout)}>
                {layouts[layout]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => setGroupFolded(groupId, !folded)}>{folded ? t.groupMenu.unfold : t.groupMenu.fold}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => ungroup(groupId)}>{t.groupMenu.ungroup}</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => requestCloseGroup(groupId)}>
          {t.groupMenu.close}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
