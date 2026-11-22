import { Columns2, Columns3, Columns4, LayoutGrid, Network, SearchX, StretchHorizontal, StretchVertical } from "lucide-react";
import { arrangeLayoutStore } from "@/app/arrangeLayoutSetting";
import type { Command, CommandContext } from "@/commands/command";
import { agentsStore } from "@/agents/agentsStore";
import { arrangeAs, type ArrangeTarget } from "@/agents/arrangeAs";
import { ARRANGE_LAYOUTS, type ArrangeLayout } from "@/agents/arrangeLayout";
import { AGENTS, defaultAgent, DELETES_NOT_BLOCKED } from "@/agents/catalog";
import { agentsMessages } from "@/agents/messages";
import { launchOtherAgent, noAgentFound, otherAgentsOf } from "@/agents/otherAgents";
import { messages } from "@/i18n";
import { shellMessages } from "@/shell/messages";
import { radialMessages } from "./messages";
import type { RingSlot } from "./rings";

/*
 * The wedges of the arcs that are not More's (the petals): Arrange's layouts and Other agent's agents. They run
 * commands of their own, not the registry's: the palette offers the same choices in its lists (src/agents/
 * ArrangeLayoutMenu.tsx, OtherAgentMenu.tsx), which open the same routines (arrangeAs, launchOtherAgent).
 */

/** A petal's own command, for its name and its run: it is in no palette. */
function petal(id: string, label: string, run: (ctx: CommandContext) => void, disabled?: () => string): Command {
  return { id, label, section: "", keywords: [], available: () => true, disabled, run };
}

/** A layout's picture: the shape it lays the canvas out in. */
const LAYOUT_ICONS: Record<ArrangeLayout, RingSlot["icon"]> = {
  grid: LayoutGrid,
  row: StretchVertical,
  column: StretchHorizontal,
  "columns-2": Columns2,
  "columns-3": Columns3,
  "columns-4": Columns4,
  tree: Network,
};

/**
 * The arc of an Arrange wedge: the seven layouts of Settings → Arrange layout, in its order, the saved one marked. A
 * pick arranges `targetOf` its context in that layout (src/agents/arrangeAs.ts), as the palette's Arrange as… does:
 * picked for the whole canvas, the layout is the setting too; for a group or a selection, it is used once.
 */
export function arrangePetals(targetOf: (ctx: CommandContext) => ArrangeTarget | null): (ctx: CommandContext) => RingSlot[] {
  return () => {
    const names = messages(shellMessages).settings.arrangeLayouts;
    const saved = (layout: ArrangeLayout) => arrangeLayoutStore.getState().layout === layout;
    return ARRANGE_LAYOUTS.map(
      (layout): RingSlot => ({
        command: petal(`radial.arrange.${layout}`, names[layout], (ctx) => {
          const target = targetOf(ctx);
          if (ctx.workspaceId && target) arrangeAs(ctx.workspaceId, target, layout);
        }),
        short: () => names[layout],
        icon: LAYOUT_ICONS[layout],
        marked: () => saved(layout),
        note: () => (saved(layout) ? messages(radialMessages).savedLayout : null),
      }),
    );
  };
}

/** Where an Other agent's arc starts: wait for the first look at this machine's agents, and look again (an install since shows up). */
export function lookForAgents(): { ready: boolean; done: Promise<unknown> } {
  const ready = agentsStore.getState().loaded;
  return { ready, done: agentsStore.getState().load().catch(() => undefined) };
}

/**
 * The arc of the canvas ring's Other agent: the agents its list offers (src/agents/otherAgents.ts), in the same order,
 * the default agent marked, each started at the ring's press point by the list's own routine. Where no agent of a
 * program was found, a greyed wedge says so first, with where to install one; it stands alone when the look found
 * nothing at all.
 */
export function agentPetals(): RingSlot[] {
  const { agents } = agentsStore.getState();
  const listed = otherAgentsOf(agents ?? []);
  const fallback = defaultAgent(agents ?? []);
  const text = messages(agentsMessages);
  const petals = listed.map(
    (id): RingSlot => ({
      command: petal(`radial.other.${id}`, AGENTS[id].label, (ctx) => launchOtherAgent(id, ctx.at)),
      // As on the ring's launches: the first word of its name ("Qwen Code" → "Qwen").
      short: () => AGENTS[id].label.split(" ")[0],
      icon: AGENTS[id].Icon,
      marked: () => id === fallback,
      note: () => (DELETES_NOT_BLOCKED.has(id) ? text.agentMenu.deletesNotBlocked : id === fallback ? messages(radialMessages).defaultAgent : null),
    }),
  );
  if (!noAgentFound(listed)) return petals;
  const none: RingSlot = {
    command: petal("radial.other.none", text.otherAgentMenu.empty, () => undefined, () => text.otherAgentMenu.emptyHint),
    short: "noAgent",
    icon: SearchX,
  };
  return [none, ...petals];
}
