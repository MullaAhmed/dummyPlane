import { defineMessages } from "@/i18n";

/** App-level texts: toasts of the about, logs, updates and settings modules, and the start-up errors. */
export const appMessages = defineMessages(
  {
    loading: "Loading…",
    hooksDown: "Agent states are approximate: the local server is unavailable",
    aboutDescription: "A local, open source canvas for agents",
    logsFailed: "Could not open the logs folder",
    dataFailed: "Could not open the data folder",
    settingNotSaved: "Could not save the setting",
    /** A setting already applied on screen, whose saving failed. */
    settingForNow: "It applies for now; dummyPlane will not remember it after a restart",
    upToDate: "dummyPlane is up to date",
    updateCheckFailed: "Could not check for updates",
    updateCheckNext: "Check your connection, then try again",
    updateWaitsForSave: "Update on hold: save your changes first, then start it again",
    /**
     * A saved list that could not be read was started again, and a write has replaced it: said once, with where its
     * old text is kept (`resetNotice`). One line for each list the stores keep, by what the user knows it as.
     */
    resetList: {
      loops: "Your loops could not be read and start empty",
      presets: "Your team presets could not be read and start empty",
      history: "A project's command history could not be read and starts empty",
      folders: "A project's recent folders could not be read and start empty",
      notifications: "Your notification history could not be read and starts empty",
      order: "A project's workspace order could not be read and starts again",
      levels: "Your model router levels could not be read and start again",
      other: (key: string) => `The setting ${key} could not be read and starts again`,
      /** A list that was read in part: its damaged entries, or a version this one does not know, were left out. */
      some: {
        loops: "Some of your loops could not be read and were left out",
        presets: "Some of your team presets could not be read and were left out",
      },
      kept: (aside: string) => `The old text is kept in the settings as ${aside}`,
    },
    /** Any failed start: the start itself, or the projects it reads last. */
    startFailed: "dummyPlane could not start",
  },
);
