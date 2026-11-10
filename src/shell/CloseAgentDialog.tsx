import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useMessages } from "@/i18n";
import { removeNodes } from "@/agents/terminals";
import { useActivity } from "@/store/agentActivity";
import { nodeNameOf, useNodes } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { uiStore, useUi, type ClosingAgents } from "@/store/ui";
import { QuietButton } from "./buttons";
import { shellMessages } from "./messages";

/**
 * "Close Batman?" before closing a running agent (spec habillage §7.5), or
 * "Close 2 agents?" when an undo or Delete took several at once (retours J8b).
 * A fleet in mission says what its closing leaves behind (spec
 * première version §5.4). An agent that opened sub-agents (spawn_agent) offers
 * to close them too, ticked by default.
 */
export function CloseAgentDialog() {
  const closing = useUi((s) => s.closing);
  // Keyed by the closing: each request starts with "Also close" ticked.
  return <CloseAgentContent key={closing ? closing.agents.join() : ""} closing={closing} />;
}

function CloseAgentContent({ closing }: { closing: ClosingAgents | null }) {
  const all = useMessages(shellMessages);
  const t = all.closeAgent;
  const alsoId = useId();
  const [withChildren, setWithChildren] = useState(true);
  const nodes = useNodes((s) => s.nodes);
  const activity = useActivity(closing?.agents[0] ?? "")?.activity;
  const names = (closing?.agents ?? []).map((id) => nodeNameOf(nodes[id]) || all.fallbackAgent);
  const close = () => uiStore.getState().setClosing(null);
  const one = names.length <= 1;
  const name = names[0] ?? t.fallbackName;
  const first = closing?.agents[0] ? nodes[closing.agents[0]] : undefined;
  const fleet = one && first?.kind === "fleet";
  const inMission = fleet && first.payload.mission?.state === "en_cours";
  // Spec habillage §7.5: "is working" or "is ready", by what the agent is doing.
  const state = activity === "working" ? "Working" : activity === "idle" ? "Ready" : null;
  const children = closing?.children ?? [];
  // Asked for its sub-agents only: the agent itself has stopped.
  const stopped = one && children.length > 0 && closing !== null && !isRunning(closing.agents[0]);
  const description = !one
    ? t.several(names)
    : inMission
      ? t.inMission(name)
      : stopped
        ? t.stopped(name)
        : fleet
          ? state ? t[`fleet${state}`](name) : t.fleet(name)
          : state ? t[`agent${state}`](name) : t.agent(name);
  const confirm = () => {
    if (!closing) return;
    const leaving = withChildren ? [...closing.remove, ...children] : closing.remove;
    // The canvas reflows the trees of the spawned agents that leave.
    removeNodes(leaving);
  };

  return (
    <Dialog open={closing !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{one ? t.titleOne(name) : t.titleMany(names.length)}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children.length > 0 && (
          <div className="flex items-start gap-2">
            <Checkbox
              id={alsoId}
              className="mt-0.5"
              checked={withChildren}
              onCheckedChange={(checked) => setWithChildren(checked === true)}
            />
            <Label htmlFor={alsoId} className="block text-sm font-normal leading-5 text-dp-text-2">
              {t.alsoChildren(children.map((id) => nodeNameOf(nodes[id]) || all.fallbackAgent))}
            </Label>
          </div>
        )}
        <DialogFooter>
          <QuietButton onClick={close}>{t.cancel}</QuietButton>
          <Button
            variant="destructive"
            size="lg"
            onClick={() => {
              confirm();
              close();
            }}
          >
            {fleet ? t.confirmFleet : one ? t.confirmOne : t.confirmMany}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
