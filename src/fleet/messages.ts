import { defineMessages } from "@/i18n";

export const fleetMessages = defineMessages({
  agent: {
    title: "Agent for the Fleet",
    description: "The Fleet runs on this CLI, and so does every agent it starts: its team, the agents that take its queue, and their sub-agents.",
    label: "CLI the Fleet runs on",
    installed: "Installed",
    missing: "Not installed",
    why: {
      noTools: "Installed · not supported yet: dummyPlane cannot give it its tools and the mission's permissions",
    },
    missingWhy: "Not installed · and not supported for a Fleet yet",
    cancel: "Cancel",
    use: (agent: string) => `Use ${agent}`,
    menu: (agent: string) => `Fleet agent: ${agent}…`,
    notSaved: "Could not save the Fleet's agent",
    /** Chosen on screen, not on disk. */
    forNow: "It applies for now; dummyPlane will not remember it after a restart",
    notInstalled: (agent: string) => `${agent} is not installed, and the Fleet runs on it. Install it, or choose another CLI in Settings, Fleet agent.`,
  },
});
