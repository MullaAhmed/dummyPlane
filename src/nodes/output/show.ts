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
 */

const MAX_TITLE = 80;

const t = () => messages(agentMessages).output;

export interface ShowArgs {
  title?: unknown;
  ui?: unknown;
  output?: unknown;
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

  const wanted = outputIdOf(args.output);
  if (wanted) {
    const existing = nodesStore.getState().nodes[wanted];
    const element = scene.elements().find((e) => e.id === wanted);
    if (existing?.kind !== "output" || !element || element.isDeleted) return refuse(t().noSuchOutput(wanted));
    if (existing.payload.source !== sourceId) return refuse(t().notYours(wanted));
    nodesStore.getState().update(wanted, { title, ui, updatedAt: payload.updatedAt });
    signalWire(wanted, "toAgent", sourceId);
    return { text: t().updated(wanted, nodeLink("output", wanted)) + warnings, id: wanted };
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
