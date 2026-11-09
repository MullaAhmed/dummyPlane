import { defineMessages } from "@/i18n";

/** The texts of the canvas (spec première version §7.1). */
export const canvasMessages = defineMessages(
  {
    saveFailed: (error: string) => `Could not save: ${error}`,
    loadFailed: (error: string) => `Could not load this workspace: ${error}`,
    loading: "Loading…",
    groupName: (n: number) => `Group ${n}`,
    groupNameLabel: "Group name",
    foldGroup: "Fold the group",
    unfoldGroup: "Unfold the group",
  },
);
