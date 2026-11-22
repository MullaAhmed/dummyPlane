import type { ComponentType } from "react";
import {
  BringToFront,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Ellipsis,
  FileDiff,
  Focus,
  FoldVertical,
  FolderOpen,
  LayoutGrid,
  Group,
  Kanban,
  Link,
  Lock,
  LockOpen,
  LogOut,
  MessageSquare,
  Network,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  SendToBack,
  SlidersHorizontal,
  Square,
  StickyNote,
  Terminal,
  Trash2,
  UnfoldVertical,
  Ungroup,
  UserPlus,
  X,
} from "lucide-react";
import { labelOf, type Command, type CommandContext } from "@/commands/command";
import { selectionLocked, selectionOf } from "@/commands/catalog/drawing";
import { COMMANDS } from "@/commands/registry";
import { agentsStore } from "@/agents/agentsStore";
import { AGENTS, defaultAgent } from "@/agents/catalog";
import { groupHolding } from "@/agents/groupHolding";
import { canvasStore } from "@/canvas/canvasStore";
import { nodeKindOf } from "@/canvas/nodeElement";
import { messages } from "@/i18n";
import { radialMessages } from "./messages";
import { agentPetals, arrangePetals, lookForAgents } from "./petals";

export type RingKind = "canvas" | "terminal" | "group" | "fleet" | "selection";
type Icon = ComponentType<{ className?: string }>;
type ShortName = keyof (typeof radialMessages)["short"];

export interface RingSlot {
  /**
   * The registry's command, or the one of the moment ("Pause" / "Resume"); a command of its own for a wedge of an arc
   * other than More's (a layout, an agent: ./petals.ts); null for More, which only opens its arc.
   */
  command: string | Command | null | ((ctx: CommandContext) => string);
  /** The name under its icon, a word or two; or the one of the moment ("Pause" / "Resume", the agent's name). */
  short: ShortName | ((ctx: CommandContext) => string);
  icon: Icon;
  /** The icon of the moment (the default agent's, the lock's). */
  iconOf?: (ctx: CommandContext) => Icon;
  /** Ends something: its icon in red. */
  danger?: boolean;
  /** The context its command runs in, when not the ring's own (a node's Arrange: its group, or the whole canvas). */
  context?: (ctx: CommandContext) => CommandContext;
  /** Why it is greyed here, when its command could run but would not do what this ring means (the selection's Arrange). */
  reason?: (ctx: CommandContext) => string | null;
  /**
   * Its arc: the wedges it opens instead of running its command (More's commands, Arrange's layouts, Other agent's
   * agents), read as the arc opens, in the context its command would run in. A greyed wedge opens none.
   */
  arc?: (ctx: CommandContext) => readonly RingSlot[];
  /** A look its arc waits for the first time and follows when it changes what the arc lists: the agents found on this machine. */
  look?: () => { ready: boolean; done: Promise<unknown> };
  /** Marked among the wedges of its arc, as its list ticks it: the saved layout, the default agent. */
  marked?: (ctx: CommandContext) => boolean;
  /** A word under its full name in the hub that is no reason, for it still runs: the saved layout, an agent whose deletes nothing guards. */
  note?: (ctx: CommandContext) => string | null;
}

/** More: the last wedge of a ring that has no room for everything. It opens its arc, `arc`, and runs nothing itself. */
const more = (arc: readonly RingSlot[]): RingSlot => ({ command: null, short: "more", icon: Ellipsis, arc: () => arc });

const defaultLaunch = () => `agent.launch.${defaultAgent(agentsStore.getState().agents)}`;
/** The second place of the canvas ring: the Shell, unless it is already the default agent (then another agent, else the custom one). */
function secondLaunch(): string {
  const agents = agentsStore.getState().agents;
  if (defaultAgent(agents) !== "shell") return "agent.launch.shell";
  const other = agents.find((a) => a.available && a.id !== "shell" && a.id !== "ollama");
  return other ? `agent.launch.${other.id}` : "agent.custom";
}
const LAUNCH_PREFIX = "agent.launch.";
const agentIconOf = (id: string): Icon =>
  id.startsWith(LAUNCH_PREFIX) && id !== `${LAUNCH_PREFIX}shell` ? AGENTS[id.slice(LAUNCH_PREFIX.length) as keyof typeof AGENTS].Icon : Terminal;
/**
 * A launch's short name is the agent's own ("Claude", "Shell"; the custom agent's, "Custom"), its
 * first word only ("Qwen Code" → "Qwen"): two words cross the edge of a wedge at the side.
 */
function agentNameOf(id: string): string {
  const name = id.startsWith(LAUNCH_PREFIX) ? AGENTS[id.slice(LAUNCH_PREFIX.length) as keyof typeof AGENTS].label : AGENTS.custom.label;
  return name.split(" ")[0];
}
const resumes = (ctx: CommandContext) => COMMANDS.find((c) => c.id === "terminal.resume")?.available(ctx) ?? false;
/**
 * Two terminals or more are selected: "Group" takes the place of "Paste" in the selection ring;
 * a group's frame or members, or Excalidraw's groups of drawings: "Ungroup". Paste is dead there
 * anyway: it refuses to paste over a node (bridges.ts), and Ctrl+V and the canvas ring still paste.
 */
type Grouping = "ungroup" | "group" | "paste";
/** How a grouping command stands for the selection: it can run, it shows greyed with its reason, or it is not offered. */
function standing(id: string, ctx: CommandContext): "runs" | "greyed" | null {
  const command = COMMANDS.find((c) => c.id === id);
  if (!command?.available(ctx)) return null;
  return command.disabled?.(ctx) ? "greyed" : "runs";
}
/**
 * "Ungroup" comes first: a group's frame or members also make Group available, greyed ("a terminal
 * is already in a group"). But a greyed Ungroup never hides a Group that can run (loose terminals
 * selected with a Fleet that sits in a group: the Fleet is no terminal, the two group all the same).
 */
function groupingSlot(ctx: CommandContext): Grouping {
  const ungroup = standing("selection.ungroup", ctx);
  const group = standing("selection.group", ctx);
  if (ungroup === "runs") return "ungroup";
  if (group === "runs") return "group";
  return ungroup ? "ungroup" : group ? "group" : "paste";
}
const GROUPING: Record<Grouping, { command: string; icon: Icon }> = {
  ungroup: { command: "selection.ungroup", icon: Ungroup },
  group: { command: "selection.group", icon: Group },
  paste: { command: "drawing.paste", icon: ClipboardPaste },
};
const short = () => messages(radialMessages).short;

/** "Arrange" of a node's More: its group, inside its frame, when it stands in one; else the whole canvas. Its arc of layouts arranges the same. */
function arrangeAround(nodeOf: (ctx: CommandContext) => string | null | undefined): RingSlot {
  const groupOfNode = (ctx: CommandContext) => {
    const id = nodeOf(ctx);
    return id ? groupHolding(id) : null;
  };
  return {
    command: (ctx) => (groupOfNode(ctx) ? "group.arrange" : "scene.arrange"),
    short: "arrange",
    icon: LayoutGrid,
    // The canvas, whole: not whatever Excalidraw has selected elsewhere.
    context: (ctx) => {
      const groupId = groupOfNode(ctx);
      return groupId ? { ...ctx, groupId } : { ...ctx, selectionIds: [] };
    },
    arc: arrangePetals((ctx) => {
      const groupId = groupOfNode(ctx);
      return groupId ? { kind: "group", id: groupId } : { kind: "scene", only: [] };
    }),
  };
}
const folded = (ctx: CommandContext) => canvasStore.getState().frames.find((f) => f.id === ctx.groupId)?.group?.folded === true;
/**
 * Arrange moves nodes and frames, and drawings stay where they are: for a selection of drawings
 * alone there is nothing for the selection's Arrange to move, so it is greyed with its reason.
 */
function drawingsAlone(ctx: CommandContext): string | null {
  const ids = new Set(ctx.selectionIds ?? []);
  const selected = canvasStore.getState().api?.getSceneElements().filter((e) => ids.has(e.id)) ?? [];
  const alone = selected.length > 0 && selected.every((e) => e.type !== "frame" && nodeKindOf(e) === null && !e.frameId);
  return alone ? messages(radialMessages).drawingsStay : null;
}

/**
 * The five rings, positions clockwise from the top. A
 * ring holds only real buttons: they are spread evenly around it, so a ring
 * of fewer than eight leaves no empty place. Each but the canvas's ends with More (↖ on a ring
 * of eight), which opens its arc: what the ring has no room for, clockwise, its places fixed and greyed when
 * they cannot run (Excalidraw's own full menu the selection's last: nothing of it is lost). The canvas's has
 * Kanban there. Every Arrange opens an arc of the layouts (a terminal's and a Fleet's, More's Arrange, in the
 * place of More's arc), and the canvas's Other agent an arc of the agents found on this machine (./petals.ts).
 */
export const RINGS: Record<RingKind, readonly RingSlot[]> = {
  canvas: [
    {
      command: defaultLaunch,
      short: () => agentNameOf(defaultLaunch()),
      icon: Play,
      iconOf: () => AGENTS[defaultAgent(agentsStore.getState().agents)].Icon,
    },
    { command: secondLaunch, short: () => agentNameOf(secondLaunch()), icon: Terminal, iconOf: () => agentIconOf(secondLaunch()) },
    { command: "agent.inFolder", short: "inFolder", icon: FolderOpen },
    { command: "agent.fleet", short: "fleet", icon: Network },
    { command: "drawing.paste", short: "paste", icon: ClipboardPaste },
    // Its layouts arrange what the palette's Arrange as… would: the selection when it holds several elements, else the canvas.
    { command: "scene.arrange", short: "arrange", icon: LayoutGrid, arc: arrangePetals((ctx) => ({ kind: "scene", only: selectionOf(ctx) })) },
    { command: "agent.other", short: "otherAgent", icon: Plus, arc: agentPetals, look: lookForAgents },
    // A board in More's place (12 Nov): the canvas ring has no More. Overview, export, import and PNG are the palette's.
    { command: "studio.kanban", short: "kanban", icon: Kanban },
  ],
  terminal: [
    { command: "terminal.copy", short: "copy", icon: Copy },
    { command: "terminal.paste", short: "paste", icon: ClipboardPaste },
    { command: "terminal.rename", short: "rename", icon: Pencil },
    { command: "terminal.relaunch", short: "restart", icon: RotateCw },
    { command: "terminal.close", short: "close", icon: X, danger: true },
    // Duplicate is in More, "⋯", the palette and Ctrl+D: its place is the quick note's (src/nodes/note).
    { command: "terminal.note", short: "note", icon: StickyNote },
    {
      command: (ctx) => (resumes(ctx) ? "terminal.resume" : "terminal.pause"),
      short: (ctx) => (resumes(ctx) ? short().resume : short().pause),
      icon: Pause,
      iconOf: (ctx) => (resumes(ctx) ? Play : Pause),
    },
    more([
      { command: "terminal.stop", short: "stop", icon: Square },
      { command: "terminal.duplicate", short: "duplicate", icon: CopyPlus },
      { command: "terminal.review", short: "review", icon: FileDiff },
      { command: "terminal.leaveGroup", short: "leaveGroup", icon: LogOut },
      arrangeAround((ctx) => ctx.terminalId),
    ]),
  ],
  group: [
    { command: "group.addAgent", short: "addAgent", icon: UserPlus },
    { command: "group.rename", short: "rename", icon: Pencil },
    { command: "group.linkFleet", short: "linkFleet", icon: Network },
    { command: "group.pause", short: "pause", icon: Pause },
    { command: "group.close", short: "close", icon: X, danger: true },
    { command: "group.arrange", short: "arrange", icon: LayoutGrid, arc: arrangePetals((ctx) => (ctx.groupId ? { kind: "group", id: ctx.groupId } : null)) },
    { command: "group.resume", short: "resume", icon: Play },
    more([
      { command: "group.ungroup", short: "ungroup", icon: Ungroup },
      {
        command: "group.fold",
        short: (ctx) => (folded(ctx) ? short().unfold : short().fold),
        icon: FoldVertical,
        iconOf: (ctx) => (folded(ctx) ? UnfoldVertical : FoldVertical),
      },
      { command: "group.frame", short: "zoom", icon: Focus },
    ]),
  ],
  fleet: [
    { command: "fleet.write", short: "write", icon: MessageSquare },
    { command: "fleet.rename", short: "rename", icon: Pencil },
    { command: "fleet.remove", short: "delete", icon: Trash2, danger: true },
    { command: "fleet.link", short: "link", icon: Link },
    { command: "fleet.paste", short: "paste", icon: ClipboardPaste },
    { command: "fleet.note", short: "note", icon: StickyNote },
    more([arrangeAround((ctx) => ctx.fleetId), { command: "fleet.leaveGroup", short: "leaveGroup", icon: LogOut }]),
  ],
  selection: [
    { command: "drawing.copy", short: "copy", icon: Copy },
    {
      command: (ctx) => GROUPING[groupingSlot(ctx)].command,
      short: (ctx) => short()[groupingSlot(ctx)],
      icon: ClipboardPaste,
      iconOf: (ctx) => GROUPING[groupingSlot(ctx)].icon,
    },
    { command: "drawing.duplicate", short: "duplicate", icon: CopyPlus },
    { command: "drawing.front", short: "toFront", icon: BringToFront },
    { command: "drawing.delete", short: "delete", icon: Trash2, danger: true },
    { command: "drawing.back", short: "toBack", icon: SendToBack },
    // Its layouts arrange the selection's blocks, or inside the one group selected: the ring's selection, never the whole canvas.
    {
      command: "scene.arrangeSelection",
      short: "arrange",
      icon: LayoutGrid,
      reason: drawingsAlone,
      arc: arrangePetals((ctx) => ({ kind: "selection", only: selectionOf(ctx) })),
    },
    more([
      { command: "drawing.lock", short: () => (selectionLocked() ? short().unlock : short().lock), icon: Lock, iconOf: () => (selectionLocked() ? LockOpen : Lock) },
      { command: "drawing.more", short: "options", icon: SlidersHorizontal },
    ]),
  ],
};

/** The place of the More wedge in a ring: the last; -1, never a wedge, for a ring without one (the canvas's). */
export const moreSlotOf = (kind: RingKind): number => RINGS[kind].findIndex((slot) => slot.command === null);
/** Whether a ring ends with More. */
export const hasMore = (kind: RingKind): boolean => moreSlotOf(kind) >= 0;
/** The wedges a ring shows: its commands, More included. */
export const wedgeCountOf = (kind: RingKind): number => RINGS[kind].length;

export interface RingLine {
  /** Null for More, which opens its arc rather than running a command. */
  command: Command | null;
  /** The context it runs in: the ring's, or its slot's own. */
  context: CommandContext;
  /** The More wedge. */
  more: boolean;
  /** It opens an arc rather than running its command: More, Arrange, Other agent. */
  opens: boolean;
  /** Marked among the wedges of its arc: the saved layout, the default agent. */
  marked: boolean;
  /** A word under its name in the hub that is no reason (it still runs). */
  note: string | null;
  /** The full name: the hub's, and the button's for assistive technology. */
  label: string;
  /** The name under the icon, in the wedge. */
  short: string;
  Icon: Icon;
  enabled: boolean;
  /** Why it is greyed, when the command says. */
  reason: string | null;
  danger: boolean;
}

/** The command a slot runs now: its own, or the registry's of its id. */
function commandOf(slot: RingSlot, ring: CommandContext, commands: readonly Command[]): Command | undefined {
  const { command } = slot;
  if (command !== null && typeof command === "object") return command;
  const id = typeof command === "function" ? command(ring) : command;
  return commands.find((c) => c.id === id);
}

/** A button as it shows now: its command, name, icon, and whether it can run. */
export function lineOf(slot: RingSlot, ring: CommandContext, commands: readonly Command[] = COMMANDS): RingLine | null {
  if (slot.command === null) return moreLine(ring);
  const command = commandOf(slot, ring, commands);
  if (!command) return null;
  const ctx = slot.context?.(ring) ?? ring;
  const available = command.available(ctx);
  const reason = available ? (command.disabled?.(ctx) ?? slot.reason?.(ctx) ?? null) : null;
  return {
    command,
    context: ctx,
    more: false,
    label: labelOf(command, ctx),
    short: typeof slot.short === "function" ? slot.short(ring) : short()[slot.short],
    Icon: slot.iconOf?.(ring) ?? slot.icon,
    enabled: available && reason === null,
    reason,
    danger: slot.danger ?? false,
    opens: slot.arc !== undefined,
    marked: slot.marked?.(ctx) ?? false,
    note: slot.note?.(ctx) ?? null,
  };
}

/** The More wedge: always there, it opens its arc. */
export function moreLine(ring: CommandContext): RingLine {
  const text = messages(radialMessages);
  return {
    command: null,
    context: ring,
    more: true,
    opens: true,
    marked: false,
    note: null,
    label: text.more,
    short: text.short.more,
    Icon: Ellipsis,
    enabled: true,
    reason: null,
    danger: false,
  };
}

/** A ring's wedges as they show now, clockwise from the top: its commands, then More when it has one. */
export function ringLines(kind: RingKind, ctx: CommandContext): (RingLine | null)[] {
  return RINGS[kind].map((slot) => lineOf(slot, ctx));
}

/** The arc `slot` would open now: its wedges, the context they run in (the slot's own) and its name; null when it has none or is greyed. */
export function arcOf(slot: RingSlot, ring: CommandContext): { slots: readonly RingSlot[]; context: CommandContext; label: string } | null {
  if (!slot.arc) return null;
  const line = lineOf(slot, ring);
  if (!line?.enabled) return null;
  return { slots: slot.arc(line.context), context: line.context, label: line.label };
}
