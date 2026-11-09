import { defineMessages } from "@/i18n";

export const accountsMessages = defineMessages(
  {
    title: "Claude accounts",
    notRead: "The accounts could not be read: this terminal waits, so as not to start on another account.",
    description: "A profile is a name and a folder: Claude keeps its login and conversations there. OpenVibe only reads settings.json there, for the status line, and looks whether a conversation exists before resuming it, without reading it. It never touches your login.",
    defaultName: "Default",
    defaultHint: "OpenVibe's environment (CLAUDE_CONFIG_DIR or ~/.claude)",
    active: "active",
    use: "Use",
    login: "Log in",
    loginHint: "Opens a Claude terminal with this profile: log in there",
    remove: "Remove",
    removeHint: "Forgets the profile; its folder stays on the disk",
    addTitle: "Add a profile",
    nameLabel: "Name",
    namePlaceholder: "Work",
    folderLabel: "Folder",
    folderPlaceholder: "C:\Users\me\.claude-work",
    add: "Add",
    failed: (error: string) => `Failed: ${error}`,
    noProject: "Open a project to place the login terminal.",
    close: "Close",
    chipTitle: (folder: string) => `Account: ${folder}`,
  },
);
