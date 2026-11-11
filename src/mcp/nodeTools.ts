import { AGENTS } from "@/agents/catalog";
import { fromStoredKind } from "@/canvas/nodeElement";
import { formatClock } from "@/i18n/format";
import { messages } from "@/i18n";
import { agentState } from "@/mission/store";
import { showOutput } from "@/nodes/output/show";
import { entryOfElement, subagentNodesStore } from "@/nodes/subagent/store";
import { subagentAbout, subagentAnswer, subagentType } from "@/nodes/subagent/title";
import { terminalText } from "@/nodes/terminal/registry";
import { COMPONENT_NAMES } from "@/openui/detect";
import { nodeNameOf, nodesStore, sessionOf, terminalOf } from "@/store/nodes";
import { refused, said, type ToolResult } from "./agentTools";
import { agentMessages } from "./messages";
import { outAgentState } from "./protocol";

/**
 * The tools about dummyPlane's nodes themselves: an agent shows its output
 * (show_output, output_guide), and any agent reads a node from the link the
 * user pasted to it (read_node), with no wire between them: the user handing
 * the link over is the consent.
 */

const t = () => messages(agentMessages);

/** Their specs: show_output and output_guide for agents, read_node for everyone. */
export function outputTools() {
  const d = t().tools;
  return [
    {
      name: "show_output",
      description: d.showOutput(COMPONENT_NAMES.join(", ")),
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 80, description: d.showTitle },
          ui: { type: "string", description: d.showUi },
          output: { type: "string", description: d.showOutputId },
        },
        required: ["title", "ui"],
      },
    },
    outputGuideSpec(),
  ];
}

export function outputGuideSpec() {
  return { name: "output_guide", description: t().tools.outputGuide, inputSchema: { type: "object", properties: {} } };
}

export function readNodeSpec() {
  const d = t().tools;
  return {
    name: "read_node",
    description: d.readNode,
    inputSchema: {
      type: "object",
      properties: {
        link: { type: "string", description: d.readLink },
        lines: { type: "integer", minimum: 1, maximum: 400, description: d.readNodeLines },
      },
      required: ["link"],
    },
  };
}

export async function showOutputTool(nodeId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const result = await showOutput(nodeId, args);
  return result.error ? refused(result.text) : said(result.text);
}

/** OpenUI loads here, on the first call: listing the tools never loads it. */
export async function outputGuideTool(): Promise<ToolResult> {
  const { outputGuide } = await import("@/openui/library");
  return said(outputGuide());
}

/** A node's link (`dummyplane://<stored kind>/<id>`), or its bare id; null when it is neither. */
export function parseNodeLink(raw: string): { kind: string | null; id: string } | null {
  const text = raw.trim().replace(/^<|>$/g, "");
  const link = /^dummyplane:\/\/([a-z]+)\/([\w-]+)\/?$/i.exec(text);
  if (link) return { kind: link[1].toLowerCase(), id: link[2] };
  return /^[\w-]+$/.test(text) ? { kind: null, id: text } : null;
}

function readTerminal(nodeId: string, lines: number): ToolResult {
  const r = t().read;
  const record = nodesStore.getState().nodes[nodeId];
  const session = sessionOf(record);
  const name = nodeNameOf(record) || (session ? AGENTS[session.agent].label : nodeId);
  const head = [r.terminal(name, session ? AGENTS[session.agent].label : "terminal", outAgentState(agentState(nodeId)))];
  const payload = terminalOf(record);
  if (payload?.task) head.push(r.task(payload.task));
  if (payload?.lastReport) head.push(r.report(payload.lastReport.status, payload.lastReport.summary));
  const screen = terminalText(nodeId, lines);
  head.push(screen ? `${r.screen(lines)}\n${screen}` : r.notShown);
  return said(head.join("\n"));
}

/** dummyPlane keeps a subagent's prompt and texts up to a length (src-tauri subagent_transcript.rs), marked with "…". */
const cut = (text: string) => text.endsWith("…");

function readSubagent(elementId: string, link: string): ToolResult | null {
  const r = t().read;
  const entry = entryOfElement(subagentNodesStore.getState().agents, elementId);
  if (!entry) return null;
  const parent = nodeNameOf(nodesStore.getState().nodes[entry.nodeId]) || "a terminal";
  const out = [r.subagent(subagentType(entry), entry.state, parent)];
  const about = subagentAbout(entry);
  if (about) out.push(r.asked(about));
  const prompt = entry.lines.find((line) => line.kind === "prompt")?.text ?? entry.prompt;
  if (prompt) out.push(`${r.prompt}\n${prompt}${cut(prompt) ? `\n${r.cut(2000)}` : ""}`);
  const answer = subagentAnswer(entry);
  if (answer) out.push(`${r.result}\n${answer.text}${cut(answer.text) ? `\n${r.cut(4000)}` : ""}`);
  else out.push(entry.state === "done" ? r.noResult : r.running);
  const rest = entry.lines.filter((line) => line.kind !== "prompt").slice(-60);
  if (rest.length) out.push(`${r.transcript}\n${rest.map((line) => `[${line.kind}] ${line.text}`).join("\n")}`);
  return said(`${out.join("\n\n")}\n\n(${link})`);
}

/** read_node: what the node behind a dummyPlane link shows. */
export async function readNodeTool(args: Record<string, unknown>): Promise<ToolResult> {
  const r = t().read;
  const raw = typeof args.link === "string" ? args.link : "";
  if (!raw.trim()) return refused(r.what);
  const parsed = parseNodeLink(raw);
  if (!parsed) return refused(r.notALink(raw.trim()));
  const lines = typeof args.lines === "number" ? Math.min(400, Math.max(1, Math.floor(args.lines))) : 80;
  const link = raw.trim();
  if (parsed.kind === "subagent") return readSubagent(parsed.id, link) ?? refused(r.subagentGone(link));
  if (parsed.kind !== null && fromStoredKind(parsed.kind) === null) return refused(r.notALink(link));
  const record = nodesStore.getState().nodes[parsed.id];
  if (!record) return (parsed.kind === null && readSubagent(parsed.id, link)) || refused(r.notFound(link));
  switch (record.kind) {
    case "terminal":
    case "fleet":
      return readTerminal(parsed.id, lines);
    case "output": {
      const { title, source, ui, updatedAt } = record.payload;
      const from = nodeNameOf(nodesStore.getState().nodes[source]) || "an agent";
      const { generatedAsText } = await import("@/openui/plainText");
      return said(`${r.output(title, from, updatedAt ? formatClock(updatedAt, Date.now()) : "")}\n\n${generatedAsText(ui)}`);
    }
    case "file":
      return said(r.file(record.payload.path));
    case "kanban": {
      const { columns, cards } = record.payload;
      const board = columns.map((c) => `## ${c.title}\n${c.cardIds.map((id) => `- ${cards[id]?.title ?? id}${cards[id]?.notes ? `: ${cards[id].notes}` : ""}`).join("\n")}`);
      return said(`${r.board}\n\n${board.join("\n\n")}`);
    }
    default:
      return refused(r.other(String((record as { kind: string }).kind)));
  }
}
