import { lazy, Suspense, useEffect } from "react";
import { Canvas } from "@/canvas/Canvas";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AgentsPanel } from "@/agents/AgentsPanel";
import { useAgentsPanel } from "@/agents/agentsPanelState";
import { useMessages } from "@/i18n";
import { agentsStore } from "@/agents/agentsStore";
import { LinkMode } from "@/agents/LinkMode";
import { Notes } from "@/notes/Notes";
import { RadialMenu } from "@/radial/RadialMenu";
import { GitWindow } from "@/git/GitWindow";
import { ReviewPanel } from "@/review/ReviewPanel";
import { PlacementGhost } from "@/agents/PlacementGhost";
import { useProjects } from "@/store/projects";
import { useWorkspaces } from "@/store/workspaces";
import { ActivityRail } from "./ActivityRail";
import { AgentCounts } from "./AgentCounts";
import { CommandBar, CommandHint } from "./CommandBar";
import { CrashNotice } from "./CrashNotice";
import { GitChip } from "./GitChip";
import { ModeExit } from "./ModeExit";
import { ProjectDialogs } from "./ProjectDialogs";
import { ProjectPicker } from "./ProjectPicker";
import { SearchField } from "./SearchField";
import { TitleBar } from "./TitleBar";
import { ToolRail } from "./ToolRail";
import { UpdateChip } from "./UpdateDialog";
import { UsageMeter } from "./UsageMeter";
import { WaitingNotice } from "./WaitingNotice";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { shellMessages } from "./messages";
import { ZoomControl } from "./ZoomControl";

// CodeMirror and its languages load with the first opening, not with the application.
const CodeWorkspace = lazy(() => import("@/studio/CodeWorkspace").then((m) => ({ default: m.CodeWorkspace })));
const NotesWorkspace = lazy(() => import("@/notes/NotesWorkspace"));

const SCOPES = { canvas: "canvas", code: "code workspace", notes: "notes workspace" } as const;

/** A floating panel's error, where the panels open. */
function panelCrash(error: Error, retry: () => void) {
  return (
    <div className="absolute right-3 top-[104px] z-40 w-80">
      <CrashNotice error={error} retry={retry} compact />
    </div>
  );
}

/**
 * The open project (spec identité §5): the canvas fills the window, under the
 * glass bars; everything else floats on it.
 */
export function ProjectView() {
  const t = useMessages(shellMessages);
  const status = useWorkspaces((s) => s.status);
  const error = useWorkspaces((s) => s.error);
  const activeId = useWorkspaces((s) => s.activeId);
  const kind = useWorkspaces((s) => s.workspaces.find((w) => w.id === s.activeId)?.kind ?? "canvas");
  const projectId = useProjects((s) => s.activeId);
  const canvas = kind === "canvas";
  const panelOpen = useAgentsPanel((s) => s.open);

  useEffect(() => {
    void agentsStore.getState().load();
  }, []);

  return (
    <div className="dp-ambient relative h-screen w-screen overflow-hidden">
      {status === "ready" && activeId ? (
        <>
          <ErrorBoundary
            key={activeId}
            scope={SCOPES[kind]}
            fallback={(error, retry) => (
              <div className="absolute inset-0 px-6 pb-6 pt-[104px]">
                <CrashNotice error={error} retry={retry} />
              </div>
            )}
          >
            {kind === "code" ? (
              <Suspense fallback={null}>
                <CodeWorkspace />
              </Suspense>
            ) : kind === "notes" ? (
              projectId && (
                <Suspense fallback={null}>
                  <NotesWorkspace projectId={projectId} />
                </Suspense>
              )
            ) : (
              <Canvas workspaceId={activeId} />
            )}
          </ErrorBoundary>
          {canvas && <ToolRail />}
          <ActivityRail />
          {panelOpen && (
            <ErrorBoundary scope="agents panel" fallback={panelCrash}>
              <AgentsPanel />
            </ErrorBoundary>
          )}
          <WaitingNotice />
          {/* The canvas's floating bars: the code and notes workspaces have their own. */}
          {canvas && (
            <>
              {/* 12 px from the bottom, as from the sides: one gutter around the canvas. */}
              <div className="absolute bottom-3 left-3 z-30">
                <GitChip />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex flex-col items-center gap-2">
                <CommandHint />
                <CommandBar />
              </div>
              <div className="absolute bottom-3 right-3 z-30">
                <ZoomControl />
              </div>
              <PlacementGhost />
              <LinkMode />
              <RadialMenu />
            </>
          )}
          <ModeExit />
          <ErrorBoundary scope="review" fallback={panelCrash}>
            <ReviewPanel />
            <GitWindow />
          </ErrorBoundary>
          <ErrorBoundary scope="notes" fallback={panelCrash}>
            <Notes />
          </ErrorBoundary>
        </>
      ) : (
        <div className="grid h-full place-items-center text-sm text-dp-text-2">
          {status === "error" ? t.projectView.loadFailed(String(error)) : t.loading}
        </div>
      )}
      <div className="absolute inset-x-0 top-0 z-30">
        <TitleBar
          leading={<ProjectPicker />}
          center={<SearchField />}
          trailing={
            <>
              <UpdateChip />
              <ErrorBoundary scope="usage" fallback={() => null}>
                <UsageMeter />
              </ErrorBoundary>
              <AgentCounts />
            </>
          }
        />
        <WorkspaceTabs />
      </div>
      <ProjectDialogs />
    </div>
  );
}
