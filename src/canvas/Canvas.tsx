import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { CaptureUpdateAction, Excalidraw, getSceneVersion, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { toastError } from "@/lib/errorToast";
import { usePalette, useTheme } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { completeArrival } from "@/commands/pendingArrival";
import { assignMissingNames } from "@/agents/naming";
import { dismissResumeOffer, offerResumeAll } from "@/agents/ResumeAllToast";
import { withSpawnedChildren } from "@/agents/spawnFamily";
import { createSpawnDragWatch, reflowSpawnTreesOf } from "@/agents/spawnTree";
import { arrangeWorkspace } from "@/agents/arrangeCanvas";
import { createAutoArrangeWatch } from "@/agents/autoArrange";
import { isMinimized } from "@/nodes/terminal/minimize";
import { adoptCopies } from "@/agents/terminals";
import { scheduleWireUpkeep } from "@/agents/wireUpkeep";
import { fleetLinks } from "@/agents/wires";
import { saveFiles, saveScene } from "@/ipc/db";
import { onFlushAll } from "@/lib/flush";
import { NodeHost } from "@/nodes/NodeHost";
import { noteHostsOf } from "@/nodes/note/link";
import { createNoteActivation, createNoteWatch, onNodesGone } from "@/nodes/note/notes";
import { releaseTeamPermission, setFleetClosed } from "@/mission/store";
import { disposeTerminal, focusTerminal } from "@/nodes/terminal/registry";
import { nodesStore } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { uiStore } from "@/store/ui";
import { setActiveTerminal } from "./activeTerminal";
import { createActivationTracker } from "./activation";
import { canvasStore, fullSizeView, viewFrom } from "./canvasStore";
import { installDoubleClickSelect } from "./doubleClickSelect";
import { scheduleEraserGuard } from "./eraserGuard";
import { framesFromScene } from "./groups";
import { drawnSelectionOf } from "./drawnSelection";
import { SelectionPanel } from "./SelectionPanel";
import { isDummyPlaneLink } from "./nodeElement";
import { classifyAddedNodes } from "./nodeCopies";
import { createRemovalGuard, type RemovalVerdict } from "./removalGuard";
import { pinCanvasScroll } from "./scrollPin";
import { DotGrid } from "./overlay/DotGrid";
import { GroupBackdrops } from "./overlay/GroupBackdrops";
import { GroupLabels } from "./overlay/GroupLabels";
import { StepTimelines } from "./overlay/StepTimelines";
import { WireActivity } from "./overlay/WireActivity";
import { wirePaths } from "./overlay/wirePaths";
import { loadScene, rememberScene, type LoadedScene } from "./sceneCache";
import { EXCALIDRAW_UI_OPTIONS, withSceneDefaults } from "./sceneDefaults";
import { sceneGone, sceneReady } from "./sceneReady";
import { createSceneDerivation } from "./sceneDerive";
import { createSceneSync, liveNodeIds, liveNodeRects } from "./sceneSync";
import { messages, useMessages } from "@/i18n";
import { canvasMessages } from "./messages";

const reportSaveError = (error: unknown) => toastError(messages(canvasMessages).saveFailed, { error });

/**
 * One Excalidraw instance per workspace; remounted (via `key`) when switching. A scene that
 * failed to load says why and offers to try again (a failed read is not kept: loadScene reads anew).
 */
export function Canvas({ workspaceId }: { workspaceId: string }) {
  const [scene, setScene] = useState<LoadedScene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const status = useRef<HTMLDivElement>(null);
  const t = useMessages(canvasMessages);

  useEffect(() => {
    let alive = true;
    loadScene(workspaceId).then(
      (loaded) => alive && setScene(loaded),
      (failure: unknown) => alive && setError(String(failure)),
    );
    return () => {
      alive = false;
    };
  }, [workspaceId, attempt]);

  const retry = () => {
    // The button goes with the error: the keyboard on it stays on the status that says "Loading…", not on the page's body.
    if (status.current?.contains(document.activeElement)) status.current.focus({ preventScroll: true });
    setError(null);
    setAttempt((n) => n + 1);
  };

  if (error)
    return (
      <Centered ref={status}>
        <div className="grid justify-items-center gap-3">
          <p>{t.loadFailed(error)}</p>
          <Button type="button" variant="secondary" size="sm" onClick={retry}>
            {t.retryLoad}
          </Button>
        </div>
      </Centered>
    );
  if (!scene) return <Centered ref={status}>{t.loading}</Centered>;
  return <LoadedCanvas workspaceId={workspaceId} scene={scene} />;
}

/** The canvas's place while it has no scene: the words said to screen readers too, and a place for the keyboard to wait. */
function Centered({ ref, children }: { ref?: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <div ref={ref} role="status" tabIndex={-1} className="absolute inset-0 grid place-items-center text-sm text-dp-text-2 outline-none">
      {children}
    </div>
  );
}

function LoadedCanvas({ workspaceId, scene }: { workspaceId: string; scene: LoadedScene }) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const theme = useTheme();
  const palette = usePalette();
  const initialData = useMemo(() => withSceneDefaults(scene.initialData), [scene]);
  // A running agent never leaves unasked; sceneSync tells which nodes left.
  const guardRemovals = useMemo(() => createRemovalGuard(isRunning, scene.initialData.elements ?? []), [scene]);
  const removedNow = useRef<string[]>([]);

  // The shell (rails, zoom, panels) drives the Excalidraw instance on screen.
  useEffect(() => {
    canvasStore.getState().setApi(api);
    return () => {
      if (canvasStore.getState().api === api) canvasStore.getState().setApi(null);
    };
  }, [api]);

  // Switching palettes recolors the wires still in the old accent (the scene's onChange does not fire between two dark palettes).
  useEffect(() => {
    if (api) scheduleWireUpkeep(api, api.getSceneElementsIncludingDeleted());
  }, [api, palette]);

  // A box scrolled under the canvas would leave Excalidraw's hit tests off by that much (after a resize).
  useEffect(() => (api ? pinCanvasScroll(api.refresh) : undefined), [api]);

  // A click or a double-click on a terminal or the Fleet selects it, whatever tool is active (a drag still draws or pans).
  useEffect(() => (api ? installDoubleClickSelect() : undefined), [api]);

  // A Ctrl+P target of this workspace waits for its scene to be on screen.
  useEffect(() => {
    if (!api) return;
    const frame = requestAnimationFrame(() => {
      completeArrival(workspaceId);
      sceneReady(workspaceId);
    });
    return () => {
      cancelAnimationFrame(frame);
      sceneGone(workspaceId);
    };
  }, [api, workspaceId]);

  // What the overlays and panels read of the scene, derived only when the scene (or the selection) changed: not per pan frame.
  const derive = useMemo(
    () =>
      createSceneDerivation({
        selection: (elements, selected) => canvasStore.getState().setDrawnSelection(drawnSelectionOf(elements, selected)),
        scene: (elements) => {
          const store = canvasStore.getState();
          store.setFrames(framesFromScene(elements));
          store.setNodeIds(liveNodeIds(elements));
          store.setNodeRects(liveNodeRects(elements));
          store.setLinks(fleetLinks(elements));
          store.setWires(wirePaths(elements));
          store.setNoteHosts(noteHostsOf(elements));
        },
      }),
    [],
  );

  // The next workspace must not show this one's groups before its first change.
  useEffect(
    () => () => {
      canvasStore.getState().setFrames([]);
      canvasStore.getState().setNodeIds([]);
      canvasStore.getState().setNodeRects({});
      canvasStore.getState().setLinks({});
      canvasStore.getState().setWires([]);
      canvasStore.getState().setDrawnSelection([]);
      canvasStore.getState().setNoteHosts({});
      // Emptied: the next change derives them again, even a pan's.
      derive.reset();
    },
    [derive],
  );

  const sync = useMemo(
    () =>
      createSceneSync(
        { elements: scene.initialData.elements ?? [], savedFileIds: scene.savedFileIds },
        {
          saveScene: (elementsJson, appStateJson, nodeIds) => saveScene(workspaceId, elementsJson, appStateJson, nodeIds),
          saveFiles: (files) => saveFiles(workspaceId, files),
          onSceneChanged: (elements, appState, files, savedFileIds) =>
            rememberScene(workspaceId, elements, appState, files, savedFileIds),
          // An undo can bring back a node whose row the last scene save purged.
          onNodesAdded: (ids) => {
            const elements = canvasStore.getState().api?.getSceneElementsIncludingDeleted() ?? [];
            const added = classifyAddedNodes(ids, elements, (id) => id in nodesStore.getState().nodes);
            // An undo can bring back a node whose row the last scene save purged.
            added.restored.forEach((id) => void nodesStore.getState().persist(id).catch(reportSaveError));
            // A closed fleet brought back takes its mission up again.
            added.restored.forEach((id) => setFleetClosed(id, false));
            // A spawned agent brought back takes its place in its tree again.
            reflowSpawnTreesOf(workspaceId, added.restored);
            if (added.copies.length) void adoptCopies(workspaceId, added.copies).catch(reportSaveError);
          },
          onNodesRemoved: (ids) => {
            removedNow.current = ids;
          },
        },
      ),
    [workspaceId, scene],
  );

  useEffect(() => {
    const unregister = onFlushAll(() => sync.flush());
    return () => {
      unregister();
      void sync.flush()?.catch(reportSaveError);
    };
  }, [sync]);

  // Terminals saved before plan A have no name yet.
  useEffect(() => {
    void assignMissingNames(workspaceId, liveNodeIds(scene.initialData.elements ?? [])).catch(reportSaveError);
  }, [workspaceId, scene]);

  // After the scene is shown, restored terminals have their status.
  useEffect(() => {
    const timer = setTimeout(() => offerResumeAll(workspaceId), 800);
    return () => {
      clearTimeout(timer);
      dismissResumeOffer(workspaceId);
    };
  }, [workspaceId]);

  const trackActivation = useMemo(() => createActivationTracker(), []);
  const watchSpawnDrags = useMemo(() => createSpawnDragWatch(workspaceId), [workspaceId]);
  // Quick notes stay beside their terminal or Fleet as it moves, and take the keyboard when clicked (src/nodes/note).
  const watchNotes = useMemo(() => createNoteWatch(), []);
  const activateNote = useMemo(() => createNoteActivation(), []);
  // Auto-arrange: a node opened or closed, a terminal minimized or expanded, and the canvas tidies itself.
  const watchLayout = useMemo(() => createAutoArrangeWatch({ isMinimized, arrange: () => arrangeWorkspace(workspaceId, { undoable: false }) }), [workspaceId]);
  useEffect(() => () => watchLayout.dispose(), [watchLayout]);

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      const version = getSceneVersion(elements);
      sync.onChange(elements, appState, files, version);
      const verdict = guardRemovals(elements, removedNow.current);
      removedNow.current = [];
      settleRemovals(verdict);
      // A note with text that left is offered back; a closed terminal's empty notes go with it.
      onNodesGone(workspaceId, verdict.dispose);
      // A closed spawned agent's tree closes up (flowchart layout).
      reflowSpawnTreesOf(workspaceId, verdict.dispose);
      watchSpawnDrags(elements, appState);
      watchLayout(elements, appState);
      watchNotes(elements, appState, version);
      activateNote(appState.activeEmbeddable);
      canvasStore.getState().setView(viewFrom(appState));
      derive(elements, version, appState.selectedElementIds);
      if (api) scheduleWireUpkeep(api, elements);
      // The eraser never erases a node: with it active, the nodes are locked, which it skips.
      if (api) scheduleEraserGuard(api, elements, appState.activeTool.type === "eraser");
      const activated = trackActivation(appState.activeEmbeddable);
      if (activated) setActiveTerminal(activated);
      // Deferred: changing the view from inside onChange would re-enter it.
      if (activated && api) requestAnimationFrame(() => showAtFullSize(api, activated));
    },
    [sync, guardRemovals, trackActivation, watchSpawnDrags, watchLayout, watchNotes, activateNote, derive, workspaceId, api],
  );

  return (
    <div className="absolute inset-0">
      <DotGrid />
      <GroupBackdrops />
      <GroupLabels />
      <StepTimelines />
      <div className="absolute inset-0">
        <Excalidraw
          theme={theme}
          excalidrawAPI={setApi}
          initialData={initialData}
          onChange={onChange}
          UIOptions={EXCALIDRAW_UI_OPTIONS}
          validateEmbeddable={isDummyPlaneLink}
          renderEmbeddable={(element) => <NodeHost element={element} />}
        />
      </div>
      <WireActivity />
      <SelectionPanel />
    </div>
  );
}

/**
 * Spec §6.3: an activated terminal is shown at 100 %, where xterm text is sharp
 * and mouse selection lines up; the view is only moved when it was zoomed.
 */
function showAtFullSize(api: ExcalidrawImperativeAPI, nodeId: string) {
  focusTerminal(nodeId);
  if (api.getAppState().zoom.value === 1) return;
  const element = api.getSceneElements().find((e) => e.id === nodeId);
  if (!element) return;
  api.updateScene({ appState: fullSizeView(element, api.getAppState()) });
}

/**
 * Frees the terminals that may go; puts back the running agents that left
 * unasked, as they were and outside the undo history, then asks.
 */
function settleRemovals({ dispose, restore, ask }: RemovalVerdict) {
  for (const id of dispose) {
    if (nodesStore.getState().nodes[id]?.kind === "fleet") {
      setFleetClosed(id, true);
      releaseTeamPermission(id);
    }
    disposeTerminal(id);
  }
  if (restore.length === 0) return;
  // Deferred: changing the scene from inside onChange would re-enter it.
  requestAnimationFrame(() => {
    const api = canvasStore.getState().api;
    if (!api) return;
    const current = api.getSceneElementsIncludingDeleted();
    const now = new Map(current.map((e) => [e.id, e]));
    // The earlier state, its version above the one it replaces.
    const back = new Map(restore.map((e) => [e.id, { ...newElementWith(e, {}, true), version: Math.max(e.version, now.get(e.id)?.version ?? 0) + 1 }]));
    api.updateScene({
      elements: [...current.map((e) => back.get(e.id) ?? e), ...restore.filter((e) => !now.has(e.id)).map((e) => back.get(e.id)!)],
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    if (ask && "group" in ask) uiStore.getState().setClosingGroup(ask.group);
    else if (ask) uiStore.getState().setClosing(withSpawnedChildren(ask));
  });
}

