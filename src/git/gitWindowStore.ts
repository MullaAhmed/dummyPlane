import { createStore, useStore } from "zustand";
import { reviewStore } from "@/review/reviewStore";

interface GitWindowState {
  /** The folder the window shows; null when it is closed. */
  path: string | null;
  /** The folder the branch chip found a repository in (the active workspace's): what the palette's Git window opens. */
  repo: string | null;
  open: (path: string) => void;
  close: () => void;
}

/** The git window: it takes the review panel's place, so opening one closes the other. */
export const gitWindowStore = createStore<GitWindowState>()((set) => ({
  path: null,
  repo: null,
  open: (path) => {
    // This one first: a window is open throughout the change, so the Agents panel (folded while one is) does not come back and fold again.
    set({ path });
    reviewStore.getState().close();
  },
  close: () => set({ path: null }),
}));

export function useGitWindow<T>(selector: (state: GitWindowState) => T): T {
  return useStore(gitWindowStore, selector);
}

/** Gives the window the keyboard: its first changed file, else its open tab. False when it is not on screen. */
export function enterGitWindow(root: ParentNode | null = document.querySelector("[data-git-window]")): boolean {
  const target = root?.querySelector<HTMLElement>('button[data-git-row][tabindex="0"]') ?? root?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
  target?.focus({ preventScroll: true });
  return target != null;
}

/** The palette's Git window and Ctrl+Shift+B: opens it on the chip's repository, or, open already, gives it the keyboard. */
export function openGitWindow() {
  const { repo, path, open } = gitWindowStore.getState();
  if (!repo) return;
  if (path === repo) enterGitWindow();
  else open(repo);
}
