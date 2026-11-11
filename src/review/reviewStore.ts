import { createStore, useStore } from "zustand";
import type { Remark } from "./review";

interface ReviewState {
  /** The terminal whose work the panel shows; null when it is closed. */
  nodeId: string | null;
  /** The remarks written for it, sent together. */
  remarks: Remark[];
  /** Whose the remarks are: they wait for it through a close. */
  remarksFor: string | null;
  open: (nodeId: string) => void;
  close: () => void;
  add: (remark: Remark) => void;
  remove: (index: number) => void;
  clear: () => void;
}

/** The review panel: one agent at a time; its remarks wait until sent or the panel moves on. */
export const reviewStore = createStore<ReviewState>()((set, get) => ({
  nodeId: null,
  remarks: [],
  remarksFor: null,
  open: (nodeId) => set({ nodeId, remarksFor: nodeId, remarks: get().remarksFor === nodeId ? get().remarks : [] }),
  close: () => set({ nodeId: null }),
  add: (remark) => set((s) => ({ remarks: [...s.remarks, remark] })),
  remove: (index) => set((s) => ({ remarks: s.remarks.filter((_, i) => i !== index) })),
  clear: () => set({ remarks: [] }),
}));

export function useReview<T>(selector: (state: ReviewState) => T): T {
  return useStore(reviewStore, selector);
}

export const openReview = (nodeId: string) => reviewStore.getState().open(nodeId);
