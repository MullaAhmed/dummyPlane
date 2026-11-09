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
    /** The small panel left of the canvas: what a selected drawing or terminal can change. */
    selection: {
      stroke: "Stroke",
      background: "Background",
      transparent: "Transparent",
      duplicate: "Duplicate",
      delete: "Delete",
      // In the order of the pen's inks (PEN_COLORS).
      colorNames: ["Ink", "Terracotta", "Olive", "Ochre", "Red", "Sky", "Lavender", "Slate"],
      sloppiness: "Sloppiness",
      sloppinessLevels: { clean: "Clean", sketchy: "Sketchy", rough: "Rough" },
      arrowType: "Arrow type",
      arrowTypes: { sharp: "Sharp", round: "Round", elbow: "Elbow" },
      edit: "Edit",
      editTerminal: (name: string) => `Edit ${name}`,
      thisTerminal: "this terminal",
      name: "Name",
      folder: "Folder",
      workingFolder: "Working folder",
      browse: "Browse",
      command: "Command",
      model: "Model",
      defaultModel: "Default",
      nextLaunch: "Folder and command apply at the next launch.",
    },
  },
);
