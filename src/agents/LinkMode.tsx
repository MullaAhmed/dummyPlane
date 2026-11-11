import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import type { SceneFrame } from "@/canvas/groups";
import { findTerminalAt } from "@/canvas/hitTest";
import { nodeKindOf } from "@/canvas/nodeElement";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { TOP_ROW_HEIGHT } from "@/shell/layout";
import { nodesStore, terminalOf, useNodes } from "@/store/nodes";
import { uiStore, useUi } from "@/store/ui";
import { linkAgents, linkableAgent } from "./agentLinks";
import { AGENTS } from "./catalog";
import { agentsMessages } from "./messages";
import { finishButtonAt, forwardWheel } from "./linkOverlay";
import { linkFleet } from "@/fleet/fleets";
import { clientRectOf, sceneOf } from "./placement";
import type { Point } from "./terminals";
import { agentLinksOf, fleetsOf, linkTargetAt, fleetAt, NO_LINKS, type Links } from "./wires";

/** What the link mode can wire, as the list under its hint names it. */
interface Candidate {
  id: string;
  name: string;
  kind: "agent" | "group" | "fleet";
  /** Already wired: picking it again would add nothing. */
  linked: boolean;
  /** Where it is on the scene, to order the list as the canvas reads and to outline the one picked. */
  rect: { x: number; y: number; width: number; height: number };
}

const live = (e: ExcalidrawElement) => !e.isDeleted;

function agentName(id: string): string {
  const payload = terminalOf(nodesStore.getState().nodes[id]);
  return payload ? payload.name || AGENTS[payload.agent].label : id;
}

function fleetName(id: string): string {
  const record = nodesStore.getState().nodes[id];
  return record?.kind === "fleet" ? record.payload.name : id;
}

/**
 * The targets a click could designate, the same rules as `targetAt`. From a fleet: every group,
 * and every terminal outside one (a grouped terminal designates its group). From an agent: the
 * fleets, and the other agents that take instructions (not itself, not a plain shell).
 */
function candidatesFor(linking: string, fromAgent: boolean, elements: readonly ExcalidrawElement[], frames: readonly SceneFrame[], links: Readonly<Record<string, Links>>): Candidate[] {
  const list: Candidate[] = [];
  if (!fromAgent) {
    const wired = links[linking] ?? NO_LINKS;
    for (const frame of frames) {
      if (frame.group) list.push({ id: frame.id, name: frame.name, kind: "group", linked: wired.groupIds.includes(frame.id), rect: frame });
    }
    for (const e of elements) {
      if (!live(e) || nodeKindOf(e) !== "terminal" || frames.some((f) => f.group && f.memberIds.includes(e.id))) continue;
      list.push({ id: e.id, name: agentName(e.id), kind: "agent", linked: wired.nodeIds.includes(e.id), rect: e });
    }
  } else {
    const commanding = fleetsOf(linking, links, frames);
    const peers = agentLinksOf(elements, linking).map((l) => l.peerId);
    for (const e of elements) {
      if (!live(e)) continue;
      const kind = nodeKindOf(e);
      if (kind === "fleet") list.push({ id: e.id, name: fleetName(e.id), kind: "fleet", linked: commanding.includes(e.id), rect: e });
      else if (kind === "terminal" && e.id !== linking && linkableAgent(e.id)) list.push({ id: e.id, name: agentName(e.id), kind: "agent", linked: peers.includes(e.id), rect: e });
    }
  }
  // As the canvas reads: top to bottom, then left to right.
  return list.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}

/** The Link button of the node that is linking: where the keyboard goes back when the mode ends from the list. */
function linkToggleOf(id: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>("[data-link-toggle]")].find((b) => b.dataset.linkToggle === id) ?? null;
}

/**
 * "Link" (spec theme §13): each click wires a group or a terminal; Escape or a click in the void ends it.
 * Started from an agent's foot, it runs the other way: a click on a fleet wires the agent to it,
 * the same wire as from the fleet's end; a click on another agent links the two (agents/agentLinks.ts).
 * Either way the mode ends.
 *
 * The keyboard does the same through the list under the hint (WCAG 2.1.1): it takes the focus,
 * the arrows (and Tab) move through the targets, outlined on the canvas, Enter links, Escape ends.
 */
export function LinkMode() {
  const t = useMessages(agentsMessages);
  const linking = useUi((s) => s.linking);
  const fromAgent = useNodes((s) => (linking ? s.nodes[linking]?.kind === "terminal" : false));
  const view = useCanvas((s) => s.view);
  const frames = useCanvas((s) => s.frames);
  const links = useCanvas((s) => s.links);
  const [pointer, setPointer] = useState<Point | null>(null);
  // The target the keyboard is on (-1: none yet, the list itself has the focus).
  const [active, setActive] = useState(-1);
  const list = useRef<HTMLDivElement>(null);
  // What had the keyboard before the list took it.
  const before = useRef<HTMLElement | null>(null);
  const ids = useId();

  const elements = linking ? (canvasStore.getState().api?.getSceneElements() ?? []) : [];
  const candidates = linking ? candidatesFor(linking, fromAgent, elements, frames, links) : [];
  const hasCandidates = candidates.length > 0;

  /** The keyboard goes back to the linker's own Link button, else to what had it, when the list had it. */
  const giveBackFocus = () => {
    if (!linking || !list.current?.contains(document.activeElement)) return;
    const back = linkToggleOf(linking) ?? (before.current?.isConnected ? before.current : null);
    back?.focus();
  };

  useEffect(() => {
    setActive(-1);
    if (!linking || !hasCandidates) return;
    before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    list.current?.focus();
    // Only when the mode starts: a wire added from the list keeps the focus where it is.
  }, [linking]);

  useEffect(() => {
    if (!linking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!e.shiftKey) giveBackFocus();
      uiStore.getState().setLinking(null);
    };
    // Captured: the Link button keeps the focus after its click, and the foot it sits in stops every key
    // on its way up (useNativeKeyDown), so Escape would never bubble here.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [linking]);

  if (!linking) return null;
  const targetAt = (client: Point) => {
    const point = sceneOf(client, view);
    if (!fromAgent) return linkTargetAt(elements, frames, point);
    // From an agent: a fleet, else another agent (itself and a plain shell designate nothing).
    const fleet = fleetAt(elements, point);
    if (fleet) return fleet;
    const terminal = findTerminalAt(elements, point.x, point.y);
    return terminal && terminal.id !== linking && linkableAgent(terminal.id) ? terminal.id : null;
  };
  const hovered = pointer ? targetAt(pointer) : null;
  const picked = candidates[active];
  // The pointer's target, else the one the keyboard is on.
  const outlined = hovered ?? picked?.id ?? null;
  const rect = outlined ? (frames.find((f) => f.id === outlined) ?? elements.find((e) => e.id === outlined)) : undefined;

  const link = (target: string) => {
    if (!fromAgent) return linkFleet(linking, target);
    const element = elements.find((e) => e.id === target);
    const fleet = element !== undefined && nodeKindOf(element) === "fleet";
    // A fleet that already commands the agent, through its group too, gets no second wire.
    if (!fleet) linkAgents(linking, target);
    else if (!fleetsOf(linking, links, frames).includes(target)) linkFleet(target, linking);
    uiStore.getState().setLinking(null);
  };

  /** A target picked in the list: wired; from an agent the mode ends, and the keyboard goes back to its Link. */
  const pick = (candidate: Candidate | undefined) => {
    if (!candidate || candidate.linked) return;
    if (fromAgent) giveBackFocus();
    link(candidate.id);
  };

  const move = (to: number) => {
    const count = candidates.length;
    const next = ((to % count) + count) % count;
    setActive(next);
    document.getElementById(`${ids}-${next}`)?.scrollIntoView?.({ block: "nearest" });
  };

  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const last = candidates.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(active + 1),
      ArrowUp: () => move(active < 0 ? last : active - 1),
      Home: () => move(0),
      End: () => move(last),
      // The mode covers the canvas: Tab walks the targets rather than leaving them.
      Tab: () => move(e.shiftKey ? (active < 0 ? last : active - 1) : active + 1),
      Enter: () => pick(picked),
      " ": () => pick(picked),
    };
    const run = keys[e.key];
    if (!run || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    run();
  };

  const hintId = `${ids}-hint`;
  return (
    <>
      <div
        // Starts under the bars: the title bar's buttons and drag area keep working while placing or linking.
        className="fixed inset-x-0 bottom-0 z-40 cursor-crosshair"
        style={{ top: TOP_ROW_HEIGHT }}
        onPointerMove={(e) => setPointer({ x: e.clientX, y: e.clientY })}
        onWheel={forwardWheel}
        onContextMenu={(e) => {
          e.preventDefault();
          uiStore.getState().setLinking(null);
        }}
        onClick={(e) => {
          // The layer covers the linker's own "Done": the click goes on to it. Another node's Link is
          // only a place on that node: from an agent's end, the fleet's "+ Link" designates it.
          const finish = finishButtonAt(e.clientX, e.clientY);
          if (finish && finish.getAttribute("data-link-toggle") === linking) return finish.click();
          const target = targetAt({ x: e.clientX, y: e.clientY });
          if (target) link(target);
          else uiStore.getState().setLinking(null);
        }}
      >
        {rect && (
          <div
            className="pointer-events-none fixed rounded-lg border-2 border-dashed border-dp-accent/80 bg-dp-accent/5"
            style={clientRectOf(rect, view)}
          />
        )}
      </div>
      {/* Beside the layer, not in it: a click in the list is no click on the canvas. The hint lets the pointer through, as before. */}
      <div
        data-link-targets
        className="dp-glass-strong pointer-events-none fixed left-1/2 z-40 w-72 -translate-x-1/2 rounded-lg p-1 text-xs text-dp-text-2"
        style={{ top: TOP_ROW_HEIGHT + 14 }}
      >
        <p id={hintId} className="px-2 py-1">
          {fromAgent ? t.link.agentHint : t.link.hint}
        </p>
        {hasCandidates && (
          <div
            ref={list}
            role="listbox"
            tabIndex={0}
            aria-labelledby={hintId}
            aria-activedescendant={picked ? `${ids}-${active}` : undefined}
            onKeyDown={onListKey}
            onPointerEnter={() => setPointer(null)}
            className={cn("pointer-events-auto max-h-64 overflow-y-auto rounded-md outline-none", active < 0 && "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dp-accent/70")}
          >
            {candidates.map((candidate, index) => (
              // The fill and the ring snap: the arrows move them.
              <div
                key={candidate.id}
                id={`${ids}-${index}`}
                role="option"
                aria-selected={index === active}
                aria-disabled={candidate.linked || undefined}
                data-active={index === active || undefined}
                onPointerMove={() => index !== active && setActive(index)}
                onClick={() => pick(candidate)}
                className="flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-(length:--text-ui) text-dp-text-2 data-active:bg-dp-hover data-active:text-dp-text data-active:ring-1 data-active:ring-dp-accent/70 data-active:ring-inset"
              >
                <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                <span className="shrink-0 text-xs text-dp-text-3">{candidate.linked ? t.link.linked : t.link.kinds[candidate.kind]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
