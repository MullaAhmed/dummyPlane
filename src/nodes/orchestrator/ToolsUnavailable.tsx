import { openLogDir } from "@/app/logs";
import { Button } from "@/components/ui/button";
import { relaunchTerminal } from "@/nodes/terminal/registry";
import { nodesStore } from "@/store/nodes";
import { useMessages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";

/**
 * Over an orchestrator refused for lack of dummyPlane's tools (spec première
 * version §4.1, spec orchestrateur §9): why, and a new attempt.
 */
export function ToolsUnavailable({ nodeId, message }: { nodeId: string; message: string }) {
  const t = useMessages(nodesMessages).toolsUnavailable;
  const retry = () => {
    const record = nodesStore.getState().nodes[nodeId];
    const session = record?.kind === "orchestrator" ? record.payload.session : undefined;
    if (session) void relaunchTerminal(nodeId, session, session.claudeSessionId ? "resume" : "new");
  };
  return (
    <div role="alert" className="absolute inset-0 z-10 grid place-items-center bg-dp-terminal p-4">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        <p className="text-[13px] font-semibold text-dp-text">{t.title}</p>
        <p className="text-xs text-dp-text-2">{message}</p>
        <p className="text-xs text-dp-text-2">{t.consequence}</p>
        <div className="flex flex-wrap justify-center gap-1.5">
          <Button variant="outline" size="sm" onClick={retry} className="border-dp-line bg-transparent text-dp-text hover:bg-dp-hover">
            {t.retry}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void openLogDir()} className="border-dp-line bg-transparent text-dp-text hover:bg-dp-hover">
            {t.openLogs}
          </Button>
        </div>
      </div>
    </div>
  );
}
