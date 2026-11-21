import { toast } from "sonner";
import { canvasStore } from "@/canvas/canvasStore";
import { showDecisionToast, type Decision } from "@/shell/DecisionToast";
import { BOTTOM_BAR_HEIGHT, TOP_ROW_HEIGHT } from "@/shell/layout";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";

/**
 * The toasts a mission leaves on screen until they are dealt with (`duration: Infinity`): a question to the user
 * (Land, Clean up leftovers) and the outcome of a clean-up that kept something. Nothing ends them by itself, so each
 * one is tied to the thing it speaks of, and goes when that does:
 *
 * - A question follows the state that holds it (`trackQuestionToast`): the mission's `landing`, the leftovers' ask. The
 *   user's click answers it, but so can anything else: the mission cleaned up, its Fleet deleted or closed, a new
 *   read that finds nothing left. The toast goes at the first change of the stores, whoever made it.
 * - A question has one home, the Fleet's panel (`askInToast`): the toast asks it too only while the Fleet is out of
 *   sight, and goes once the Fleet comes into view, where the panel asks it.
 * - An outcome keeps one toast per subject (`showOutcomeToast`): a repeat replaces it in place, so a clean-up that
 *   runs again never stacks another one on the screen.
 */

/** The question toasts on screen, by toast id: whether the question each shows still stands. */
const questions = new Map<string, () => boolean>();
let watching = false;

/** Takes off the screen every question toast whose question no longer stands. Safe to call at any time. */
export function sweepQuestionToasts(): void {
  for (const [id, stands] of questions) {
    // It runs inside a store's update, like `installCloseWatch`: a failing check leaves that toast and never throws.
    try {
      if (stands()) continue;
      questions.delete(id);
      toast.dismiss(id);
    } catch (error) {
      console.warn("question toast not checked", error);
    }
  }
}

/**
 * The toast `id` asks a question while `stands()` holds, true for as long as the stores still hold it. Call it
 * before the state that makes it stand changes, so a toast being replaced by a newer question (same id) is never
 * taken for a moot one. A newer registration of the same id replaces the older.
 */
export function trackQuestionToast(id: string, stands: () => boolean): void {
  questions.set(id, stands);
  if (watching) return;
  watching = true;
  // The nodes carry the missions and the Fleets; a node closed from the canvas only drops its terminal status. The
  // view, the workspace and the project on screen say whether a Fleet asking in a toast came into sight.
  nodesStore.subscribe(sweepQuestionToasts);
  terminalStatusStore.subscribe(sweepQuestionToasts);
  canvasStore.subscribe(sweepQuestionToasts);
  workspacesStore.subscribe(sweepQuestionToasts);
  projectsStore.subscribe(sweepQuestionToasts);
}

/**
 * The room a question takes at the foot of a Fleet, in scene px: the prompt (its title, its lines, its commits or
 * worktrees, its answers) and the mission's actions under it (`MissionPanel`, which pins them to the node's bottom).
 */
const QUESTION_ROOM = 220;

/**
 * The foot of the Fleet shows whole in the usable band of the view, between the bars, at the zoom the view has: where
 * its panel asks, its answers at the bottom right. Some of the Fleet showing is not enough: its top half in view hides
 * the question.
 */
function footInSight(fleetId: string): boolean {
  const api = canvasStore.getState().api;
  const element = api?.getSceneElements().find((e) => e.id === fleetId && !e.isDeleted);
  if (!api || !element) return false;
  const { scrollX, scrollY, zoom, width, height } = api.getAppState();
  const left = (element.x + scrollX) * zoom.value;
  const right = (element.x + element.width + scrollX) * zoom.value;
  const bottom = (element.y + element.height + scrollY) * zoom.value;
  const top = bottom - Math.min(element.height, QUESTION_ROOM) * zoom.value;
  return left >= 0 && right <= width && top >= TOP_ROW_HEIGHT && bottom <= height - BOTTOM_BAR_HEIGHT;
}

/**
 * The user sees the Fleet's question where its panel asks it: its project's canvas is on screen, on the Fleet's
 * workspace, and the view shows the Fleet's foot (the finish alert's "looking at", `shell/finishAlert.ts`, made strict:
 * a Fleet partly in view may hide the question).
 */
export function fleetInSight(fleetId: string): boolean {
  const record = nodesStore.getState().nodes[fleetId];
  if (!record || projectsStore.getState().view !== "project" || record.workspaceId !== workspacesStore.getState().activeId) return false;
  return footInSight(fleetId);
}

/**
 * One home per question: the Fleet's panel asks it, always. The toast `id` asks it as well only while the Fleet is out
 * of sight, and leads with the answer that acts (`showDecisionToast`); it goes when the question no longer `stands()`,
 * or when the Fleet comes into view, where the panel asks the same. A Fleet in sight gets no toast, and one an earlier
 * question left goes. Call it before the state that makes the question stand changes, as `trackQuestionToast`.
 */
export function askInToast(id: string, fleetId: string, stands: () => boolean, decision: Decision): void {
  if (fleetInSight(fleetId)) {
    questions.delete(id);
    toast.dismiss(id);
    return;
  }
  trackQuestionToast(id, () => stands() && !fleetInSight(fleetId));
  showDecisionToast(id, decision);
}

/**
 * The outcome of a clean-up as a toast of its own, `id` naming what it is about: a repeat replaces it. `stays` keeps it
 * on screen with its close button until dismissed (something was kept, and the user is told which and why). Sonner merges
 * a toast's options into the one it replaces, so the options of an outcome that stays are overridden, not just left out.
 */
export function showOutcomeToast(id: string, title: string, description: string, stays: boolean): void {
  toast.success(title, { id, description, duration: stays ? Infinity : undefined, closeButton: stays ? true : undefined });
}
