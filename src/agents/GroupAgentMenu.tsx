import { useState } from "react";
import { useUiRequest } from "@/commands/uiRequests";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useMessages } from "@/i18n";
import { toastError } from "@/lib/errorToast";
import type { AgentId } from "@/ipc/pty";
import { agentsStore, isAvailable, loadedAgents, useAgents } from "./agentsStore";
import { AgentPickRows } from "./AgentPickRows";
import { AGENTS, AGENTS_WITHOUT_OPTIONS, defaultAgent } from "./catalog";
import { agentsMessages } from "./messages";
import { addAgentToGroup } from "./groups";
import { PointMenu } from "./PointMenu";
import type { Point } from "./terminals";

interface Asked {
  /** The group the agent picked starts in. */
  id: string;
  /** The point of the window the list hangs from. */
  at: Point;
}

/**
 * The list of agents a group's "Add an agent" offers (the group ring's wedge, the palette's Add an agent…), at the point asked
 * for, in the same menu as "Other agent…" (./OtherAgentMenu.tsx) and the layouts of "Arrange as…" (./PointMenu.tsx): the
 * agents found on this machine, the Shell with them, and no more (an agent that is not installed is not listed; a Custom
 * command and Ollama, which need a command or a model first, are the ＋ menu's). The default agent, the one of "New console",
 * is ticked and under the keyboard first. Up and Down move, Enter or a click starts the agent in the group's next free cell
 * (./groups.ts addAgentToGroup), Escape closes and starts nothing. It answers by itself, mounted once in the app: the group
 * need not be listed in the Agents panel, nor the panel open.
 */
export function GroupAgentMenu() {
  const text = useMessages(agentsMessages);
  const agents = useAgents((s) => s.agents);
  const [asked, setAsked] = useState<Asked | null>(null);

  useUiRequest("groupAgentMenu", (request) => {
    const ask = () => setAsked({ id: request.id, at: request.at });
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

  const listed = AGENTS_WITHOUT_OPTIONS.filter((id) => isAvailable(agents, id));

  const pick = (agent: AgentId) => {
    const group = asked?.id;
    setAsked(null);
    if (group) void addAgentToGroup(group, agent).catch((error: unknown) => toastError(text.launchFailed, { error, next: text.launchNext }));
  };

  // No agent of a program was found: all there is to add is a Shell, with nothing to say where to get the others.
  const none = listed.every((id) => AGENTS[id].binary === "");

  return (
    <PointMenu at={asked?.at ?? null} label={text.groupAgentMenu.label} onClose={() => setAsked(null)} className="w-60 p-1" anchorProps={{ "data-group-agent-anchor": "" }}>
      {none && (
        <div data-group-agent-empty className="px-2 py-1.5 text-(length:--text-ui)">
          <p className="text-dp-text">{text.otherAgentMenu.empty}</p>
          <p className="text-xs text-dp-text-2">{text.otherAgentMenu.emptyHint}</p>
        </div>
      )}
      {none && listed.length > 0 && <DropdownMenuSeparator />}
      {listed.length > 0 && <AgentPickRows ids={listed} selected={defaultAgent(agents)} onPick={pick} />}
    </PointMenu>
  );
}
