import { defineMessages, plural } from "@/i18n";

/** The git window's texts (spec fenêtre git). */
export const gitMessages = defineMessages(
  {
    open: (branch: string, changed: number) =>
      changed > 0 ? `Open the git window · ${branch} · ${plural(changed, "changed file", "changed files")}` : `Open the git window · ${branch}`,
    title: "Git",
    refresh: "Refresh",
    close: "Close",
    tabChanges: (count: number) => `Changes (${count})`,
    tabHistory: "History",
    reading: "Reading the repository…",
    ahead: (count: number) => `${count} to push`,
    behind: (count: number) => `${count} behind`,
    changes: {
      includeAll: "Include all",
      include: (path: string) => `Include ${path}`,
      discard: (path: string) => `Discard ${path}`,
      clean: "Nothing to commit: the folder matches the last commit",
      messageLabel: "Commit message",
      messagePlaceholder: "Describe what this commit changes",
      commit: (count: number) => `Commit (${count})`,
      committing: "Committing…",
      committed: (hash: string) => `Commit ${hash} created`,
      // What a screen reader hears on the list's one tab stop (P2-16).
      keys: "Up and Down move between the files, Enter shows the diff, Space includes or leaves out the file, Delete discards its changes",
      leftOut: "left out of the commit",
    },
    discard: {
      title: "Discard these changes?",
      changed: (path: string) => `${path} goes back to its last commit. This cannot be undone.`,
      added: (path: string) => `${path} will be removed from the index and deleted from the disk. This cannot be undone.`,
      deleted: (path: string) => `${path} will be deleted from the disk, without going through the Recycle Bin. This cannot be undone.`,
      cancel: "Cancel",
      confirm: "Discard this file",
    },
    history: {
      empty: "No commit yet",
      cut: (count: number) => (count === 1 ? "Only the latest commit is shown" : `Only the latest ${count} commits are shown`),
      /** A ref's tooltip: what kind of name it is, and whether HEAD is there. */
      ref: (kind: "branch" | "remote" | "tag" | "head", name: string, current: boolean) =>
        kind === "head" ? "Detached HEAD" : `${{ branch: "Branch", remote: "Remote branch", tag: "Tag" }[kind]} ${name}${current ? " · HEAD" : ""}`,
    },
    push: {
      label: "Push",
      count: (count: number, target: string) => `Push ${count} → ${target}`,
      to: (target: string) => `Push → ${target}`,
      pushing: "Pushing…",
      done: (target: string) => `Pushed to ${target}`,
      upToDate: "Already up to date",
      noRemote: "This repository has no remote",
      manyRemotes: "Several remotes and no origin: push from a terminal",
      detached: "Detached HEAD: no branch to push",
      noCommit: "No commit to push",
      mirror: "This remote is a mirror: push from a terminal",
    },
  },
);
