import { useState, type FormEvent } from "react";
import { announceFolderMove } from "@/canvas/folderMove";
import { canvasMessages } from "@/canvas/messages";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAgents } from "@/agents/agentsStore";
import { LaunchOptionsForm } from "@/agents/LaunchOptionsForm";
import type { LaunchOptions } from "@/agents/launchAgent";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, useNodes } from "@/store/nodes";
import { useMessages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";
import { folderChange, folderLockOf } from "./folder";

/**
 * Folder, shell and title of one terminal, and the command of a Custom one, used at its next launch.
 * The edit panel (canvas/TerminalEdit) sets the same ones; the folder follows the same rules in both: a
 * mission's agent keeps its worktree, so its folder is shown as it is, with the reason, and cannot be edited.
 */
export function TerminalOptionsDialog(props: { nodeId: string; payload: TerminalPayload; onClose: () => void }) {
  const { nodeId, payload, onClose } = props;
  const t = useMessages(nodesMessages).options;
  const canvas = useMessages(canvasMessages).selection;
  const shells = useAgents((s) => s.shells);
  const lock = useNodes((s) => folderLockOf(nodeId, s.nodes));
  // Every other agent ignores the command: it is neither shown nor written for them, so a stored one stays as it was.
  const custom = payload.agent === "custom";
  const [value, setValue] = useState<LaunchOptions>({
    cwd: payload.cwd,
    shell: payload.shell,
    title: payload.title,
    command: payload.command,
  });

  const apply = (event: FormEvent) => {
    event.preventDefault();
    // The folder goes through the edit panel's rules: a locked one is not read, a Claude terminal that moves
    // starts a new conversation (it cannot resume one from another folder), and a running one is offered the
    // restart that takes it there.
    const moved = lock ? null : folderChange(payload, value.cwd);
    // A title left as it was gives way to the one the move gives (a terminal named after its folder).
    const typed = value.title.trim();
    const retitled = Boolean(typed) && typed !== payload.title;
    const patch = {
      ...moved,
      shell: value.shell,
      title: retitled ? typed : (moved?.title ?? payload.title),
      // A title the user gives says what the terminal does now, though its old one named a finished task.
      ...(retitled && payload.staleTitle ? { staleTitle: undefined } : {}),
      ...(custom ? { command: value.command.trim() } : {}),
    };
    nodesStore.getState().update(nodeId, patch);
    if (moved?.cwd) announceFolderMove(nodeId, payload, moved.cwd);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.title(payload.name || t.thisTerminal)}</DialogTitle>
        </DialogHeader>
        {/* A form, so Enter in a field applies like the button. */}
        <form onSubmit={apply} className="grid gap-4">
          <LaunchOptionsForm
            value={lock ? { ...value, cwd: payload.cwd } : value}
            shells={shells.length ? shells : [payload.shell]}
            showCommand={custom}
            folderLocked={lock ? (lock === "fleet" ? canvas.folderFleet : canvas.folderMission) : undefined}
            onChange={setValue}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit">{t.apply}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
