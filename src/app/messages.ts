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
    /** Any failed start: the start itself, or the projects it reads last. */
    startFailed: "dummyPlane could not start",
  },
);
