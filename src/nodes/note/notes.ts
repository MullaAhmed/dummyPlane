import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { toast } from "sonner";
import { sceneAccess } from "@/agents/sceneAccess";
import { spawnTreeOf } from "@/agents/spawnLayout";
import { reflowSpawnTree, spawnedBy } from "@/agents/spawnTree";
import { revealNode } from "@/canvas/arrive";
import { canvasStore } from "@/canvas/canvasStore";
import type { Rect } from "@/canvas/groups";
import { createNodeElement, nodeKindOf } from "@/canvas/nodeElement";
import { allowRemoval } from "@/canvas/removalGuard";
import { messages } from "@/i18n";
import { nodesStore } from "@/store/nodes";
import { emptyNotesOf, linkFor, NOTE_HOSTS, noteChanges, notesByHost, notesClearOfNodes, relinkNotes, settleNotes, withNoteLink, type NoteLink } from "./link";
import { noteMessages } from "./messages";
import { newNoteRect } from "./placement";

/** The text of a note, "" for any other node or one missing. */
export function noteText(nodeId: string): string {
  const record = nodesStore.getState().nodes[nodeId];
  return record?.kind === "note" ? record.payload.text : "";
}

const hasText = (nodeId: string) => noteText(nodeId).trim() !== "";

/** Whether a node can have notes: a terminal or a Fleet. */
export function canHaveNotes(nodeId: string): boolean {
  const kind = nodesStore.getState().nodes[nodeId]?.kind;
  return kind !== undefined && NOTE_HOSTS.includes(kind);
}

const random = () => Math.floor(Math.random() * 2 ** 31);

/**
 * A new, empty note beside the terminal or the Fleet `hostId`, in one undo
 * step: right of it, under the notes it already has, clear of every other
 * node and group (src/nodes/note/placement.ts). Beside an agent of a spawn
 * tree (spawn_agent), it takes its place right of the agent and the tree is
 * laid out again around it, the agent's sub-agents moving right. On screen, it
 * comes into view and takes the keyboard. Its id, or null when the host is not
 * on a canvas.
 */
export async function addNote(hostId: string): Promise<string | null> {
  const record = nodesStore.getState().nodes[hostId];
  if (!record || !canHaveNotes(hostId) || !sceneAccess(record.workspaceId)) return null;
  const element = createNodeElement("note", { x: 0, y: 0 });
  // Its row before its element, as every node's: the scene's save keeps the rows of the nodes it holds.
  await nodesStore.getState().create(element.id, { workspaceId: record.workspaceId, kind: "note", payload: { text: "" } });
  // Read after the wait: the scene may have changed meanwhile, and the user may have left it.
  const scene = sceneAccess(record.workspaceId);
  const elements = scene?.elements() ?? [];
  const host = elements.find((e) => e.id === hostId && !e.isDeleted);
  if (!scene || !host) return null;
  // The rest of the host's spawn tree, and its notes, make way: laid out again below, they are not in the way.
  const tree = host.frameId ? null : spawnTreeOf(elements, spawnedBy, hostId);
  const others = tree && tree.ids.size > 1 ? [...tree.ids].filter((id) => id !== hostId) : [];
  const byHost = notesByHost(elements);
  const ignore = new Set([...others, ...others.flatMap((id) => (byHost.get(id) ?? []).map((n) => n.id))]);
  const rect = newNoteRect(elements, host, element, ignore);
  const note = {
    ...element,
    x: rect.x,
    y: rect.y,
    customData: withNoteLink(element.customData, linkFor(hostId, rect, host)),
    version: element.version + 1,
    versionNonce: random(),
  };
  scene.write([...elements, note]);
  if (others.length > 0) reflowSpawnTree(record.workspaceId, hostId);
  if (scene.shown) {
    revealNode(note.id);
    focusNote(note.id);
  }
  return note.id;
}

/** How many frames (about two seconds) a new note is offered the keyboard: it mounts once Excalidraw shows it. */
const FOCUS_FRAMES = 120;

/** Its text field, once mounted. */
function fieldOf(noteId: string): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(`[data-note="${CSS.escape(noteId)}"] textarea`);
}

/**
 * The note activated (the pointer reaches its text) and its text field given
 * the keyboard, on each of the next frames until it has it: the note mounts a
 * frame or more after its element arrives, the radial menu runs its command a
 * frame after it closes.
 */
export function focusNote(noteId: string, frames = FOCUS_FRAMES) {
  requestAnimationFrame(() => {
    const field = fieldOf(noteId);
    if (field) {
      activate(noteId);
      field.focus({ preventScroll: true });
      if (document.activeElement === field) return;
    }
    if (frames > 1) focusNote(noteId, frames - 1);
  });
}

/** Excalidraw lets the pointer into the active node only. */
function activate(noteId: string) {
  const api = canvasStore.getState().api;
  const element = api?.getSceneElements().find((e) => e.id === noteId);
  if (!api || !element) return;
  const active = api.getAppState().activeEmbeddable;
  if (active?.element === element && active.state === "active") return;
  api.updateScene({ appState: { activeEmbeddable: { element: element as NonDeletedExcalidrawElement & { type: "embeddable" }, state: "active" } } });
}

/** The ✕ of a note: gone in one undo step; with text, the toast offers it back (`onNodesGone`). */
export function deleteNote(noteId: string) {
  const api = canvasStore.getState().api;
  const elements = api?.getSceneElementsIncludingDeleted() ?? [];
  if (!api || !elements.some((e) => e.id === noteId && !e.isDeleted)) return;
  allowRemoval([noteId]);
  api.updateScene({
    elements: elements.map((e) => (e.id === noteId ? { ...e, isDeleted: true, version: e.version + 1, versionNonce: random(), updated: Date.now() } : e)),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** Deleted notes back where they were, in one undo step: the toast's Undo. Their rows are saved again as they come back. */
export function restoreNotes(workspaceId: string, ids: readonly string[]) {
  const scene = sceneAccess(workspaceId);
  if (!scene) return;
  const elements = scene.elements();
  const back = new Set(ids.filter((id) => elements.some((e) => e.id === id && e.isDeleted)));
  if (back.size === 0) return;
  scene.write(elements.map((e) => (back.has(e.id) ? { ...e, isDeleted: false, version: e.version + 1, versionNonce: random(), updated: Date.now() } : e)));
  // Off screen, no canvas brings their rows back.
  if (!scene.shown) back.forEach((id) => void nodesStore.getState().persist(id));
}

/** Whether a note holds no text (a node without a record counts as empty): it leaves with its host. */
export const isEmptyNote = (noteId: string) => !hasText(noteId);

/**
 * Nodes that left the canvas on screen (deleted, closed, undone): a note with
 * text is never lost unasked, so a toast offers the ones that went back; the
 * empty notes of a terminal or a Fleet that closed go with it, a frame later
 * and outside the undo history. A note with text stays where it was, alone
 * (an undo of the close brings its host back beside it).
 */
export function onNodesGone(workspaceId: string, ids: readonly string[]) {
  const nodes = nodesStore.getState().nodes;
  const written = ids.filter((id) => nodes[id]?.kind === "note" && hasText(id));
  if (written.length > 0) {
    const t = messages(noteMessages);
    toast(t.deleted(written.length), { action: { label: t.undo, onClick: () => restoreNotes(workspaceId, written) } });
  }
  const hosts = ids.filter((id) => canHaveNotes(id));
  if (hosts.length === 0) return;
  // Deferred: changing the scene from inside onChange would re-enter it.
  requestAnimationFrame(() => {
    const api = canvasStore.getState().api;
    const elements = api?.getSceneElementsIncludingDeleted() ?? [];
    // A host brought back meanwhile (an undo) keeps its notes.
    const gone = hosts.filter((id) => !elements.some((e) => e.id === id && !e.isDeleted));
    const empty = new Set(emptyNotesOf(elements, gone, isEmptyNote));
    if (!api || empty.size === 0) return;
    allowRemoval(empty);
    api.updateScene({
      elements: elements.map((e) => (empty.has(e.id) ? { ...e, isDeleted: true, version: e.version + 1, versionNonce: random(), updated: Date.now() } : e)),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  });
}

type Gesture = Pick<AppState, "selectedElementsAreBeingDragged" | "isResizing" | "isRotating">;

const busy = (appState: Gesture) => appState.selectedElementsAreBeingDragged || appState.isResizing || appState.isRotating;

/**
 * Watches the scene on screen, from its onChange, and keeps every note beside
 * its host (src/nodes/note/link.ts): a host dragged, resized, minimized, laid
 * out or brought back by an undo takes its notes along; a note moved by hand
 * keeps its new place. Decided between gestures only (during a drag the note
 * waits, then joins its host), applied a frame later outside the undo history:
 * an undo of the host's move takes the host back, and its notes follow again.
 */
export function createNoteWatch() {
  const seen = new Map<string, Rect>();
  const pending = new Map<string, NoteLink>();
  let frame: number | null = null;
  let lastVersion = -1;

  const apply = () => {
    frame = null;
    const api = canvasStore.getState().api;
    if (!api) return;
    const appState = api.getAppState();
    // A gesture began meanwhile: the change that ends it decides again.
    if (busy(appState)) return;
    const current = api.getSceneElementsIncludingDeleted();
    const next = notesClearOfNodes(settleNotes(relinkNotes(current, pending)));
    pending.clear();
    if (next === current) return;
    // Excalidraw knows its active node by the element object: a note being typed in stays active.
    const active = appState.activeEmbeddable;
    const replaced = active ? next.find((e) => e.id === active.element.id) : undefined;
    const keepActive = active && replaced && replaced !== active.element ? { activeEmbeddable: { ...active, element: replaced as typeof active.element } } : null;
    api.updateScene({ elements: next, ...(keepActive ? { appState: keepActive } : {}), captureUpdate: CaptureUpdateAction.NEVER });
  };

  return (elements: readonly ExcalidrawElement[], appState: Gesture, version: number) => {
    if (busy(appState)) {
      lastVersion = -1;
      return;
    }
    // A pan or a pointer move changes nothing here; a gesture's end always looks.
    if (version === lastVersion) return;
    lastVersion = version;
    for (const [id, link] of noteChanges(elements, seen)) pending.set(id, link);
    if (pending.size === 0 && notesClearOfNodes(settleNotes(elements)) === elements) return;
    frame ??= requestAnimationFrame(apply);
  };
}

/**
 * A note the user activated (a click in it): its text takes the keyboard, so a
 * note is typed in at the first click, not the second. Once per activation.
 */
export function createNoteActivation() {
  let last: string | null = null;
  return (active: AppState["activeEmbeddable"]) => {
    const id = active?.state === "active" && nodeKindOf(active.element) === "note" ? active.element.id : null;
    if (id === last) return;
    last = id;
    if (!id) return;
    requestAnimationFrame(() => {
      const field = fieldOf(id);
      if (field && !field.contains(document.activeElement)) field.focus({ preventScroll: true });
    });
  };
}
