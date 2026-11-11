import { useCanvas } from "@/canvas/canvasStore";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useMessages } from "@/i18n";
import { groupHolding } from "./groupHolding";
import { agentsMessages } from "./messages";

/**
 * "Remove from group" in the "⋯" of a terminal or a Fleet that stands in a group (see
 * `leaveGroup`); nothing for one in no group. Read as its menu opens: a Fleet's place in a
 * frame is its element's, which the frames do not list.
 */
export function LeaveGroupItem({ nodeId }: { nodeId: string }) {
  const t = useMessages(agentsMessages).groupMenu;
  // The frames change when a node joins or leaves one: the item follows while the menu is open.
  useCanvas((s) => s.frames);
  if (!groupHolding(nodeId)) return null;
  // Loaded on use: the node's header does not carry the scene's actions (and Excalidraw's helpers with them).
  return <DropdownMenuItem onSelect={() => void import("./groups").then(({ leaveGroup }) => leaveGroup(nodeId))}>{t.leave}</DropdownMenuItem>;
}
