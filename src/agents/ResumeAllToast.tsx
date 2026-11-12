import { useEffect } from "react";
import { History, X } from "lucide-react";
import { toast } from "sonner";
import { canvasStore } from "@/canvas/canvasStore";
import { Button } from "@/components/ui/button";
import { AccentButton, IconButton } from "@/shell/buttons";
import { liveNodeIds } from "@/canvas/sceneSync";
import { createStore, useStore } from "zustand";
import { isLiveInRust, resumeTerminal } from "@/nodes/terminal/registry";
import { nodesStore, useNodes, type NodeRecord } from "@/store/nodes";
import { terminalStatusStore, type TerminalStatus } from "@/store/terminalStatus";
import { useMessages } from "@/i18n";
import { agentsMessages } from "./messages";
import { workspaceResumeOffer, type ResumeOffer } from "./resumable";

/**
 * The offer sits bottom-right, where the agents panel may reach: the panel stops above it. `leftOut`: it has the
 * line naming the finished sub-agents it leaves stopped.
 */
export const resumeOfferStore = createStore<{ open: boolean; leftOut?: boolean }>()(() => ({ open: false }));
/** The room the offer takes from the window's bottom edge, in px (zoom control, margin, the toast). */
export const RESUME_OFFER_ROOM = 170;
/** The height of the line naming the finished sub-agents left stopped (12 px text, its 16 px line). */
export const RESUME_OFFER_LINE = 16;

/** The room the agents panel leaves the offer, null without one. */
export const resumeOfferRoom = (state: { open: boolean; leftOut?: boolean }): number | null =>
  state.open ? RESUME_OFFER_ROOM + (state.leftOut ? RESUME_OFFER_LINE : 0) : null;

/** Workspaces whose offer was answered: it does not come back before the next launch. */
const answered = new Set<string>();
const toastId = (workspaceId: string) => `resume-all-${workspaceId}`;
const RELAUNCH_STAGGER_MS = 300;

function liveSet(ids: string[]): Set<string> {
  return new Set(ids.filter(isLiveInRust));
}

/** Terminals on the canvas on screen; closed ones are kept in memory for undo. */
function sceneSet(): Set<string> {
  return new Set(liveNodeIds(canvasStore.getState().api?.getSceneElements() ?? []));
}

/** The workspace's offer as things stand: what it resumes, and the finished sub-agents it leaves stopped. */
function offerOf(nodes: Record<string, NodeRecord>, statuses: Record<string, TerminalStatus>, workspaceId: string): ResumeOffer {
  return workspaceResumeOffer(nodes, statuses, workspaceId, liveSet(Object.keys(nodes)), sceneSet());
}

function ResumeAllToast({ workspaceId }: { workspaceId: string }) {
  const t = useMessages(agentsMessages).resumeAll;
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const { resume: ids, stayStopped } = offerOf(nodes, statuses, workspaceId);
  const leftOut = stayStopped.length;

  useEffect(() => {
    if (ids.length === 0) {
      toast.dismiss(toastId(workspaceId));
      resumeOfferStore.setState({ open: false });
    }
  }, [ids.length, workspaceId]);
  useEffect(() => {
    if (resumeOfferStore.getState().open) resumeOfferStore.setState({ leftOut: leftOut > 0 });
  }, [leftOut]);

  const answer = () => {
    answered.add(workspaceId);
    toast.dismiss(toastId(workspaceId));
    resumeOfferStore.setState({ open: false });
  };
  const resumeAll = () => {
    answer();
    ids.forEach((id, i) => setTimeout(() => resumeTerminal(id), i * RELAUNCH_STAGGER_MS));
  };

  return (
    <div className="dp-glass-strong flex w-90 items-start gap-3 rounded-lg p-4 text-dp-text">
      <History className="mt-0.5 size-4 shrink-0 text-dp-text-2" />
      <div className="min-w-0 flex-1">
        {/* The toasts' type (components/ui/sonner.tsx, TOAST_CLASSES): the UI step for the title, 12 px a step quieter under it. */}
        <p className="text-(length:--text-ui) font-medium">{t.title}</p>
        <p className="text-xs text-dp-text-2">{t.body(ids.length)}</p>
        {/* Finished sub-agents stay on their saved screen: said, so the user knows why they were not counted. */}
        {leftOut > 0 && <p className="text-xs text-dp-text-2">{t.stayStopped(leftOut)}</p>}
        <div className="mt-3 flex gap-2">
          <AccentButton size="sm" onClick={resumeAll}>
            {t.yes}
          </AccentButton>
          <Button type="button" variant="ghost" size="sm" className="text-dp-text-2 hover:text-dp-text" onClick={answer}>
            {t.no}
          </Button>
        </div>
      </div>
      <IconButton label={t.close} className="-mt-1.5 -mr-1.5" onClick={answer}>
        <X />
      </IconButton>
    </div>
  );
}

/** Offers to resume the stopped terminals of a workspace; finished sub-agents stay stopped (`isFinishedSubAgent`). */
export function offerResumeAll(workspaceId: string) {
  if (answered.has(workspaceId)) return;
  const offer = offerOf(nodesStore.getState().nodes, terminalStatusStore.getState().statuses, workspaceId);
  if (offer.resume.length === 0) return;
  resumeOfferStore.setState({ open: true, leftOut: offer.stayStopped.length > 0 });
  toast.custom(() => <ResumeAllToast workspaceId={workspaceId} />, {
    id: toastId(workspaceId),
    duration: Infinity,
  });
}

/** Leaving the workspace hides the offer without answering it. */
export function dismissResumeOffer(workspaceId: string) {
  toast.dismiss(toastId(workspaceId));
  resumeOfferStore.setState({ open: false });
}
