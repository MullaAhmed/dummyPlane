import { messages } from "@/i18n";
import { nodesStore } from "@/store/nodes";
import { fleetDecisionsStore, type FleetDecision, type FleetDecisionKind } from "@/store/fleetDecisions";
import { leftoversStore, type LeftoversRequest } from "./leftovers";
import { missionMessages } from "./messages";
import type { Mission } from "./mission";

/**
 * The decisions a Fleet's panel asks of the person are waits, as an agent's question is: the counts, the Agents
 * panel's filter, the waiting notice, the rail's badge and Notifications read them (`@/store/agentActivity`
 * `personActivities`). Its agent does not wait meanwhile: the Fleet still talks with the user and hears its team.
 */

/**
 * The decision `mission` (and the leftovers question held for its Fleet) waits on, or null: as its panel asks it.
 * Land while its question stands (the panel's `LandPrompt`), Clean up while one is asked, the go-ahead of a plan or of
 * changes to the waiting tasks while the panel's dot says it waits (none on an error: the panel shows that instead).
 * An overnight run that launches itself waits on no go-ahead: the night's dialog was it.
 */
export function decisionOf(mission: Mission | undefined, leftovers?: LeftoversRequest): { kind: FleetDecisionKind; at?: number } | null {
  if (mission?.landing && (mission.state === "en_cours" || mission.state === "terminee")) return { kind: "land", at: mission.landing.at };
  if (leftovers) return { kind: "leftovers", at: leftovers.at };
  if (!mission || mission.error) return null;
  if (mission.state === "plan" && !(mission.overnight && mission.autoLaunch)) return { kind: "plan" };
  if (mission.state === "en_cours" && mission.amendment) return { kind: "changes" };
  return null;
}

/** The line under the notice's first: the panel's own question, the mission's name and size for a plan. */
function messageOf(kind: FleetDecisionKind, mission: Mission | undefined): string | undefined {
  const m = messages(missionMessages);
  switch (kind) {
    case "plan":
      return m.decision.plan(mission?.name ?? "", mission?.plan?.length ?? 0);
    case "changes":
      return m.amendment.state;
    case "land":
      return mission?.landing ? m.land.title(mission.landing.target) : undefined;
    case "leftovers":
      return m.leftovers.title;
  }
}

const same = (a: FleetDecision | undefined, b: FleetDecision | undefined) =>
  a?.kind === b?.kind && a?.since === b?.since && a?.message === b?.message && a?.standing === b?.standing;

/**
 * Keeps `fleetDecisionsStore` in step with the missions and the leftovers questions. A decision keeps the date it was
 * first seen at while it stands (a plan has none of its own); one found on a Fleet as it is first read (the app
 * started, its project opened) is `standing`, told already. Returns its uninstall.
 */
export function installFleetDecisions(now: () => number = Date.now): () => void {
  let known = new Set<string>();
  const sync = () => {
    const nodes = nodesStore.getState().nodes;
    const asks = leftoversStore.getState().asks;
    const before = fleetDecisionsStore.getState().decisions;
    const next: Record<string, FleetDecision> = {};
    const fleets = new Set<string>();
    for (const [id, record] of Object.entries(nodes)) {
      if (record.kind !== "fleet") continue;
      fleets.add(id);
      const mission = record.payload.mission;
      const found = decisionOf(mission, asks[id]);
      if (!found) continue;
      const held = before[id];
      const kept = held?.kind === found.kind && (found.at === undefined || held.since === found.at);
      const message = messageOf(found.kind, mission);
      next[id] = {
        kind: found.kind,
        since: kept ? held.since : (found.at ?? now()),
        ...(message ? { message } : {}),
        ...((kept ? held.standing : !known.has(id)) ? { standing: true } : {}),
      };
    }
    known = fleets;
    const ids = new Set([...Object.keys(before), ...Object.keys(next)]);
    if ([...ids].some((id) => !same(before[id], next[id]))) fleetDecisionsStore.setState({ decisions: next });
  };
  sync();
  const offNodes = nodesStore.subscribe(sync);
  const offAsks = leftoversStore.subscribe(sync);
  return () => {
    offNodes();
    offAsks();
  };
}
