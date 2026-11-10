import { defineMessages } from "@/i18n";

/** The texts of the canvas (spec première version §7.1). */
export const canvasMessages = defineMessages(
  {
    saveFailed: (error: string) => `Could not save: ${error}`,
    loadFailed: (error: string) => `Could not load this workspace: ${error}`,
    loading: "Loading…",
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
      thisFleet: "this fleet",
      foldPanel: "Fold the panel",
      rename: "Rename",
      copy: "Copy",
      copyFailed: (error: string) => `Could not copy the terminal: ${error}`,
      name: "Name",
      folder: "Folder",
      copyPath: "Copy the path",
      pathCopied: "Path copied",
      copyPathFailed: "Could not copy the path",
      changeFolder: "Change…",
      changeFolderLabel: "Change the folder",
      pickFolder: "Working folder",
      pickFolderFailed: (error: string) => `Could not open the folder picker: ${error}`,
      // Under the folder of a fleet or of a mission's agent, which cannot be moved.
      folderFleet: "A fleet stays in the project: its missions branch from it",
      folderMission: "Fixed while its mission runs: this agent works in its own worktree",
      // Claude keeps a conversation with the folder it started in (it cannot resume one from another folder).
      folderNewConversation: "New folder, new conversation: Claude keeps each conversation with its folder",
      command: "Command",
      shell: "Shell",
      title: "Title",
      model: "Model",
      defaultModel: "Default",
      useDefaultModel: "Use default",
      // The fields above are read when the terminal starts: the command only for a Custom one, a fleet's title is its name.
      nextLaunch: "Folder, shell and title apply at the next launch",
      nextLaunchCustom: "Command, folder, shell and title apply at the next launch",
      nextLaunchFleet: "The shell applies at the next launch",
      // Beside "Restart now": the running session still has the settings it started with.
      launchChanged: "Running with the old launch settings",
      tabs: { general: "General", skills: "Skills", plugins: "Plugins", mcp: "MCP", agents: "Subagents" },
      claudeOnly: "Skills, plugins and MCP servers can be chosen for Claude terminals",
      /** What a list holds, inside a sentence. */
      kinds: { skills: "skills", plugins: "plugins", mcp: "MCP servers", agents: "subagents" },
      search: (kind: string) => `Search ${kind}`,
      searchPlaceholder: "Search",
      empty: {
        skills: (folder: string) => `No skills in ${folder} or your Claude folder`,
        plugins: (_folder: string) => "No plugins installed",
        mcp: (folder: string) => `No MCP servers in ${folder} or your Claude settings`,
        agents: (folder: string) => `No subagents in ${folder} or your Claude folder`,
      },
      noMatch: (query: string) => `Nothing matches “${query}”`,
      // Above a list: how many of its items are on for this terminal; while a search narrows it, of the items shown,
      // the ones "Select all" and "Unselect all" switch. Short: it shares a line with both buttons.
      onCount: (on: number, total: number) => `${on} of ${total} on`,
      onCountShown: (on: number, shown: number) => `${shown} shown, ${on} on`,
      selectAll: "Select all",
      unselectAll: "Unselect all",
      listFailed: (error: string) => `Could not read the list: ${error}`,
      retry: "Try again",
      sources: { user: "user", project: "project", local: "local", plugin: "plugin" },
      sourceHints: {
        user: "From your Claude folder",
        project: "From the project's files",
        local: "From the project's entry in .claude.json",
        plugin: "From a plugin: on only while the plugin is",
      },
      offInSettings: "Off in your Claude settings",
      offWithPlugin: "Its plugin is off: turn it on in Plugins first",
      connectorsNotListed: "claude.ai connectors aren't listed here",
      // A fleet's session always has dummyPlane's own server: it carries the mission's tools, so it has no switch.
      missionServerAlwaysOn: "The fleet's mission server is always on",
      appliesOnRestart: "Changes apply when the terminal restarts",
      appliesOnRestartFleet: "Changes apply when the fleet restarts",
      // Beside "Restart now": the running session still has the choices it started with.
      runningOldChoice: "Running with the old choices",
      restartNow: "Restart now",
    },
  },
);
