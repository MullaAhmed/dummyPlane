/**
 * Which terminals draw with WebGL.
 *
 * Every xterm used to load its WebGL renderer when first shown and keep it for
 * the session: Excalidraw keeps an embeddable mounted once it has been on
 * screen, and a terminal outlives its workspace's canvas (registry.ts). A
 * browser keeps about 16 WebGL contexts per page; one more makes it lose the
 * oldest, often a terminal on screen, which xterm leaves blank for 3 s before it
 * falls back to its DOM renderer ("webgl context not restored; firing
 * onContextLoss" in the log, in bursts once a workspace holds a few dozen
 * terminals).
 *
 * Here at most `cap` terminals hold a context: those on screen, the most
 * recently shown first. One that leaves the screen keeps its context until a
 * terminal on screen needs the slot, so panning back and forth creates none
 * again. Contexts are made once the view is still (`settleMs` after the last
 * change), one per turn: a context and its glyph atlas cost the main thread a
 * frame or more, never in the middle of a pan. The other terminals draw with
 * xterm's DOM renderer; both draw the same buffer, scrollback included.
 */

/** Below the browser's 16, with room for a context lost late. */
export const WEBGL_CAP = 12;
/** How long the view stays still before contexts are made. */
export const WEBGL_SETTLE_MS = 300;
/** Between two contexts made in a row: input waiting meanwhile is handled. */
export const NEXT_GRANT_MS = 16;

export interface WebglPoolDeps {
  cap?: number;
  settleMs?: number;
  /** Gives the terminal its WebGL renderer; false when WebGL is not available here. */
  attach: (id: string) => boolean;
  /** Takes it back and frees its context: the terminal draws with the DOM renderer. */
  detach: (id: string) => void;
}

export interface WebglPool {
  /** The terminal is on screen (true) or not (false). */
  show: (id: string, onScreen: boolean) => void;
  /** The view moves: a context waiting to be made waits until it is still. */
  busy: () => void;
  /** Its context was lost and its renderer dropped: the slot is free, and it asks again once shown anew. */
  lost: (id: string) => void;
  /** The terminal is gone: its context is freed. */
  forget: (id: string) => void;
  /** The terminals holding a context, the least recently shown first. */
  holders: () => string[];
}

export function createWebglPool(deps: WebglPoolDeps): WebglPool {
  const cap = deps.cap ?? WEBGL_CAP;
  const settleMs = deps.settleMs ?? WEBGL_SETTLE_MS;
  // Both least recently shown first: a Set keeps the order of insertion.
  const shown = new Set<string>();
  const holding = new Set<string>();
  let unavailable = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** The terminal on screen without a context that was shown last. */
  function waiting(): string | undefined {
    let last: string | undefined;
    for (const id of shown) if (!holding.has(id)) last = id;
    return last;
  }

  function schedule(ms: number) {
    clearTimeout(timer);
    timer = undefined;
    if (!unavailable && waiting() !== undefined) timer = setTimeout(grant, ms);
  }

  function grant() {
    timer = undefined;
    const id = waiting();
    if (id === undefined || unavailable) return;
    if (holding.size >= cap) {
      const victim = [...holding].find((held) => !shown.has(held));
      // Every holder is on screen: this one keeps the DOM renderer until one leaves.
      if (victim === undefined) return;
      holding.delete(victim);
      deps.detach(victim);
    }
    if (!deps.attach(id)) {
      unavailable = true;
      return;
    }
    holding.add(id);
    schedule(NEXT_GRANT_MS);
  }

  return {
    show(id, onScreen) {
      if (onScreen) {
        if (shown.has(id)) return;
        shown.add(id);
        if (holding.has(id)) {
          // Back on screen with its context: it is now the last one to give it up.
          holding.delete(id);
          holding.add(id);
          return;
        }
        schedule(settleMs);
      } else if (shown.delete(id)) {
        // A terminal on screen without a context may now take this one's.
        schedule(settleMs);
      }
    },
    busy() {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = setTimeout(grant, settleMs);
    },
    lost(id) {
      holding.delete(id);
      // Not again in the same turn: a context lost at once would be made again at once.
      shown.delete(id);
      schedule(settleMs);
    },
    forget(id) {
      shown.delete(id);
      if (holding.delete(id)) deps.detach(id);
      schedule(settleMs);
    },
    holders: () => [...holding],
  };
}
