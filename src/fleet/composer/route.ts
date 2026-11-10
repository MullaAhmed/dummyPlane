import type { SceneFrame } from "@/canvas/groups";
import { isCommandAfterMentions } from "../slashCommands";
import { extractMentions, resolveTargets, uniqueTargets, type Target, type TargetAgent, type TargetOption } from "../targets";

/** What the field knows besides its text: the chips, the `@` list, and who is reached without `@`. */
export interface RouteScope {
  chips: readonly Target[];
  options: readonly TargetOption[];
  agents: readonly TargetAgent[];
  groups: readonly SceneFrame[];
  /** Reached without `@`: the selection, or an orchestrator's agents. */
  fallback: readonly string[];
}

/** Where a typed command goes, worked out the same way for the Send button and for the send itself. */
export interface CommandRoute {
  /** The chips, then the names typed after `@`, once each. */
  targets: Target[];
  /** The terminals it reaches: the targets', else `fallback`. */
  ids: string[];
  /** What the agents receive: the text without its mentions. */
  instruction: string;
  /** A mistyped `@name` around a /command: that command must not go to the selection instead. */
  unknown: string | undefined;
  canSend: boolean;
}

export function routeCommand(text: string, scope: RouteScope): CommandRoute {
  const typed = extractMentions(text, scope.options);
  const targets = uniqueTargets([...scope.chips, ...typed.targets]);
  const ids = resolveTargets(targets, { all: scope.agents.map((a) => a.id), groups: scope.groups }, scope.fallback);
  const unknown = isCommandAfterMentions(typed.text) ? /(?:^|\s)(@[^\s@,;:.!?…]+)/.exec(typed.text)?.[1] : undefined;
  return { targets, ids, instruction: typed.text, unknown, canSend: typed.text.length > 0 && ids.length > 0 && unknown === undefined };
}
