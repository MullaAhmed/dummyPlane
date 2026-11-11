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
      // Icon buttons beside the Name field: their names say what they act on.
      copyTerminal: "Copy the terminal",
      deleteTerminal: "Delete the terminal",
      deleteFleet: "Delete the fleet",
      copyFailed: (error: string) => `Could not copy the terminal: ${error}`,
      name: "Name",
      /** What the agent is doing now, at the top of the General page. */
      status: "Status",
      step: (index: number, total: number, title: string) => `Step ${index} of ${total}: ${title}`,
      stepsDone: (done: number, total: number) => `${done} of ${total} steps done`,
      lastReport: "Last report",
      tokens: (count: string) => `${count} tokens`,
      context: (percent: number) => `${percent} % context`,
      // The title the program running in the terminal sets now (Claude Code its own, a shell its path).
      liveTitle: "Title",
      // The stored title: Claude gets it with `-n` only when a new conversation starts; a resumed one keeps its name.
      sessionName: "Session name",
      sessionNameHint: "Claude's name for a new conversation",
      // Over the settings read when the terminal next starts: said once, here.
      nextLaunch: "Next launch",
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
      // Claude keeps a conversation with the folder it started in (it cannot resume one from another folder): said when it moves.
      folderNewConversation: "New folder, new conversation: Claude keeps each conversation with its folder",
      // The same with a profile: its conversations live in the profile's folder.
      accountNewConversation: "New account, new conversation: Claude keeps each conversation with its account",
      command: "Command",
      shell: "Shell",
      model: "Model",
      // No `--model`: Claude picks, from the profile's settings or its own default. Never a bare "Default".
      claudeDefault: "Claude's default",
      // Under the model chosen, while the session runs: what its status line says it uses now, maybe after /model.
      runningModel: (model: string) => `Running ${model}`,
      runningModelEffort: (model: string, effort: string) => `Running ${model}, ${effort} effort`,
      permission: "Permissions",
      // No `--permission-mode`: Claude asks as the user's own settings say.
      claudeSettings: "Claude's settings",
      // As a mission words them: files are edits, commands are Bash (and the web, subagents); the rest is refused unasked.
      permissions: { ask: "Ask first", edits: "Files unasked", work: "Files and commands unasked" },
      // Under the choice; any permission given also blocks git push in the session (not a security boundary).
      permissionHelp: {
        ask: "Asks before each edit and command · git push blocked",
        edits: "Asks before a command · git push blocked",
        work: "Commands, the network and this PC's logged-in accounts are open to it · git push blocked",
      },
      account: "Account",
      remoteControl: "Remote Control",
      // Beside its box: where Remote Control stands; it applies to a running session at once.
      remoteStates: { on: "On", connecting: "Connecting…", pending: "At the end of its turn", requested: "Requested", nextStart: "At next start" },
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
