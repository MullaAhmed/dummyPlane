import { QuietBoundary } from "@/components/ErrorBoundary";
import { useUi } from "@/store/ui";
import { CloseAgentDialog } from "./CloseAgentDialog";
import { CloseGroupDialog } from "./CloseGroupDialog";

/** Each new closing request asks its dialog again: one that failed tries again then. */
const useClosingAgents = () => useUi((s) => s.closing);
const useClosingGroup = () => useUi((s) => s.closingGroup);

/**
 * The project's confirmation dialogs: one that fails to render shows nothing, the project stays (spec première
 * version §3.4), and the next request tries it again.
 */
export function ProjectDialogs() {
  return (
    <>
      <QuietBoundary scope="close agent dialog" useResetKey={useClosingAgents}>
        <CloseAgentDialog />
      </QuietBoundary>
      <QuietBoundary scope="close group dialog" useResetKey={useClosingGroup}>
        <CloseGroupDialog />
      </QuietBoundary>
    </>
  );
}
