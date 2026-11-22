import { Pencil } from "lucide-react";
import { useCanvas } from "@/canvas/canvasStore";
import { toggleEditPanel, useEditPanel } from "@/canvas/editPanel";
import { canvasMessages } from "@/canvas/messages";
import { useMessages } from "@/i18n";
import { nodeNameOf, useNodes } from "@/store/nodes";
import { HeaderButton } from "./NodeHeader";

/**
 * A terminal's or a Fleet's Edit, in its header: its Edit panel (canvas/TerminalEdit.tsx) opens beside the node,
 * the node selected alone; pressed again, it folds. Named after the node, as the panel's title. Not in reading
 * mode, where the panel does not show.
 */
export function EditButton({ nodeId }: { nodeId: string }) {
  const t = useMessages(canvasMessages).selection;
  const name = useNodes((s) => nodeNameOf(s.nodes[nodeId]));
  const fleet = useNodes((s) => s.nodes[nodeId]?.kind === "fleet");
  const open = useEditPanel() === nodeId;
  const reading = useCanvas((s) => s.view.mode === "reading");
  if (reading) return null;
  return (
    <HeaderButton
      label={t.editTerminal(name || (fleet ? t.thisFleet : t.thisTerminal))}
      aria-expanded={open}
      data-edit-node={nodeId}
      // Enter or Space click with no pointer (`detail` 0): the panel then takes the keyboard.
      onClick={(event) => toggleEditPanel(nodeId, { keyboard: event.detail === 0 })}
    >
      <Pencil />
    </HeaderButton>
  );
}
