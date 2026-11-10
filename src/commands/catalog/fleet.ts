import { arrive, showNode } from "@/canvas/arrive";
import { requestCloseFleet } from "@/fleet/fleets";
import { pasteIntoTerminal } from "@/nodes/terminal/registry";
import { readClipboardText } from "@/radial/bridges";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import type { Command, CommandContext } from "../command";
import { requestUi } from "../uiRequests";
import { command } from "./define";
import { catalog } from "./messages";

/** The fleet the radial menu points at; the palette never sets one (spec menu radial §6.2). */
function fleetOf(ctx: CommandContext): string | null {
  const id = ctx.project ? ctx.fleetId : null;
  return id && nodesStore.getState().nodes[id]?.kind === "fleet" ? id : null;
}

const hasFleet = (ctx: CommandContext) => fleetOf(ctx) !== null;
// `available` guarantees it before `run`.
const id = (ctx: CommandContext) => ctx.fleetId as string;

function section(ctx: CommandContext): string {
  const record = nodesStore.getState().nodes[ctx.fleetId ?? ""];
  const name = record?.kind === "fleet" ? (record.payload as { name?: string }).name : undefined;
  return catalog().sections.fleet(name ?? "");
}

export const FLEET: readonly Command[] = [
  command("fleet.write", { section, available: hasFleet, run: (ctx) => void arrive(id(ctx)) }),
  command("fleet.rename", {
    section,
    available: hasFleet,
    run: (ctx) => {
      showNode(id(ctx));
      requestUi({ kind: "renameFleet", id: id(ctx) });
    },
  }),
  command("fleet.link", { section, available: hasFleet, run: (ctx) => uiStore.getState().setLinking(id(ctx)) }),
  command("fleet.paste", {
    section,
    available: hasFleet,
    run: async (ctx) => {
      const text = await readClipboardText();
      if (text === null) return;
      // Like a terminal's "Paste": its session's terminal takes the keyboard, then the text.
      arrive(id(ctx));
      pasteIntoTerminal(id(ctx), text);
    },
  }),
  command("fleet.remove", { section, available: hasFleet, run: (ctx) => requestCloseFleet(id(ctx)) }),
];
