import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCanvas } from "@/canvas/canvasStore";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { closeGroup } from "@/fleet/groups";
import { livingAgents } from "@/fleet/groupSummary";
import { nodeNameOf, useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { uiStore, useUi } from "@/store/ui";
import { shellMessages } from "./messages";

const buttonBase =
  "rounded-md transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out motion-reduce:transition-none active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50";

/** "Close the group Backend?" listing the agents still running (spec habillage §11.4). */
export function CloseGroupDialog() {
  const t = useMessages(shellMessages).closeGroup;
  const groupId = useUi((s) => s.closingGroup);
  const group = useCanvas((s) => s.frames.find((f) => f.id === groupId) ?? null);
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const living = group
    ? livingAgents(group.memberIds, (id) => nodeNameOf(nodes[id]) || "Agent", (id) => statuses[id]?.state === "running")
    : [];
  const close = () => uiStore.getState().setClosingGroup(null);

  return (
    <Dialog open={groupId !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false} className="rounded-xl bg-dp-surface text-dp-text ring-dp-line sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.title(group?.name)}</DialogTitle>
          <DialogDescription className="text-dp-text-2">{t.description(living)}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="border-dp-line bg-dp-hover">
          <Button
            variant="ghost"
            onClick={close}
            className={cn(buttonBase, "text-dp-text-2 hover:bg-dp-hover hover:text-dp-text")}
          >
            {t.cancel}
          </Button>
          <Button
            className={cn(buttonBase, "bg-dp-danger/10 text-dp-danger hover:bg-dp-danger/20")}
            onClick={() => {
              if (groupId) closeGroup(groupId);
              close();
            }}
          >
            {t.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
