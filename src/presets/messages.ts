import { defineMessages, plural } from "@/i18n";
import type { DeployResult } from "./deploy";

/** Texts of the team presets (spec presets §3). */
export const presetsMessages = defineMessages({
  section: "Teams",
  notRead: "The list of presets could not be read: nothing changed",
  save: "Save the team as a preset…",
  saveKeywords: ["team", "preset", "save", "topology"],
  deploy: (name: string, agents: number) => `Deploy team: ${name} (${plural(agents, "agent", "agents")})`,
  deployKeywords: (name: string) => ["team", "preset", "deploy", "place", "launch", name],
  remove: (name: string) => `Delete preset: ${name}`,
  removeKeywords: (name: string) => ["team", "preset", "delete", "remove", name],
  dialog: {
    title: "Save the team as a preset",
    description: "The groups, their agents and the linked fleets are kept; no instructions and no missions",
    nameLabel: "Preset name",
    placeholder: "Dev HQ",
    save: "Save",
    cancel: "Cancel",
    replaces: (name: string) => `Replaces the preset “${name}”`,
  },
  toast: {
    saved: (name: string) => `Preset “${name}” saved`,
    nothing: "No group with agents to save",
    noCanvas: "No workspace on screen: open a project to save its team",
    full: "Too many presets (50 at most): delete one first",
    removed: (name: string) => `Preset “${name}” deleted`,
    undo: "Undo",
    deployed: (name: string, r: DeployResult) =>
      `Team “${name}” deployed: ${plural(r.groups, "group", "groups")}, ${plural(r.agents, "agent", "agents")}, ${plural(r.fleets, "fleet", "fleets")}`,
    substituted: (count: number) => `${plural(count, "agent", "agents")} not found on this computer replaced by the default agent`,
    fleetsSkipped: (count: number) => `${plural(count, "fleet", "fleets")} not placed (Claude Code is required)`,
    failed: (error: string) => `Could not change the presets: ${error}`,
  },
});
