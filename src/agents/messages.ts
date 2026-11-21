import { defineMessages, plural } from "@/i18n";

/** "Storm", "Storm and Loki", "Storm, Loki and 2 others": the agents a notice names. */
const whoJoined = (names: readonly string[]) =>
  names.length <= 2 ? names.join(" and ") : `${names[0]}, ${names[1]} and ${plural(names.length - 2, "other", "others")}`;

/**
 * The state table: the one word of each state an agent stands in, read by every surface that names one (the foot and
 * the status pill, the rows, the panel's filters, the group labels and counts, the mission rows, the finish alerts).
 * `ready`: its turn is over and it waits for your next message; `done` only for an agent that reported done. A word that
 * stands inside a line is read lowercase (`inLine`). `src/i18n/wording.test.ts` holds every surface to this table.
 */
export const stateWords = defineMessages({
  working: "Working",
  waiting: "Waiting",
  ready: "Ready",
  blocked: "Blocked",
  failed: "Failed",
  exited: "Exited",
  done: "Done",
});

/** A word of the table inside a line: "2 working", "done". */
export const inLine = (word: string) => word.toLowerCase();

/** Every text of the agents panel and the agent menus the interface shows. */
export const agentsMessages = defineMessages({
    launchFailed: "Could not launch the agent",
    launchNext: "Check that the agent is installed and its folder exists, then try again",
    fleetFailed: "Could not create the fleet",
    foldWaiting: "Wait for the group's agents to start before folding it: a hidden agent does not start",
    noClaude: 'Claude Code is not installed: a fleet needs it. Install it (see "Getting started" on the home screen), then try again.',
    settingNotSaved: "Could not save the setting",
    /** A setting already applied on screen, whose saving failed. */
    settingForNow: "It applies for now; dummyPlane will not remember it after a restart",
    agentFallback: "Agent",
    catalog: {
      customLabel: "Custom",
      ollamaVendor: "local model",
      shellVendor: "default",
      customVendor: "command",
    },
    roles: {
      frontend: "Frontend",
      backend: "Backend",
      testers: "Testers",
      reviewers: "Reviewers",
      design: "Design",
      docs: "Docs",
      security: "Security",
      general: "General",
    },
    pantheons: {
      dc: "DC",
      marvel: "Marvel",
      "throne-of-glass": "Throne of Glass",
      "star-wars": "Star Wars",
      "lord-of-the-rings": "Lord of the Rings",
    },
    // The `done` filter (its id is kept, a saved choice names it) lists the agents at rest: the state table's Ready.
    filters: { all: "All", waiting: stateWords.waiting, working: stateWords.working, done: stateWords.ready },
    outsideGroup: "No group",
    // A group's label, worst first: "3 · 1 waiting · 1 working". Nobody waiting or working: every member at rest says "ready", else the count at rest.
    summary: {
      waiting: (count: number) => `${count} ${inLine(stateWords.waiting)}`,
      working: (count: number) => `${count} ${inLine(stateWords.working)}`,
      ready: (count: number) => `${count} ${inLine(stateWords.ready)}`,
      allReady: inLine(stateWords.ready),
      agents: (count: number) => plural(count, "agent", "agents"),
      groups: (count: number) => plural(count, "group", "groups"),
    },
    slashHints: {
      effort: "Effort: low, medium, high, xhigh, max, ultracode — also becomes Claude's default",
      model: "Model: haiku, sonnet, opus, fable",
      remoteControl: "Follow the session from claude.ai or your phone",
      compact: "Summarize the conversation to free up context",
      clear: "Start over with an empty conversation",
      context: "Context usage",
      usage: "Cost and usage limits",
      fast: "Fast mode",
      status: "Version, model, account",
    },
    targets: {
      all: "@all",
      /** In grey under a Fleet in the `@` list, where an agent shows its group. */
      fleet: "Fleet",
    },
    /** What a parent did in its own sub-agent's terminal (`@/mcp/subAgentTools`): a toast, and a line in the log. */
    parentControl: {
      ran: (parent: string, child: string, command: string) => `${parent} ran ${command.length > 80 ? `${command.slice(0, 79)}…` : command} in ${child}'s terminal`,
      answered: (parent: string, child: string, dialog: string, choice: string) => `${parent} answered ${child}'s dialog "${dialog}": ${choice}`,
    },
    broadcast: {
      skipped: (names: readonly string[]) =>
        names.length === 1 ? `1 stopped agent ignored: ${names[0]}` : `${names.length} stopped agents ignored: ${names.join(", ")}`,
      starting: (names: readonly string[]) =>
        names.length === 1 ? `1 agent still starting ignored: ${names[0]} — try again in a moment` : `${names.length} agents still starting ignored: ${names.join(", ")} — try again in a moment`,
      resumeFailed: (name: string) => `${name} could not resume: its process just stopped`,
      waiting: (names: readonly string[]) =>
        names.length === 1
          ? `1 waiting agent ignored: ${names[0]} — answer it in its terminal`
          : `${names.length} waiting agents ignored: ${names.join(", ")} — answer them in their terminals`,
      unsuited: (names: readonly string[]) => {
        const why = "a / command only goes to agents";
        return names.length === 1
          ? `1 terminal without an agent ignored: ${names[0]} — ${why}`
          : `${names.length} terminals without an agent ignored: ${names.join(", ")} — ${why}`;
      },
      paused: (count: number) => (count === 0 ? "No running agent to pause" : count === 1 ? "1 agent paused" : `${count} agents paused`),
      resumed: (count: number) => (count === 0 ? "No paused agent to resume" : count === 1 ? "1 agent resumed" : `${count} agents resumed`),
    },
    remote: {
      label: "Remote Control",
      on: "Remote Control on",
      connecting: "Remote Control: connecting…",
      pending: "Remote Control at the end of its turn",
      failed: "failed",
      error: (error: string) => `Remote Control: ${error}`,
      /** The toast of a switch that failed; what went wrong goes under it. */
      notChanged: (on: boolean) => `Could not turn ${on ? "on" : "off"} Remote Control`,
      requested: "Remote Control requested",
      nextStart: "Remote Control at next start",
      turnOff: "Turn off Remote Control",
      turnOn: "Turn on Remote Control",
      retry: "Try again",
      copyLink: "Copy the link",
      linkCopied: "Link copied",
      openInBrowser: "Open in the browser",
      consent: "Claude asks for your consent for Remote Control: answer in its terminal",
      notConfirmed: "Claude did not confirm Remote Control",
      draft: "Claude has text being typed: send or clear it, then try again",
      menuNotOpened: "Claude did not open the Remote Control menu",
      menuUnreadable: "The Remote Control menu could not be read",
      disconnectNotConfirmed: "Claude did not confirm the disconnection",
      noClaudeSession: "No Claude session here",
      done: (on: boolean, names: string) => `Remote Control ${on ? "turned on" : "turned off"}: ${names}`,
      later: (names: string) => `Remote Control at the end of their turn: ${names}`,
      nextStartFor: (names: string) => `Remote Control at next start: ${names}`,
      failedFor: (name: string, on: boolean) => `Could not turn ${on ? "on" : "off"} Remote Control for ${name}`,
    },
    /** The list of agents an "Other agent…" opens (./OtherAgentMenu.tsx): only those found on this machine. */
    otherAgentMenu: {
      label: "Launch an agent",
      /** When no agent was found (the first look failed or found none), in the list's place. */
      empty: "No agent found",
      /** Names the tool rail's ＋ button by its label (Add to canvas). */
      emptyHint: "Install one from Add to canvas",
    },
    /** The list of agents a group's "Add an agent" opens (./GroupAgentMenu.tsx). */
    groupAgentMenu: { label: "Add an agent to the group" },
    agentMenu: {
      notFound: (binary: string) => `${binary} not found in PATH`,
      /** Under an agent whose commands dummyPlane does not read (`DELETES_NOT_BLOCKED`). */
      deletesNotBlocked: "Not guarded: recursive deletes outside the worktree are not blocked",
      /** What the ＋ menu adds, in its sections: the agents, the terminals, the fleet and the boards, then the files. */
      sections: { agents: "Agents", terminals: "Terminals", boards: "Fleet and boards", files: "Files" },
      markdown: "Markdown",
      markdownHint: "a .md file of the project, rendered",
      /** Under "Shell" before the shells are known: what it opens. */
      plainShell: "a terminal without an agent",
      /** Under "Shell": the shells it offers, "PowerShell, Command Prompt, Git Bash". */
      shellChoices: (names: readonly string[]) => names.join(", "),
      fleet: "Fleet",
      fleetHint: "commands groups and agents",
      kanban: "Kanban",
      kanbanHint: "cards to drag onto an agent",
      placedWhereClicked: "launched where you clicked",
      thenClickCanvas: "then click on the canvas to place it",
      options: "Options",
      optionsHint: "The next agents you launch from this menu use these",
      launchCustom: "Launch the custom command",
    },
    launchFolder: {
      label: "Launch folder",
      pickTitle: "Choose the launch folder",
      change: "Change…",
      changeTooltip: "Choose another folder for this workspace's next terminals",
      projectFolder: "Project folder",
      backToProject: "Back to the project folder",
      recent: "Recent",
      saveFailed: "Could not save the launch folder",
    },
    agentRow: {
      remoteOn: "Remote Control on",
      center: (name: string) => `Center ${name}`,
      review: (name: string) => `Review of ${name}`,
      pause: (name: string) => `Pause ${name}`,
      resume: (name: string) => `Resume ${name}`,
      close: (name: string) => `Close ${name}`,
    },
    panel: {
      title: "Agents",
      launchAgent: "Add to canvas",
      newConsole: "New console",
      composeGroup: "Compose a group",
      pauseAll: "Pause all",
      resumeAll: "Resume all",
      moreActions: "More actions",
      foldAll: "Collapse all",
      unfoldAll: "Expand all",
      closePanel: "Close the panel",
      filters: "Show",
      noneInFilter: "No agent in this filter",
      none: "No agent",
      groupMenu: "Group menu",
      outsideMenu: "Pantheon of agents outside groups",
      fleets: "Fleets",
    },
    command: {
      unknownTarget: (target: string) => `Unknown target: ${target}`,
      remove: (label: string) => `Remove ${label}`,
      /** The chips' list. */
      targets: "Targets",
      /** The list of the images pasted into the field, and the name of each. */
      images: "Images",
      image: (n: number) => `Image ${n}`,
      /** Who the chips send to, read with the field. */
      to: (labels: readonly string[]) => `To ${labels.join(", ")}`,
      send: "Send",
      sendTo: (name: string) => `Send to ${name}`,
      sendsTo: (name: string) => `To ${name}`,
      writeInstruction: "Write an instruction",
      noAgents: "No agent in this target",
      // Beside their keycaps, while the field is empty: what @, / and ↑ do.
      keys: { target: "target", command: "command", history: "history" },
    },
    compose: {
      title: "Compose a group",
      groupName: "Group name",
      role: "Role",
      names: "Pantheon",
      fillWith: "Fill all with",
      fillAllWith: (label: string) => `Fill all with ${label}`,
      fewer: "One agent fewer",
      more: "One agent more",
      launch: (count: number) => `Launch ${count}`,
    },
    /** The list of layouts an "Arrange as…" opens (./ArrangeLayoutMenu.tsx); the layouts' names are the Settings'. */
    arrangeMenu: { label: "Arrange as" },
    groupMenu: {
      rename: "Rename",
      speciality: "Speciality",
      specialityLabel: "Group speciality",
      specialityCustom: "Your own, then Enter",
      specialityNone: "None",
      names: "Pantheon",
      namesHint: "Applies to agents added from now on",
      addAgent: "Add an agent",
      linkFleet: "Link a fleet",
      pauseAll: "Pause all",
      resumeAll: "Resume all",
      fold: "Fold the group",
      unfold: "Unfold the group",
      /** Its members inside its frame in a layout of the list under it, this once (the Settings' layouts). */
      arrange: "Arrange",
      ungroup: "Ungroup",
      close: "Close the group",
      /** In a terminal's or a Fleet's "⋯", when it stands in a group. */
      leave: "Remove from group",
    },
    options: {
      title: "Launch options",
      customTitle: "Custom command",
      folder: "Folder",
      browse: "Browse",
      shell: "Shell",
      titleField: "Title",
      automatic: "Automatic",
      command: "Command to run",
      commandHint: "A Custom terminal runs it in its shell when it starts",
    },
    link: {
      hint: "Click a group, an agent or a board to link, or pick one below · Esc to finish",
      agentHint: "Click another agent, a fleet or a board to link this agent, or pick one below · Esc to cancel",
      boardHint: "Click an agent or a fleet to link it to this board, or pick one below · Esc to cancel",
      kinds: { agent: "Agent", group: "Group", fleet: "Fleet", board: "Board" },
      boardName: (cards: number, repo?: string) => `Kanban board · ${repo ?? `${cards} ${cards === 1 ? "card" : "cards"}`}`,
      linked: "Linked",
      /** What an agent's click on a Fleet says when the wire does not give the agent what it is for (a Fleet it commands, hand_off). */
      fleetAlready: (fleet: string) => `${fleet} already commands this agent: no second wire`,
      fleetNotLinked: (fleet: string) => `Could not link to ${fleet}`,
      fleetNotLinkedNext: "Open its workspace so that its canvas loads, then link again",
      fleetTeam: (agent: string, fleet: string) => `${agent} is linked to ${fleet}, but works for a mission its Manager runs: it reports to its Manager, and has no hand_off to the Fleet until the mission ends`,
      fleetSubagent: (agent: string, fleet: string) => `${agent} is ${fleet}'s own sub-agent: it reports to the Fleet when its work is done, and has no hand_off to it`,
      /** Two agents linked, each left where it stood: why no group holds them (src/agents/linkGroup.ts). */
      notGrouped: (one: string, other: string, why: string) => `${one} and ${other} are linked, but not grouped: ${why}.`,
      whyNotGrouped: {
        otherGroups: (one: string, other: string) => `they stand in two groups, ${one} and ${other}. Move one into the other's group to group them`,
        inTheWay: "something stands in the way of a group around them",
        family: (agent: string) => `${agent} would be parted from its sub-agents or from the agent that opened it`,
        mission: (agent: string) => `${agent} works for a mission, whose group keeps to its team`,
        frame: (agent: string) => `${agent} stands in a frame drawn by hand`,
      },
    },
    /** The ＋ menu's "Shell": which shell the terminal opens. */
    shellPicker: {
      title: "Shell",
      hints: {
        default: "your login shell",
        powershell: "Windows PowerShell",
        pwsh: "pwsh, PowerShell 7 and later",
        cmd: "cmd.exe",
        gitbash: "bash from Git for Windows",
        wsl: "your default Linux distribution",
      },
    },
    ollama: {
      title: "Ollama",
      mode: "Mode",
      codeAgent: "Coding agent",
      chat: "Chat",
      aiderNotFound: "aider not found in PATH",
      reading: "Reading the models…",
      serverDown: "The Ollama server is not responding: open the Ollama app, then try again",
      retry: "Try again",
      noModels: "No model installed: download one below",
      pullLabel: "Download a model",
      pullPlaceholder: "name:tag",
      pull: "Download",
      pullInvalid: "This is not an Ollama model name",
      pullHint: "The download shows in a terminal on the canvas",
      suggestions: "Suggestions",
      sizeGb: (size: number) => `${size} GB`,
      uses: { code: "code", light: "modest machine", chat: "chat", reasoning: "reasoning", agent: "coding agent" },
      pulled: (model: string) => `Model ready: ${model}`,
    },
    install: {
      button: "Install",
      installAgent: (label: string) => `Install ${label}`,
      runsIn: (shell: string) => `This official command will run in a terminal on the canvas (${shell}):`,
      needsNode: "Requires Node.js and npm",
      npmMissing: "npm was not found: install Node.js first, which brings it",
      getNode: "Download Node.js",
      recheck: "Check again",
      officialPage: "Official page",
      run: "Run in a terminal",
      terminalTitle: (label: string) => `Install · ${label}`,
      installed: (label: string) => `${label} is installed`,
      // The installed toast's action: the agent, launched where the view is.
      launch: (label: string) => `Launch ${label}`,
      launchNoCanvas: "Open a canvas of the project first: the agent starts there",
      noCanvas: "Open a project: the install runs in a terminal on its canvas",
      /** The terminal of an install or a model pull did not start; what went wrong goes under it. */
      terminalFailed: "Could not open the install terminal",
    },
    placement: {
      addToGroup: (name: string) => `Click or press Enter to add it to the group ${name} · Esc to cancel`,
      placeFleet: "Click or press Enter to place the fleet · Esc to cancel",
      placeAgent: "Click or press Enter to place the agent · Esc to cancel",
    },
    arrival: {
      show: "Show",
      mission: (names: readonly string[], where?: string) => `${whoJoined(names)} joined the mission${where ? ` in ${where}` : ""}`,
      spawn: (names: readonly string[], where?: string) => `${whoJoined(names)} joined as ${names.length === 1 ? "a sub-agent" : "sub-agents"}${where ? ` in ${where}` : ""}`,
      /** The group an agent in no group gathers its sub-agents in (./spawnGroup.ts), named after it. */
      familyGroup: (parent: string) => (parent ? `${parent}'s sub-agents` : "Sub-agents"),
    },
    resumeAll: {
      title: "Resume all conversations?",
      body: (count: number) => `${plural(count, "console can resume its", "consoles can resume their")} last conversation`,
      /** Sub-agents that reported: "Resume all" leaves them on their saved screen; their own node still restarts them. */
      stayStopped: (count: number) => `${plural(count, "finished sub-agent stays", "finished sub-agents stay")} stopped`,
      yes: "Yes",
      no: "No",
      close: "Close",
    },
  });
