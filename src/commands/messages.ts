import { defineMessages, plural } from "@/i18n";

/** Texts of the palette (the catalogs' own are in catalog/messages.ts). */
export const commandsMessages = defineMessages({
    palette: {
      label: "Palette",
      placeholderGoTo: "Go to a terminal, a workspace, a file (file:line)… (> for functions)",
      placeholderFunctions: "Search for a function…",
      loading: "Loading…",
      empty: "No results",
      footer: "↑↓ navigate · Enter open · Esc close",
      recent: "Recent",
    },
    failed: (label: string, error: string) => `${label} failed: ${error}`,
    failedLike: {
      "terminal.duplicate": (error: string) => `Could not duplicate: ${error}`,
      "workspace.new": (error: string) => `Could not create: ${error}`,
      "workspace.delete": (error: string) => `Could not delete: ${error}`,
      "group.orchestrate": (error: string) => `Could not create the fleet: ${error}`,
    } as Record<string, ((error: string) => string) | undefined>,
    goTo: {
      sections: { terminal: "Terminals", group: "Groups", orchestrator: "Fleets", workspace: "Workspaces", project: "Projects", file: "Files" },
      // Words split on spaces: "orchestrator", the fleet's former name, still finds it.
      keywords: { group: "group", orchestrator: "fleet orchestrator", workspace: "workspace", tab: "tab" },
      members: (count: number) => plural(count, "agent", "agents"),
      linked: (count: number) => `linked to ${count}`,
      live: (count: number) => plural(count, "active", "active"),
      shown: "shown",
      openFailed: (error: string) => `Could not open: ${error}`,
      gone: (label: string) => `${label} no longer exists`,
      unreadable: (name: string) => `Workspace ${name} is unreadable`,
      atLine: (line: number) => `line ${line}`,
    },
  });
