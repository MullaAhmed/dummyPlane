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
import { useExitSnapshot } from "@/lib/useExitSnapshot";
import { uiStore, useUi } from "@/store/ui";
import { QuietButton } from "./buttons";
import { shellMessages } from "./messages";

/** "Close the group Backend?" listing the agents still running. */
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
  const open = groupId !== null;
  // The group is gone once closed: its exit keeps the question it asked.
  const shown = useExitSnapshot(open, { title: t.title(group?.name), description: t.description(living) });
  const close = () => uiStore.getState().setClosingGroup(null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{shown.title}</DialogTitle>
          <DialogDescription>{shown.description}</DialogDescription>
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
