import { createStore, useStore } from "zustand";

/** A yes-or-no question, in the caller's words. */
export interface ConfirmRequest {
  title: string;
  description: string;
  confirm: string;
  cancel: string;
  /** The action erases or stops something: its button says so. */
  destructive?: boolean;
}

interface Pending extends ConfirmRequest {
  answer: (yes: boolean) => void;
}

const confirmStore = createStore<{ pending: Pending | null }>()(() => ({ pending: null }));

export const usePendingConfirm = () => useStore(confirmStore, (s) => s.pending);

/**
 * Asks in the app's own dialog (ConfirmDialog), not the system's message box,
 * which wears Windows' look rather than the app's. One question at a time: a
 * new one answers no to the one still open.
 */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    confirmStore.getState().pending?.answer(false);
    confirmStore.setState({ pending: { ...request, answer: resolve } });
  });
}

/** The dialog's answer; it closes the question. */
export function answerConfirm(yes: boolean) {
  const pending = confirmStore.getState().pending;
  if (!pending) return;
  confirmStore.setState({ pending: null });
  pending.answer(yes);
}
