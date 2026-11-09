import { arrive, showNode } from "@/canvas/arrive";
import { requestCloseOrchestrator } from "@/fleet/orchestrators";
import { pasteIntoTerminal } from "@/nodes/terminal/registry";
import { readClipboardText } from "@/radial/bridges";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import type { Command, CommandContext } from "../command";
import { requestUi } from "../uiRequests";
import { command } from "./define";
import { catalog } from "./messages";

/** The orchestrator the radial menu points at; the palette never sets one (spec menu radial §6.2). */
function orchestratorOf(ctx: CommandContext): string | null {
  const id = ctx.project ? ctx.orchestratorId : null;
  return id && nodesStore.getState().nodes[id]?.kind === "orchestrator" ? id : null;
}

const hasOrchestrator = (ctx: CommandContext) => orchestratorOf(ctx) !== null;
// `available` guarantees it before `run`.
const id = (ctx: CommandContext) => ctx.orchestratorId as string;

function section(ctx: CommandContext): string {
  const record = nodesStore.getState().nodes[ctx.orchestratorId ?? ""];
  const name = record?.kind === "orchestrator" ? (record.payload as { name?: string }).name : undefined;
  return catalog().sections.orchestrator(name ?? "");
}

export const ORCHESTRATOR: readonly Command[] = [
  command("orchestrator.write", { section, available: hasOrchestrator, run: (ctx) => void arrive(id(ctx)) }),
  command("orchestrator.rename", {
    section,
    available: hasOrchestrator,
    run: (ctx) => {
      showNode(id(ctx));
      requestUi({ kind: "renameOrchestrator", id: id(ctx) });
    },
  }),
  command("orchestrator.link", { section, available: hasOrchestrator, run: (ctx) => uiStore.getState().setLinking(id(ctx)) }),
  command("orchestrator.paste", {
    section,
    available: hasOrchestrator,
    run: async (ctx) => {
      const text = await readClipboardText();
      if (text === null) return;
      // Like a terminal's "Paste": its session's terminal takes the keyboard, then the text.
      arrive(id(ctx));
      pasteIntoTerminal(id(ctx), text);
    },
  }),
  command("orchestrator.remove", { section, available: hasOrchestrator, run: (ctx) => requestCloseOrchestrator(id(ctx)) }),
];
