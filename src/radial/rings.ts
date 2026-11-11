import type { ComponentType } from "react";
import {
  BringToFront,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Ellipsis,
  FileDiff,
  FileDown,
  FileUp,
  Focus,
  FoldVertical,
  FolderOpen,
  ImageDown,
  LayoutGrid,
  Group,
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
  Scan,
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
import { selectionLocked } from "@/commands/catalog/drawing";
import { COMMANDS } from "@/commands/registry";
import { agentsStore } from "@/agents/agentsStore";
import { AGENTS, defaultAgent } from "@/agents/catalog";
import { groupHolding } from "@/agents/groupHolding";
import { canvasStore } from "@/canvas/canvasStore";
import { nodeKindOf } from "@/canvas/nodeElement";
import { messages } from "@/i18n";
import { radialMessages } from "./messages";

export type RingKind = "canvas" | "terminal" | "group" | "fleet" | "selection";
type Icon = ComponentType<{ className?: string }>;
type ShortName = keyof (typeof radialMessages)["short"];

export interface RingSlot {
  /** The registry's command, or the one of the moment ("Pause" / "Resume"). */
  command: string | ((ctx: CommandContext) => string);
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
}

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
const groups = (ctx: CommandContext) => COMMANDS.find((c) => c.id === "selection.group")?.available(ctx) ?? false;
/** "Ungroup" comes first: a group's frame or members also make Group available, greyed ("a terminal is already in a group"). */
const ungroups = (ctx: CommandContext) => COMMANDS.find((c) => c.id === "selection.ungroup")?.available(ctx) ?? false;
type Grouping = "ungroup" | "group" | "paste";
const groupingSlot = (ctx: CommandContext): Grouping => (ungroups(ctx) ? "ungroup" : groups(ctx) ? "group" : "paste");
const GROUPING: Record<Grouping, { command: string; icon: Icon }> = {
  ungroup: { command: "selection.ungroup", icon: Ungroup },
  group: { command: "selection.group", icon: Group },
  paste: { command: "drawing.paste", icon: ClipboardPaste },
};
const short = () => messages(radialMessages).short;

/** "Arrange" of a node's More: its group, inside its frame, when it stands in one; else the whole canvas. */
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
  };
}
const folded = (ctx: CommandContext) => canvasStore.getState().frames.find((f) => f.id === ctx.groupId)?.group?.folded === true;
/**
 * Arrange moves nodes and frames, and drawings stay where they are: for a selection of drawings
 * alone it would arrange the whole canvas instead, which is not what the selection's ring means.
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
 * of fewer than eight leaves no empty place. Each ends with More (↖ on a ring
 * of eight), which opens its arc of ARCS: what the ring has no room for.
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
    { command: "scene.arrange", short: "arrange", icon: LayoutGrid },
    { command: "agent.other", short: "otherAgent", icon: Plus },
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
  ],
  group: [
    { command: "group.addAgent", short: "addAgent", icon: UserPlus },
    { command: "group.rename", short: "rename", icon: Pencil },
    { command: "group.linkFleet", short: "linkFleet", icon: Network },
    { command: "group.pause", short: "pause", icon: Pause },
    { command: "group.close", short: "close", icon: X, danger: true },
    { command: "group.arrange", short: "arrange", icon: LayoutGrid },
    { command: "group.resume", short: "resume", icon: Play },
  ],
  fleet: [
    { command: "fleet.write", short: "write", icon: MessageSquare },
    { command: "fleet.rename", short: "rename", icon: Pencil },
    { command: "fleet.remove", short: "delete", icon: Trash2, danger: true },
    { command: "fleet.link", short: "link", icon: Link },
    { command: "fleet.paste", short: "paste", icon: ClipboardPaste },
    { command: "fleet.note", short: "note", icon: StickyNote },
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
    // The selection's blocks, or inside the one group selected (scene.arrange reads the ring's selection).
    { command: "scene.arrange", short: "arrange", icon: LayoutGrid, reason: drawingsAlone },
  ],
};

/**
 * Each ring's More arc, clockwise from its first wedge: what the ring has no room for. Its
 * places are fixed too, greyed when they cannot run. Excalidraw's own full menu is the
 * selection's last: nothing of it is lost.
 */
export const ARCS: Record<RingKind, readonly RingSlot[]> = {
  canvas: [
    { command: "canvas.overview", short: "overview", icon: Scan },
    { command: "scene.export", short: "export", icon: FileDown },
    { command: "scene.import", short: "import", icon: FileUp },
    { command: "scene.png", short: "png", icon: ImageDown },
  ],
  terminal: [
    { command: "terminal.stop", short: "stop", icon: Square },
    { command: "terminal.duplicate", short: "duplicate", icon: CopyPlus },
    { command: "terminal.review", short: "review", icon: FileDiff },
    { command: "terminal.leaveGroup", short: "leaveGroup", icon: LogOut },
    arrangeAround((ctx) => ctx.terminalId),
  ],
  group: [
    { command: "group.ungroup", short: "ungroup", icon: Ungroup },
    {
      command: "group.fold",
      short: (ctx) => (folded(ctx) ? short().unfold : short().fold),
      icon: FoldVertical,
      iconOf: (ctx) => (folded(ctx) ? UnfoldVertical : FoldVertical),
    },
    { command: "group.frame", short: "zoom", icon: Focus },
  ],
  fleet: [arrangeAround((ctx) => ctx.fleetId), { command: "fleet.leaveGroup", short: "leaveGroup", icon: LogOut }],
  selection: [
    { command: "drawing.lock", short: () => (selectionLocked() ? short().unlock : short().lock), icon: Lock, iconOf: () => (selectionLocked() ? LockOpen : Lock) },
    { command: "drawing.more", short: "options", icon: SlidersHorizontal },
  ],
};

/** The place of the More wedge in a ring: the last. */
export const moreSlotOf = (kind: RingKind): number => RINGS[kind].length;
/** The wedges a ring shows: its commands, then More. */
export const wedgeCountOf = (kind: RingKind): number => RINGS[kind].length + 1;

export interface RingLine {
  /** Null for More, which opens the arc rather than running a command. */
  command: Command | null;
  /** The context it runs in: the ring's, or its slot's own. */
  context: CommandContext;
  /** The More wedge. */
  more: boolean;
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

/** A button as it shows now: its command, name, icon, and whether it can run. */
export function lineOf(slot: RingSlot, ring: CommandContext, commands: readonly Command[] = COMMANDS): RingLine | null {
  const id = typeof slot.command === "function" ? slot.command(ring) : slot.command;
  const command = commands.find((c) => c.id === id);
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
  };
}

/** The More wedge: always there, it opens its arc. */
export function moreLine(ring: CommandContext): RingLine {
  const text = messages(radialMessages);
  return { command: null, context: ring, more: true, label: text.more, short: text.short.more, Icon: Ellipsis, enabled: true, reason: null, danger: false };
}

/** A ring's wedges as they show now, clockwise from the top: its commands, then More. */
export function ringLines(kind: RingKind, ctx: CommandContext): (RingLine | null)[] {
  return [...RINGS[kind].map((slot) => lineOf(slot, ctx)), moreLine(ctx)];
}

/** A ring's More arc as it shows now, clockwise. */
export function arcLines(kind: RingKind, ctx: CommandContext): (RingLine | null)[] {
  return ARCS[kind].map((slot) => lineOf(slot, ctx));
}
