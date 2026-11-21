import { useState } from "react";
import { requestUi, useUiRequest } from "@/commands/uiRequests";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useMessages } from "@/i18n";
import type { AgentId } from "@/ipc/pty";
import { uiStore } from "@/store/ui";
import { AgentPickRows } from "./AgentPickRows";
import { agentsStore, isAvailable, loadedAgents, useAgents } from "./agentsStore";
import { AGENT_ORDER, AGENTS, defaultAgent } from "./catalog";
import { defaultLaunchOptions } from "./launchAgent";
import { agentsMessages } from "./messages";
import { PointMenu } from "./PointMenu";
import { launchAt } from "./quickActions";
import type { Point } from "./terminals";

interface Asked {
  /** The point of the window the list hangs from. */
  at: Point;
  /** The scene point the picked agent starts at; none from the palette, where it follows the pointer until a click places it. */
  place?: Point;
}

/**
 * The list of agents an "Other agent…" offers (the canvas ring's wedge and the palette's), at the point asked for, in the
 * same menu as the layouts of "Arrange as…" (./PointMenu.tsx): the agents found on this machine, and no more (an agent
 * that is not installed is not listed: the ＋ menu and the palette's "Install …" offer it). The default agent, the one of
 * "New console", is ticked and under the keyboard first. Up and Down move, Enter or a click launches the agent where the
 * ring was pressed, Escape closes and starts nothing. The Shell is the ring's and the palette's own; a Custom command and
 * Ollama, which need a command or a model first, go on in the ＋ menu's own view for them. On a machine where no agent's
 * program was found (the Custom command is all there is) a notice says so above it; where the look found nothing at all
 * or failed, the notice stands alone.
 */
export function OtherAgentMenu() {
  const text = useMessages(agentsMessages);
  const t = text.otherAgentMenu;
  const agents = useAgents((s) => s.agents);
  const [asked, setAsked] = useState<Asked | null>(null);

  useUiRequest("otherAgentMenu", (request) => {
    const ask = () => setAsked({ at: request.at, place: request.place });
    if (agentsStore.getState().loaded) {
      ask();
      // An agent installed since the last look shows up: the list follows the store.
      void agentsStore.getState().load().catch(() => undefined);
    } else {
      // Nothing is known yet, not even what is missing: the list opens on what the first look finds.
      void loadedAgents().then(ask);
    }
    return true;
  });

  const listed = AGENT_ORDER.filter((id) => id !== "shell" && isAvailable(agents, id));
  const fallback = defaultAgent(agents);

  const pick = (agent: AgentId) => {
    const place = asked?.place;
    setAsked(null);
    // Their form or their models first, in the ＋ menu's view for them (what the palette's custom agent and Ollama open).
    if (agent === "custom" || agent === "ollama") requestUi({ kind: "agentMenu", view: agent === "custom" ? "options" : "ollama", at: place });
    else if (place) launchAt(agent, place);
    // From the palette: the agent follows the pointer until the canvas is clicked.
    else uiStore.getState().setPlacing({ agent, options: defaultLaunchOptions() });
  };

  // No agent of a program was found: a machine with no CLI still has its Shell and a Custom command (always "available"),
  // and that is all this list would hold, with nothing to say where to get the others.
  const none = listed.every((id) => AGENTS[id].binary === "");

  return (
    <PointMenu at={asked?.at ?? null} label={t.label} onClose={() => setAsked(null)} className="w-60 p-1" anchorProps={{ "data-other-agent-anchor": "" }}>
      {none && (
        <div data-other-agent-empty className="px-2 py-1.5 text-(length:--text-ui)">
          <p className="text-dp-text">{t.empty}</p>
          <p className="text-xs text-dp-text-2">{t.emptyHint}</p>
        </div>
      )}
      {none && listed.length > 0 && <DropdownMenuSeparator />}
      {listed.length > 0 && <AgentPickRows ids={listed} selected={fallback} onPick={pick} />}
    </PointMenu>
  );
}
