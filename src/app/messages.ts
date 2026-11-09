import { defineMessages } from "@/i18n";

/** App-level texts: toasts of the about, logs, updates and settings modules, and the start-up errors. */
export const appMessages = defineMessages(
  {
    loading: "Loading…",
    hooksDown: "Agent states are approximate: the local server is unavailable",
    aboutDescription: "A local, open source canvas for agents.",
    logsFailed: "Could not open the logs folder",
    dataFailed: "Could not open the data folder",
    settingNotSaved: (error: string) => `Setting not saved: ${error}`,
    upToDate: "OpenVibe is up to date.",
    updateCheckFailed: "Could not check for updates",
    updateWaitsForSave: "Update on hold: save your changes first, then start it again.",
    startInterrupted: (message: string) => `start interrupted (${message})`,
    projectsLoadFailed: (error: string) => `Could not load the projects: ${error}`,
  },
);
