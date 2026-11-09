import { useState } from "react";
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
import { afterSpawnTreeChange } from "@/fleet/spawnFamily";
import { useActivity } from "@/store/agentActivity";
import { nodeNameOf, useNodes } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { uiStore, useUi, type ClosingAgents } from "@/store/ui";
import { shellMessages } from "./messages";

const buttonBase =
  "rounded-md transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out motion-reduce:transition-none active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50";

/**
 * "Close Isis?" before closing a running agent (spec habillage §7.5), or
 * "Close 2 agents?" when an undo or Delete took several at once (retours J8b).
 * An orchestrator in mission says what its closing leaves behind (spec
 * première version §5.4). An agent that opened sub-agents (spawn_agent) offers
 * to close them too, ticked by default.
 */
export function CloseAgentDialog() {
  const closing = useUi((s) => s.closing);
  // Keyed by the closing: each request starts with "Also close" ticked.
  return <CloseAgentContent key={closing ? closing.agents.join() : ""} closing={closing} />;
}

function CloseAgentContent({ closing }: { closing: ClosingAgents | null }) {
  const t = useMessages(shellMessages).closeAgent;
  const [withChildren, setWithChildren] = useState(true);
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
  const children = closing?.children ?? [];
  // Asked for its sub-agents only: the agent itself has stopped.
  const stopped = one && children.length > 0 && closing !== null && !isRunning(closing.agents[0]);
  const description = !one
    ? t.several(names)
    : inMission
      ? t.inMission(name)
      : stopped
        ? t.stopped(name)
        : orchestrator
          ? state ? t[`orchestrator${state}`](name) : t.orchestrator(name)
          : state ? t[`agent${state}`](name) : t.agent(name);
  const confirm = () => {
    if (!closing) return;
    const leaving = withChildren ? [...closing.remove, ...children] : closing.remove;
    removeNodes(leaving);
    const workspaceId = nodes[closing.agents[0]]?.workspaceId;
    if (workspaceId && (children.length > 0 || leaving.some((id) => nodes[id]?.kind === "terminal" && nodes[id].payload.spawnedBy))) {
      afterSpawnTreeChange(workspaceId, closing.agents[0]);
    }
  };

  return (
    <Dialog open={closing !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false} className="rounded-xl bg-dp-surface text-dp-text ring-dp-line sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{one ? t.titleOne(name) : t.titleMany(names.length)}</DialogTitle>
          <DialogDescription className="text-dp-text-2">{description}</DialogDescription>
        </DialogHeader>
        {children.length > 0 && (
          <label className="flex items-start gap-2 text-sm text-dp-text-2">
            <input
              type="checkbox"
              className="mt-0.5 accent-dp-accent"
              checked={withChildren}
              onChange={(event) => setWithChildren(event.target.checked)}
            />
            <span>{t.alsoChildren(children.map((id) => nodeNameOf(nodes[id]) || "Agent"))}</span>
          </label>
        )}
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
              confirm();
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
