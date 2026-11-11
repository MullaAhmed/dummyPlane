import { useEffect } from "react";
import { boot } from "@/app/boot";
import { GoToLine } from "@/studio/GoToLine";
import { QuitPrompt } from "@/studio/QuitPrompt";
import { Palette } from "@/commands/Palette";
import { LoopsDialog } from "@/loops/LoopsDialog";
import { LoopsIndicator } from "@/loops/LoopsIndicator";
import { SavePresetDialog } from "@/presets/SavePresetDialog";
import { appMessages } from "@/app/messages";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { usePendingConfirm } from "@/components/confirm";
import { FleetAgentDialog } from "@/fleet/FleetAgentDialog";
import { QuietBoundary } from "@/components/ErrorBoundary";
import { HINT_DELAY_MS, TooltipProvider } from "@/components/ui/tooltip";
import { HomeScreen } from "@/home/HomeScreen";
import { AppToaster } from "@/shell/AppToaster";
import { ProjectView } from "@/shell/ProjectView";
import { StatusScreen } from "@/shell/StatusScreen";
import { TroubleshootingDialog } from "@/shell/TroubleshootingDialog";
import { UpdateDialog } from "@/shell/UpdateDialog";
import { AccountsDialog } from "@/accounts/AccountsDialog";
import { useMessages } from "@/i18n";
import { projectsStore, useProjects } from "@/store/projects";
import { usePalette } from "@/commands/paletteState";
import { accountsStore, useAccounts } from "@/accounts/store";
import { updatesStore, useUpdates } from "@/app/updates";
import { useFleetAgent } from "@/fleet/fleetAgent";
import { useStudio } from "@/studio/studioStore";
import { troubleshootStore, useTroubleshoot } from "@/shell/troubleshoot";
import { errorDetail } from "@/lib/errorToast";

/** What asks each dialog again: read by its own boundary, never here, so App does not re-render on each. */
const usePaletteOpenings = () => usePalette((s) => s.openings);
const useAccountsOpen = () => useAccounts((s) => s.open);
const useQuitting = () => useStudio((s) => s.quitting);
const useUpdateDialogOpen = () => useUpdates((s) => s.dialogOpen);
const useTroubleshootingOpen = () => useTroubleshoot((s) => s.open);
const useFleetAgentAsked = () => useFleetAgent((s) => s.asking);

/** A dialog that failed while open cannot close itself: its flag is cleared, so the next request is a change again. */
const closeAccounts = () => accountsStore.setState({ open: false });
const closeUpdate = () => updatesStore.setState({ dialogOpen: false });
const closeTroubleshooting = () => troubleshootStore.setState({ open: false });

export default function App() {
  const t = useMessages(appMessages);
  const view = useProjects((s) => s.view);
  const error = useProjects((s) => s.error);

  useEffect(() => {
    boot().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("start failed", error);
      // The sentence is built where it shows, as for a failed read of the projects (projectsStore.init).
      projectsStore.setState({ view: "error", error: message });
    });
  }, []);

  return (
    <TooltipProvider delayDuration={HINT_DELAY_MS}>
      {view === "home" && <HomeScreen />}
      {view === "project" && <ProjectView />}
      {view === "loading" && <StatusScreen message={t.loading} />}
      {view === "error" && <StatusScreen failed message={t.startFailed} detail={errorDetail(error)} />}
      {/* A dialog that failed once shows nothing; it tries again the next time it is asked for (its key changes). */}
      <QuietBoundary scope="palette" useResetKey={usePaletteOpenings}>
        <Palette />
      </QuietBoundary>
      {/* Presets, loops and Go to line open from the palette (or its shortcuts): its next opening tries them again. */}
      <QuietBoundary scope="presets dialog" useResetKey={usePaletteOpenings}>
        <SavePresetDialog />
      </QuietBoundary>
      <QuietBoundary scope="accounts dialog" useResetKey={useAccountsOpen} onError={closeAccounts}>
        <AccountsDialog />
      </QuietBoundary>
      <QuietBoundary scope="loops" useResetKey={usePaletteOpenings}>
        <LoopsDialog />
        <LoopsIndicator />
      </QuietBoundary>
      <QuietBoundary scope="go to line" useResetKey={usePaletteOpenings}>
        <GoToLine />
      </QuietBoundary>
      <QuietBoundary scope="unsaved files" useResetKey={useQuitting}>
        <QuitPrompt />
      </QuietBoundary>
      <QuietBoundary scope="update dialog" useResetKey={useUpdateDialogOpen} onError={closeUpdate}>
        <UpdateDialog />
      </QuietBoundary>
      <QuietBoundary scope="troubleshooting dialog" useResetKey={useTroubleshootingOpen} onError={closeTroubleshooting}>
        <TroubleshootingDialog />
      </QuietBoundary>
      <QuietBoundary scope="confirmation dialog" useResetKey={usePendingConfirm}>
        <ConfirmDialog />
      </QuietBoundary>
      <QuietBoundary scope="fleet agent dialog" useResetKey={useFleetAgentAsked}>
        <FleetAgentDialog />
      </QuietBoundary>
      <AppToaster />
    </TooltipProvider>
  );
}
