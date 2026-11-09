import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMessages } from "@/i18n";
import { removeNodes } from "@/fleet/terminals";
import { useActivity } from "@/store/agentActivity";
import { nodeNameOf, useNodes } from "@/store/nodes";
import { uiStore, useUi } from "@/store/ui";
import { shellMessages } from "./messages";

const buttonBase =
  "rounded-md transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out motion-reduce:transition-none active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50";

/**
 * "Close Isis?" before closing a running agent (spec habillage §7.5), or
 * "Close 2 agents?" when an undo or Delete took several at once (retours J8b).
 * An orchestrator in mission says what its closing leaves behind (spec
 * première version §5.4).
 */
export function CloseAgentDialog() {
  const t = useMessages(shellMessages).closeAgent;
  const closing = useUi((s) => s.closing);
  const nodes = useNodes((s) => s.nodes);
  const activity = useActivity(closing?.agents[0] ?? "")?.activity;
  const names = (closing?.agents ?? []).map((id) => nodeNameOf(nodes[id]) || "Agent");
  const close = () => uiStore.getState().setClosing(null);
  const one = names.length <= 1;
  const name = names[0] ?? t.fallbackName;
  const first = closing?.agents[0] ? nodes[closing.agents[0]] : undefined;
  const orchestrator = one && first?.kind === "orchestrator";
  const inMission = orchestrator && first.payload.mission?.state === "en_cours";
  // Spec habillage §7.5: "is working" or "is ready", by what the agent is doing.
  const state = activity === "working" ? "Working" : activity === "idle" ? "Ready" : null;
  const description = !one
    ? t.several(names)
    : inMission
      ? t.inMission(name)
      : orchestrator
        ? state ? t[`orchestrator${state}`](name) : t.orchestrator(name)
        : state ? t[`agent${state}`](name) : t.agent(name);

  return (
    <Dialog open={closing !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false} className="rounded-xl bg-dp-surface text-dp-text ring-dp-line sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{one ? t.titleOne(name) : t.titleMany(names.length)}</DialogTitle>
          <DialogDescription className="text-dp-text-2">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="border-dp-line bg-dp-hover">
          <Button
            variant="ghost"
            onClick={close}
            className={cn(buttonBase, "text-dp-text-2 hover:bg-dp-hover hover:text-dp-text")}
          >
            {t.cancel}
          </Button>
          <Button
            className={cn(buttonBase, "bg-dp-danger/10 text-dp-danger hover:bg-dp-danger/20")}
            onClick={() => {
              if (closing) removeNodes(closing.remove);
              close();
            }}
          >
            {orchestrator ? t.confirmOrchestrator : one ? t.confirmOne : t.confirmMany}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
