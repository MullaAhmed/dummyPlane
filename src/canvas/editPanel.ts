import { createStore, useStore } from "zustand";
import { canvasStore } from "./canvasStore";

/**
 * The terminal (or Fleet) whose Edit panel is open, null while it is folded. The panel stands in the right
 * lane (shell/layout.ts), so the lane's rule reads it: one occupant at a time (agents/panelFold.ts).
 */
export const editPanelStore = createStore<{ openFor: string | null }>()(() => ({ openFor: null }));

export function useEditPanel(): string | null {
  return useStore(editPanelStore, (s) => s.openFor);
}

/** Opens the Edit panel of `nodeId`, selected alone (SelectionPanel folds a panel whose node is not). */
export function openEditPanel(nodeId: string) {
  if (editPanelStore.getState().openFor !== nodeId) editPanelStore.setState({ openFor: nodeId });
}

/** Folds the Edit panel. */
export function foldEditPanel() {
  if (editPanelStore.getState().openFor !== null) editPanelStore.setState({ openFor: null });
}

/** How long the header's Edit waits for its node's selection to show: Excalidraw tells it within a frame or two. */
const SELECTION_WAIT_MS = 1000;

/** Opened from the keyboard: the panel takes it (SelectionPanel). */
let keyboardOpen = false;

/** Whether the panel that just opened was opened from the keyboard: it then gives the keyboard to its fold button. Answers once. */
export function takeKeyboardOpen(): boolean {
  const keyboard = keyboardOpen;
  keyboardOpen = false;
  return keyboard;
}

let stopWaiting: (() => void) | null = null;

/** Runs `then` once the canvas shows `nodeId` selected alone; gives up after a while, or at the next call. */
function whenSelectedAlone(nodeId: string, then: () => void) {
  stopWaiting?.();
  const alone = () => {
    const ids = canvasStore.getState().view.selectedIds;
    return ids.length === 1 && ids[0] === nodeId;
  };
  const unsubscribe = canvasStore.subscribe(() => {
    if (!alone()) return;
    stop();
    then();
  });
  const timer = setTimeout(() => stop(), SELECTION_WAIT_MS);
  const stop = () => {
    unsubscribe();
    clearTimeout(timer);
    stopWaiting = null;
  };
  stopWaiting = stop;
}

/**
 * A terminal's or a Fleet's Edit, in its header (nodes/terminal/EditButton.tsx): its panel, open, folds; else
 * the node is selected alone and its panel opens once that selection is on screen, as SelectionPanel folds a
 * panel whose node is not the one selected. `keyboard`: pressed with Enter or Space, the panel takes the keyboard.
 */
export function toggleEditPanel(nodeId: string, { keyboard = false }: { keyboard?: boolean } = {}) {
  stopWaiting?.();
  if (editPanelStore.getState().openFor === nodeId) {
    foldEditPanel();
    return;
  }
  keyboardOpen = keyboard;
  const { api, view } = canvasStore.getState();
  if (view.selectedIds.length === 1 && view.selectedIds[0] === nodeId) {
    openEditPanel(nodeId);
    return;
  }
  if (!api) return;
  whenSelectedAlone(nodeId, () => openEditPanel(nodeId));
  api.updateScene({ appState: { selectedElementIds: { [nodeId]: true }, selectedGroupIds: {} } });
}
