import { useState } from "react";
import { OptionItem, OptionList } from "@/components/OptionList";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AGENTS } from "@/agents/catalog";
import { useAgents } from "@/agents/agentsStore";
import { useMessages } from "@/i18n";
import type { AgentId } from "@/ipc/pty";
import { AccentButton, QuietButton } from "@/shell/buttons";
import { answerFleetAgent, FLEET_CANDIDATES, fleetAgent, useFleetAgent, whyNot } from "./fleetAgent";
import { fleetMessages } from "./messages";

/** "Agent for the Fleet": the CLIs installed and those that are not, each with whether it can carry a Fleet, and why not. */
export function FleetAgentDialog() {
  const asking = useFleetAgent((s) => s.asking !== null);
  return asking ? <Choice /> : null;
}

function Choice() {
  const t = useMessages(fleetMessages).agent;
  const agents = useAgents((s) => s.agents);
  const installed = (id: AgentId) => agents.some((info) => info.id === id && info.available);
  const usable = (id: AgentId) => installed(id) && whyNot(id) === null;
  const [picked, setPicked] = useState<AgentId>(() => fleetAgent());
  const help = (id: AgentId) => {
    const why = whyNot(id);
    if (!installed(id)) return why ? t.missingWhy : t.missing;
    return why ? t.why[why] : t.installed;
  };
  return (
    <Dialog open onOpenChange={(open) => !open && answerFleetAgent(null)}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <OptionList label={t.label} value={picked} onValueChange={setPicked} className="-mx-2 w-auto">
          {FLEET_CANDIDATES.map((id) => (
            <OptionItem key={id} value={id} label={AGENTS[id].label} help={help(id)} disabled={!usable(id)} />
          ))}
        </OptionList>
        <DialogFooter>
          <QuietButton onClick={() => answerFleetAgent(null)}>{t.cancel}</QuietButton>
          <AccentButton size="lg" disabled={!usable(picked)} onClick={() => answerFleetAgent(picked)}>
            {t.use(AGENTS[picked].label)}
          </AccentButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
