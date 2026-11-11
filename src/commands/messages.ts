import { defineMessages, plural } from "@/i18n";

/** Texts of the palette (the catalogs' own are in catalog/messages.ts). */
export const commandsMessages = defineMessages({
    palette: {
      label: "Palette",
      placeholderGoTo: "Go to a terminal, a workspace, a file (file:line)… (> for functions)",
      placeholderFunctions: "Search for a function…",
      loading: "Loading…",
      empty: "No results",
      // Read out by a screen reader once the list settles (the visible list says it by itself).
      results: (count: number) => plural(count, "result", "results"),
      footer: "↑↓ navigate · Enter open · Esc close",
      recent: "Recent",
    },
    failed: (label: string) => `${label} failed`,
    failedLike: {
      "terminal.duplicate": "Could not duplicate the terminal",
      "workspace.new": "Could not create the workspace",
      "workspace.delete": "Could not delete the workspace",
      "group.linkFleet": "Could not create the fleet",
    } as Record<string, string | undefined>,
    goTo: {
      sections: { terminal: "Terminals", group: "Groups", fleet: "Fleets", workspace: "Workspaces", project: "Projects", file: "Files" },
      // Words split on spaces: "orchestrator", the fleet's former name, still finds it.
      keywords: { group: "group", fleet: "fleet orchestrator", workspace: "workspace", tab: "tab" },
      members: (count: number) => plural(count, "agent", "agents"),
      linked: (count: number) => `linked to ${count}`,
      live: (count: number) => plural(count, "active", "active"),
      shown: "shown",
      openFailed: "Could not open the project",
      gone: (label: string) => `${label} no longer exists`,
      unreadable: (name: string) => `Workspace ${name} is unreadable`,
      atLine: (line: number) => `line ${line}`,
    },
  });
