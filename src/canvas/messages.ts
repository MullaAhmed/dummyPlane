import { defineMessages } from "@/i18n";
import { ROUTER_LEVELS } from "@/mission/router";

/** The texts of the canvas. */
export const canvasMessages = defineMessages(
  {
    saveFailed: "Could not save the canvas",
    loadFailed: (error: string) => `Could not load this workspace: ${error}`,
    retryLoad: "Try again",
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
      copyFailed: "Could not copy the terminal",
      name: "Name",
      /** What the agent is doing now, at the top of the General page. */
      status: "Status",
      step: (index: number, total: number, title: string) => `Step ${index} of ${total}: ${title}`,
      stepsDone: (done: number, total: number) => `${done} of ${total} steps done`,
      lastReport: "Last report",
      tokens: (count: string) => `${count} tokens`,
      context: (percent: number) => `${percent} % context`,
      // Over the settings read when the terminal next starts: said once, here.
      nextLaunch: "Next launch",
      folder: "Folder",
      copyPath: "Copy the path",
      pathCopied: "Path copied",
      copyPathFailed: "Could not copy the path",
      changeFolder: "Change…",
      changeFolderLabel: "Change the folder",
      pickFolder: "Working folder",
      pickFolderFailed: "Could not open the folder picker",
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
      // No `--model`: the model Claude picks itself, named, never a bare "Default". While it runs on that pick, the
      // model its status line reports; else the `model` its settings give (an alias as written), else the plan's.
      ownModel: {
        settings: (model: string) => `${model} · your settings`,
        plan: (model: string) => `${model} · plan default`,
        planOnly: "Your plan's default model",
      },
      // Under the model chosen, while the session runs: what its status line says it uses now, maybe after /model.
      runningModel: (model: string) => `Running ${model}`,
      // `--effort`, Claude Code's levels on a slider; Auto gives no flag.
      effort: "Effort",
      effortAuto: "Auto",
      efforts: { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" },
      // Under Auto, before the status line reports a level: where Claude's own level comes from.
      effortAutoHint: "Your settings, else the model's default",
      // Under the effort, while the session runs: the level its status line reports, maybe after /effort.
      runningEffort: (effort: string) => `Running at ${effort}`,
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
      // The model router, a switch of the first group: it applies at once and is no launch setting, so it never offers a restart.
      modelRouter: "Model router",
      // Under a Fleet's switch: it routes the whole team of its mission.
      modelRouterFleet: `Each agent of its team takes the model of its sub-task's level: ${ROUTER_LEVELS}`,
      // Under a terminal's switch, on: a sub-task a Fleet gives it, with its level; one without a level leaves its model as it is.
      modelRouterAgent: `With it on, a sub-task a Fleet gives it starts it on the model of its level: ${ROUTER_LEVELS}. A sub-task with no level leaves its model as it is`,
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
      sources: { user: "user", project: "project", local: "local", plugin: "plugin", builtin: "built-in", synced: "claude.ai", app: "dummyPlane" },
      sourceHints: {
        user: "From your Claude folder",
        project: "From the project's files",
        local: "From the project's entry in .claude.json",
        plugin: "From a plugin: on only while the plugin is",
        builtin: "Built into Claude Code",
        synced: "From your claude.ai account, synced by Claude Code",
        app: "dummyPlane's own",
      },
      offInSettings: "Off in your Claude settings",
      offWithPlugin: "Its plugin is off: turn it on in Plugins first",
      // A plugin's skill: Claude's skill overrides don't reach it, so it has no switch of its own.
      followsPlugin: "Comes with its plugin: switch the plugin in Plugins",
      // dummyPlane's own server has no switch: its tools are how the terminal reports, marks steps and opens agents.
      ownServerAlwaysOn: "dummyPlane's tools: always on",
      // A fleet's session always has dummyPlane's own server: it carries the mission's tools, so it has no switch.
      missionServerAlwaysOn: "The fleet's mission server is always on",
      // Under each list: what Claude loads that nothing on disk names, so the list can't show it.
      notListed: {
        skills: "Claude Code's bundled skills aren't listed here: they ship inside Claude Code",
        plugins: "Claude Code's built-in plugins aren't listed here: run /plugin in the terminal to see them",
        mcp: "claude.ai connectors aren't listed here",
        agents: "Claude Code's built-in subagents aren't listed here",
      },
      appliesOnRestart: "Changes apply when the terminal restarts",
      appliesOnRestartFleet: "Changes apply when the fleet restarts",
      // Beside "Restart now": the running session still has the choices it started with.
      runningOldChoice: "Running with the old choices",
      restartNow: "Restart now",
    },
  },
);
