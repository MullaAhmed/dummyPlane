import { Ellipsis } from "lucide-react";
import { toast } from "sonner";
import { groupPantheons } from "@/canvas/groups";
import { useCanvas } from "@/canvas/canvasStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMessages } from "@/i18n";
import { IconButton } from "@/shell/buttons";
import { useWorkspaces, workspacesStore } from "@/store/workspaces";
import { agentsMessages } from "./messages";
import { nextPantheon, PANTHEONS, pantheonById, type PantheonId } from "./names";

/** The note under the pantheons: plain helper text, not a section title (`.dp-label` is for those). */
const HINT = "px-1.5 py-1 text-xs text-dp-text-2";

/** The pantheons to choose from, the one in force checked. */
export function NamesRadios({ current, onPick }: { current: string | null | undefined; onPick: (id: PantheonId) => void }) {
  return (
    <DropdownMenuRadioGroup value={pantheonById(current).id} onValueChange={(id) => onPick(id as PantheonId)}>
      {PANTHEONS.map((p) => (
        <DropdownMenuRadioItem key={p.id} value={p.id}>
          {p.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** "Pantheon" of the group menu: which one the agents added to the group take their names from. */
export function NamesMenu({ current, onPick }: { current: string | null | undefined; onPick: (id: PantheonId) => void }) {
  const t = useMessages(agentsMessages).groupMenu;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {t.names}
        <span className="ml-1 max-w-24 truncate text-dp-text-3">{pantheonById(current).label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-52">
        <NamesRadios current={current} onPick={onPick} />
        <p className={HINT}>{t.namesHint}</p>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** The ⋯ of the "No group" header: the pantheon of the agents outside groups. */
export function OutsideNamesMenu() {
  const t = useMessages(agentsMessages);
  const workspace = useWorkspaces((s) => s.workspaces.find((w) => w.id === s.activeId));
  const frames = useCanvas((s) => s.frames);
  if (!workspace) return null;
  // Until one is saved, the one the next agent outside groups would be given.
  const current = workspace.pantheon ?? nextPantheon(groupPantheons(frames));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={t.panel.outsideMenu}
          className="size-6 opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <Ellipsis />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{t.groupMenu.names}</DropdownMenuLabel>
        <NamesRadios
          current={current}
          onPick={(id) =>
            void workspacesStore
              .getState()
              .setPantheon(workspace.id, id)
              .catch((error: unknown) => toast.error(t.settingNotSaved(String(error))))
          }
        />
        <p className={HINT}>{t.groupMenu.namesHint}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
