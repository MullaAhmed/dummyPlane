import { useEffect, useRef } from "react";
import { createStore } from "zustand";
import type { ArrangeTarget } from "@/agents/arrangeAs";
import type { Point } from "@/agents/terminals";
import type { AgentId } from "@/ipc/pty";

/** Something a command asks a component on screen to do: edit a name, open its menu. */
export type UiRequest =
  | { kind: "renameWorkspace"; id: string }
  | { kind: "renameTerminal"; id: string }
  | { kind: "renameFleet"; id: string }
  /**
   * The ＋ menu opened by a command. `only: "agents"`: the ring's and the palette's "Other agent…" want the agents
   * alone, not the whole menu; the menu keeps it until it closes, so a sub-view's Back returns to them.
   */
  | { kind: "agentMenu"; view: "agents" | "options" | "ollama" | { install: AgentId }; only?: "agents"; at?: Point }
  | { kind: "composeGroup" }
  | { kind: "savePreset" }
  | { kind: "loops" }
  | { kind: "groupMenu"; id: string }
  /** The list of layouts of an "Arrange as…", at `at`, a point of the window. */
  | { kind: "arrangeMenu"; workspaceId: string; target: ArrangeTarget; at: Point };

type RequestOf<K extends UiRequest["kind"]> = Extract<UiRequest, { kind: K }>;

const requestStore = createStore<{ request: UiRequest | null }>()(() => ({ request: null }));

/** How long a request waits for its component: the panel it opens mounts well within it. */
const EXPIRY_MS = 2000;
let expiry: ReturnType<typeof setTimeout> | undefined;

/** An unanswered request expires: it must not fire at some later mount. */
export function requestUi(request: UiRequest) {
  clearTimeout(expiry);
  requestStore.setState({ request });
  expiry = setTimeout(() => requestStore.setState({ request: null }), EXPIRY_MS);
}

export function pendingUiRequest(): UiRequest | null {
  return requestStore.getState().request;
}

/**
 * Answers the requests of `kind` this component handles: `handle` returns
 * true when the request is for it, which consumes it. A request made just
 * before the component mounts (the agents panel opened by the same command)
 * is answered on mount.
 */
export function useUiRequest<K extends UiRequest["kind"]>(kind: K, handle: (request: RequestOf<K>) => boolean, enabled = true) {
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(() => {
    if (!enabled) return;
    const answer = () => {
      const { request } = requestStore.getState();
      if (request?.kind === kind && latest.current(request as RequestOf<K>)) requestStore.setState({ request: null });
    };
    answer();
    return requestStore.subscribe(answer);
  }, [kind, enabled]);
}
