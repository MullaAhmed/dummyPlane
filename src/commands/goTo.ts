import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { framesFromScene, groupOf, isGroup } from "@/canvas/groups";
import { nodeKindOf } from "@/canvas/nodeElement";
import { readingOrder, terminalOrder } from "@/canvas/terminalOrder";
import { messages } from "@/i18n";
import { AGENTS } from "@/fleet/catalog";
import { ROLES } from "@/fleet/roles";
import { orchestratorLinks } from "@/fleet/wires";
import type { Project, Workspace } from "@/ipc/db";
import type { AgentId } from "@/ipc/pty";
import { readOrchestratorPayload } from "@/nodes/types";
import { terminalOf, type NodeRecord } from "@/store/nodes";
import { commandsMessages } from "./messages";
import { rank, rankSections } from "./search";

export type GoToKind = "terminal" | "group" | "orchestrator" | "workspace" | "project";

/** A line of "Go to" (spec window §7.2). */
export interface GoToItem {
  key: string;
  kind: GoToKind;
  label: string;
  keywords: string[];
  /** The workspace of a node or a group, or the workspace itself. */
  workspaceId?: string;
  /** The node or the group frame to reach. */
  targetId?: string;
  projectId?: string;
  /** The item's workspace, only when it is not the one on screen. */
  elsewhere?: string;
  agent?: AgentId;
  group?: { name: string; color: string };
  members?: number;
  links?: number;
  live?: number;
  current?: boolean;
  path?: string;
}

export const GO_TO_SECTIONS: readonly GoToKind[] = ["terminal", "group", "orchestrator", "workspace", "project"];

export interface GoToInput {
  home: boolean;
  projects: readonly Project[];
  activeProjectId: string | null;
  /** In tab order. */
  workspaces: readonly Workspace[];
  activeWorkspaceId: string | null;
  /** Each workspace's scene; missing while it is read. */
  scenes: Readonly<Record<string, readonly ExcalidrawElement[] | undefined>>;
  nodes: Readonly<Record<string, NodeRecord>>;
  /** Running agents per workspace. */
  live: Readonly<Record<string, number>>;
}

/** The other projects, most recently opened first; a project whose folder is gone cannot open. */
function projectItems(input: GoToInput): GoToItem[] {
  return input.projects
    .filter((p) => p.id !== input.activeProjectId && !p.missing)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .map((p) => ({ key: `project:${p.id}`, kind: "project", label: p.name, keywords: [p.path], projectId: p.id, path: p.path }));
}

/** The items of "Go to", section by section, in their order without a search (spec window §7.2). */
export function goToItems(input: GoToInput): GoToItem[] {
  if (input.home) return projectItems(input);
  const words = messages(commandsMessages).goTo.keywords;
  const onScreenFirst = [...input.workspaces].sort(
    (a, b) => Number(b.id === input.activeWorkspaceId) - Number(a.id === input.activeWorkspaceId),
  );
  const terminals: GoToItem[] = [];
  const groups: GoToItem[] = [];
  const orchestrators: GoToItem[] = [];
  for (const workspace of onScreenFirst) {
    const scene = input.scenes[workspace.id];
    if (!scene) continue;
    const elsewhere = workspace.id === input.activeWorkspaceId ? undefined : workspace.name;
    const frames = framesFromScene(scene);
    for (const id of terminalOrder(scene)) {
      const payload = terminalOf(input.nodes[id]);
      if (!payload) continue;
      const meta = AGENTS[payload.agent];
      const group = groupOf(frames, id);
      terminals.push({
        key: `terminal:${id}`,
        kind: "terminal",
        label: payload.name || meta.label,
        keywords: [meta.label, ...(group ? [group.name] : []), workspace.name],
        workspaceId: workspace.id,
        targetId: id,
        elsewhere,
        agent: payload.agent,
        group: group ? { name: group.name, color: ROLES[group.group.role].color } : undefined,
      });
    }
    for (const frame of readingOrder(frames.filter(isGroup))) {
      const role = ROLES[frame.group.role];
      groups.push({
        key: `group:${frame.id}`,
        kind: "group",
        label: frame.name,
        keywords: [words.group, role.label, workspace.name],
        workspaceId: workspace.id,
        targetId: frame.id,
        elsewhere,
        group: { name: frame.name, color: role.color },
        members: frame.memberIds.length,
      });
    }
    const links = orchestratorLinks(scene);
    for (const element of readingOrder(scene.filter((e) => !e.isDeleted && nodeKindOf(e) === "orchestrator"))) {
      const wired = links[element.id];
      orchestrators.push({
        key: `orchestrator:${element.id}`,
        kind: "orchestrator",
        label: readOrchestratorPayload(input.nodes[element.id]?.payload).name,
        keywords: [words.orchestrator, workspace.name],
        workspaceId: workspace.id,
        targetId: element.id,
        elsewhere,
        links: wired ? wired.groupIds.length + wired.nodeIds.length : 0,
      });
    }
  }
  const workspaces = input.workspaces.map(
    (w): GoToItem => ({
      key: `workspace:${w.id}`,
      kind: "workspace",
      label: w.name,
      keywords: [words.workspace, words.tab],
      workspaceId: w.id,
      live: input.live[w.id] ?? 0,
      current: w.id === input.activeWorkspaceId,
    }),
  );
  return [...terminals, ...groups, ...orchestrators, ...workspaces, ...projectItems(input)];
}

export interface GoToSection {
  kind: GoToKind;
  label: string;
  items: GoToItem[];
}

/** The sections of "Go to", each ranked by the search, the best match's first while searching; empty ones left out. */
export function goToSections(items: readonly GoToItem[], query: string): GoToSection[] {
  const labels = messages(commandsMessages).goTo.sections;
  const sections = GO_TO_SECTIONS.map((kind) => ({ kind, label: labels[kind], items: rank(items.filter((i) => i.kind === kind), query, (i) => i) })).filter(
    (section) => section.items.length > 0,
  );
  return rankSections(sections, query, (i: GoToItem) => i);
}
