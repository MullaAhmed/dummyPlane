import { newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { freeSpot, NODE_GAP } from "@/agents/groupLayout";
import { sceneAccess } from "@/agents/sceneAccess";
import { clip } from "@/agents/taskSummary";
import { withWire } from "@/agents/wires";
import { createNodeElement, nodeKindOf, nodeLink, NODE_SIZE } from "@/canvas/nodeElement";
import { signalWire } from "@/canvas/wireActivity";
import { messages } from "@/i18n";
import { agentMessages } from "@/mcp/messages";
import { oneLine } from "@/mission/mission";
import type { OutputPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";

/**
 * show_output: an agent shows a result in an output node beside its terminal,
 * wired to it, or updates one it showed before. The content is OpenUI Lang,
 * checked before anything is drawn: an agent gets its errors back in plain
 * words and calls again.
 *
 * A call without `output` updates the agent's latest output in place: an agent
 * that lost the id (after /clear, or in a loop) does not pile up new nodes.
 * `new: true` shows another one beside it.
 */

const MAX_TITLE = 80;

const t = () => messages(agentMessages).output;

export interface ShowArgs {
  title?: unknown;
  ui?: unknown;
  /** The id or link of the output to update. */
  output?: unknown;
  /** true: show another output, never update the latest. */
  new?: unknown;
}

export interface ShowResult {
  text: string;
  error?: boolean;
  /** The output's node id, when shown. */
  id?: string;
}

const refuse = (text: string): ShowResult => ({ text, error: true });

/** The node id an `output` argument names: a bare id or its dummyPlane link. */
export function outputIdOf(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  const link = /^dummyplane:\/\/output\/([\w-]+)$/.exec(text);
  return link ? link[1] : text;
}

/** Calls run one at a time: two outputs of one turn would take the same free spot. */
let chain: Promise<unknown> = Promise.resolve();

export function showOutput(sourceId: string, args: ShowArgs): Promise<ShowResult> {
  const run = chain.then(() => showNow(sourceId, args));
  chain = run.catch(() => undefined);
  return run;
}

/**
 * The output `sourceId` showed or updated last, among those still on the
 * canvas (`elements`, its workspace's scene); null when none is. On a tie, the
 * one drawn first: a copy the user made of an output (`@/agents/terminals`)
 * keeps its payload, `updatedAt` included, and comes after it in the scene;
 * the agent goes on updating the one it showed, wired to it.
 */
export function latestOutputOf(sourceId: string, elements: readonly ExcalidrawElement[]): string | null {
  const nodes = nodesStore.getState().nodes;
  let latest: { id: string; at: number } | null = null;
  for (const element of elements) {
    if (element.isDeleted) continue;
    const record = nodes[element.id];
    if (record?.kind !== "output" || record.payload.source !== sourceId) continue;
    const at = record.payload.updatedAt ?? 0;
    if (!latest || at > latest.at) latest = { id: element.id, at };
  }
  return latest?.id ?? null;
}

/** `element` moved to the nearest spot right of the source that covers no node nor group frame. */
function placed(elements: readonly ExcalidrawElement[], element: ExcalidrawElement): ExcalidrawElement {
  const obstacles = elements.filter((e) => !e.isDeleted && (nodeKindOf(e) !== null || e.type === "frame")).map(({ x, y, width, height }) => ({ x, y, width, height }));
  const spot = freeSpot(element, obstacles);
  return spot.x === element.x && spot.y === element.y ? element : newElementWith(element, { x: spot.x, y: spot.y });
}

async function showNow(sourceId: string, args: ShowArgs): Promise<ShowResult> {
  const ui = typeof args.ui === "string" ? args.ui : "";
  // OpenUI's parser loads with the first output, not with the app.
  const { checkOpenUI } = await import("@/openui/parse");
  const check = checkOpenUI(ui);
  if (check.errors.length) return refuse(t().invalid(check.errors));
  const title = clip(oneLine(typeof args.title === "string" ? args.title : ""), MAX_TITLE) || messages(agentMessages).output.untitled;
  const record = nodesStore.getState().nodes[sourceId];
  if (!record || !terminalOf(record)) return refuse(t().gone);
  const workspaceId = record.workspaceId;
  const scene = sceneAccess(workspaceId);
  if (!scene) return refuse(t().noCanvas);
  const warnings = check.warnings.length ? ` ${t().warnings(check.warnings)}` : "";
  const payload: OutputPayload = { title, source: sourceId, ui, updatedAt: Date.now() };
  /** `id`, an output of the source on the canvas, shows the new content in place. */
  const update = (id: string) => {
    nodesStore.getState().update(id, { title, ui, updatedAt: payload.updatedAt });
    signalWire(id, "toAgent", sourceId);
  };

  const wanted = outputIdOf(args.output);
  if (wanted) {
    const existing = nodesStore.getState().nodes[wanted];
    const element = scene.elements().find((e) => e.id === wanted);
    if (existing?.kind !== "output" || !element || element.isDeleted) return refuse(t().noSuchOutput(wanted));
    if (existing.payload.source !== sourceId) return refuse(t().notYours(wanted));
    update(wanted);
    return { text: t().updated(wanted, nodeLink("output", wanted)) + warnings, id: wanted };
  }

  // Without an id, the latest output it shows is updated, unless it asks for another one.
  const latest = args.new === true || args.new === "true" ? null : latestOutputOf(sourceId, scene.elements());
  if (latest) {
    update(latest);
    return { text: t().updatedLatest(latest, nodeLink("output", latest)) + warnings, id: latest };
  }

  const source = scene.elements().find((e) => e.id === sourceId && !e.isDeleted);
  if (!source) return refuse(t().gone);
  const { width, height } = NODE_SIZE.output;
  // Right of its agent, NODE_GAP apart, its top level with the terminal's; then clear of any neighbour.
  const element = createNodeElement("output", { x: source.x + source.width + NODE_GAP + width / 2, y: source.y + height / 2 });
  // The node's row comes before its element: a scene save purges the rows of nodes it does not list.
  await nodesStore.getState().create(element.id, { workspaceId, kind: "output", payload });
  // Read after the wait: the scene may have changed meanwhile.
  const now = sceneAccess(workspaceId);
  if (!now) return refuse(t().noCanvas);
  const elements = now.elements();
  now.write(withWire([...elements, placed(elements, element)], sourceId, element.id));
  signalWire(element.id, "toAgent", sourceId);
  return { text: t().shown(element.id, nodeLink("output", element.id)) + warnings, id: element.id };
}
