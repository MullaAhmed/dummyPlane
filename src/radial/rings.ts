import type { ComponentType } from "react";
import {
  BringToFront,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Ellipsis,
  Focus,
  FolderOpen,
  Group,
  Link,
  Lock,
  LockOpen,
  MessageSquare,
  Network,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Scan,
  SendToBack,
  Square,
  Terminal,
  Trash2,
  Type,
  Ungroup,
  UserPlus,
  X,
} from "lucide-react";
import { labelOf, type Command, type CommandContext } from "@/commands/command";
import { selectionLocked } from "@/commands/catalog/drawing";
import { COMMANDS } from "@/commands/registry";
import { agentsStore } from "@/agents/agentsStore";
import { AGENTS, defaultAgent } from "@/agents/catalog";
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
 * Two terminals or more are selected: "Group" takes the place of "Paste" in the selection ring,
 * which is full at 8. Paste is dead there anyway: it refuses to paste over a node (bridges.ts),
 * and Ctrl+V and the canvas ring still paste.
 */
const groups = (ctx: CommandContext) => COMMANDS.find((c) => c.id === "selection.group")?.available(ctx) ?? false;
const short = () => messages(radialMessages).short;

/**
 * The five rings, positions clockwise from the top (spec menu radial §4). A
 * ring holds only real buttons: they are spread evenly around it, so a ring
 * of fewer than eight leaves no empty place.
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
    { command: "tool.text", short: "text", icon: Type },
    { command: "agent.other", short: "otherAgent", icon: Plus },
    { command: "canvas.overview", short: "overview", icon: Scan },
  ],
  terminal: [
    { command: "terminal.copy", short: "copy", icon: Copy },
    { command: "terminal.paste", short: "paste", icon: ClipboardPaste },
    { command: "terminal.rename", short: "rename", icon: Pencil },
    { command: "terminal.relaunch", short: "restart", icon: RotateCw },
    { command: "terminal.close", short: "close", icon: X, danger: true },
    { command: "terminal.duplicate", short: "duplicate", icon: CopyPlus },
    {
      command: (ctx) => (resumes(ctx) ? "terminal.resume" : "terminal.pause"),
      short: (ctx) => (resumes(ctx) ? short().resume : short().pause),
      icon: Pause,
      iconOf: (ctx) => (resumes(ctx) ? Play : Pause),
    },
    { command: "terminal.stop", short: "stop", icon: Square },
  ],
  group: [
    { command: "group.addAgent", short: "addAgent", icon: UserPlus },
    { command: "group.rename", short: "rename", icon: Pencil },
    { command: "group.linkFleet", short: "linkFleet", icon: Network },
    { command: "group.pause", short: "pause", icon: Pause },
    { command: "group.close", short: "close", icon: X, danger: true },
    { command: "group.ungroup", short: "ungroup", icon: Ungroup },
    { command: "group.resume", short: "resume", icon: Play },
    { command: "group.frame", short: "zoom", icon: Focus },
  ],
  fleet: [
    { command: "fleet.write", short: "write", icon: MessageSquare },
    { command: "fleet.rename", short: "rename", icon: Pencil },
    { command: "fleet.remove", short: "delete", icon: Trash2, danger: true },
    { command: "fleet.link", short: "link", icon: Link },
    { command: "fleet.paste", short: "paste", icon: ClipboardPaste },
  ],
  selection: [
    { command: "drawing.copy", short: "copy", icon: Copy },
    {
      command: (ctx) => (groups(ctx) ? "selection.group" : "drawing.paste"),
      short: (ctx) => (groups(ctx) ? short().group : short().paste),
      icon: ClipboardPaste,
      iconOf: (ctx) => (groups(ctx) ? Group : ClipboardPaste),
    },
    { command: "drawing.duplicate", short: "duplicate", icon: CopyPlus },
    { command: "drawing.front", short: "toFront", icon: BringToFront },
    { command: "drawing.delete", short: "delete", icon: Trash2, danger: true },
    { command: "drawing.back", short: "toBack", icon: SendToBack },
    { command: "drawing.lock", short: () => (selectionLocked() ? short().unlock : short().lock), icon: Lock, iconOf: () => (selectionLocked() ? LockOpen : Lock) },
    { command: "drawing.more", short: "more", icon: Ellipsis },
  ],
};

export interface RingLine {
  command: Command;
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

/** A button as it shows now: its command, name, icon, and whether it can run (spec menu radial §5.1). */
export function lineOf(slot: RingSlot, ctx: CommandContext, commands: readonly Command[] = COMMANDS): RingLine | null {
  const id = typeof slot.command === "function" ? slot.command(ctx) : slot.command;
  const command = commands.find((c) => c.id === id);
  if (!command) return null;
  const available = command.available(ctx);
  const reason = available ? (command.disabled?.(ctx) ?? null) : null;
  return {
    command,
    label: labelOf(command, ctx),
    short: typeof slot.short === "function" ? slot.short(ctx) : short()[slot.short],
    Icon: slot.iconOf?.(ctx) ?? slot.icon,
    enabled: available && reason === null,
    reason,
    danger: slot.danger ?? false,
  };
}
