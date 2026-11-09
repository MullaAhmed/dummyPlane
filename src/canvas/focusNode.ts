import { expandTerminal } from "@/nodes/terminal/minimize";
import { focusTerminal } from "@/nodes/terminal/registry";
import { setActiveTerminal } from "./activeTerminal";
import { arrive } from "./arrive";
import { canvasStore, fullSizeView } from "./canvasStore";
import { nodeKindOf } from "./nodeElement";

/** The fleet panel's click: the view centered on the terminal at 100 %, the element activated (its header menu answers at once), and the keyboard to it (spec habillage §5.5). */
export function focusNode(nodeId: string) {
  const api = canvasStore.getState().api;
  let element = api?.getSceneElements().find((e) => e.id === nodeId);
  if (!api || !element) return;
  // Its group is folded: arriving unfolds it, then centers and activates (spec replier un groupe §2).
  if (canvasStore.getState().frames.some((f) => f.group?.folded && f.memberIds.includes(nodeId))) {
    arrive(nodeId);
    return;
  }
  // A minimized terminal expands first: the view centers its element at full size, and activates that one.
  const expanded = expandTerminal(nodeId);
  if (expanded) element = api.getSceneElements().find((e) => e.id === nodeId) ?? element;
  // The selection left behind goes: with it kept, Send would still reach the old selection, not the terminal just opened.
  api.updateScene({
    appState: {
      ...fullSizeView(element, api.getAppState()),
      activeEmbeddable: { element, state: "active" },
      selectedElementIds: {},
      selectedGroupIds: {},
    },
  });
  if (nodeKindOf(element) === "terminal") setActiveTerminal(nodeId);
  // Just expanded, its xterm is still hidden until React shows it: the keyboard goes to it a frame later.
  if (expanded) requestAnimationFrame(() => focusTerminal(nodeId));
  else focusTerminal(nodeId);
}
