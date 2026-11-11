import { useId, useRef, useState } from "react";
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
import { useExitSnapshot } from "@/lib/useExitSnapshot";
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
  // The last request stays mounted while the dialog animates out: a key turning "" would cut its exit.
  const last = useRef<ClosingAgents | null>(null);
  const shown = useRef(false);
  const requests = useRef(0);
  // A new request: the dialog opens, or another closing replaces the one it shows.
  if (closing && (!shown.current || closing !== last.current)) requests.current += 1;
  shown.current = closing !== null;
  if (closing) last.current = closing;
  // Keyed by the request: each one starts with "Also close" ticked, the same agents asked twice included.
  return <CloseAgentContent key={requests.current} closing={closing ?? last.current} open={closing !== null} />;
}

function CloseAgentContent({ closing, open }: { closing: ClosingAgents | null; open: boolean }) {
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
  // The agents are gone once closed: the exit keeps the words the dialog asked with.
  const shown = useExitSnapshot(open, {
    title: one ? t.titleOne(name) : t.titleMany(names.length),
    description,
    childNames: children.map((id) => nodeNameOf(nodes[id]) || all.fallbackAgent),
    confirmLabel: fleet ? t.confirmFleet : one ? t.confirmOne : t.confirmMany,
  });
  const confirm = () => {
    if (!closing || !open) return;
    const leaving = withChildren ? [...closing.remove, ...children] : closing.remove;
    // The canvas reflows the trees of the spawned agents that leave.
    removeNodes(leaving);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{shown.title}</DialogTitle>
          <DialogDescription>{shown.description}</DialogDescription>
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
              {t.alsoChildren(shown.childNames)}
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
            {shown.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
