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
import { closeGroup } from "@/agents/groups";
import { livingAgents } from "@/agents/groupSummary";
import { nodeNameOf, useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { uiStore, useUi } from "@/store/ui";
import { QuietButton } from "./buttons";
import { shellMessages } from "./messages";

/** "Close the group Backend?" listing the agents still running (spec habillage §11.4). */
export function CloseGroupDialog() {
  const all = useMessages(shellMessages);
  const t = all.closeGroup;
  const groupId = useUi((s) => s.closingGroup);
  const group = useCanvas((s) => s.frames.find((f) => f.id === groupId) ?? null);
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const living = group
    ? livingAgents(group.memberIds, (id) => nodeNameOf(nodes[id]) || all.fallbackAgent, (id) => statuses[id]?.state === "running")
    : [];
  const close = () => uiStore.getState().setClosingGroup(null);

  return (
    <Dialog open={groupId !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t.title(group?.name)}</DialogTitle>
          <DialogDescription>{t.description(living)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <QuietButton onClick={close}>{t.cancel}</QuietButton>
          <Button
            variant="destructive"
            size="lg"
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
