import { openLogDir } from "@/app/logs";
import { Button } from "@/components/ui/button";
import { relaunchTerminal } from "@/nodes/terminal/registry";
import { nodesStore } from "@/store/nodes";
import { useMessages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";

/**
 * Over a fleet refused for lack of dummyPlane's tools: why, and a new attempt. The terminal's
 * body stays dark in every palette, calm's green included, where the text
 * roles are green too (1.3:1): the message sits on a surface card, where every
 * text role and the focus ring keep their tested contrast.
 */
export function ToolsUnavailable({ nodeId, message }: { nodeId: string; message: string }) {
  const t = useMessages(nodesMessages).toolsUnavailable;
  const retry = () => {
    const record = nodesStore.getState().nodes[nodeId];
    const session = record?.kind === "fleet" ? record.payload.session : undefined;
    if (session) void relaunchTerminal(nodeId, session, session.claudeSessionId ? "resume" : "new");
  };
  return (
    <div role="alert" className="absolute inset-0 z-10 grid place-items-center bg-dp-terminal p-4">
      <div className="flex max-w-sm flex-col items-center gap-2 rounded-lg border border-dp-line bg-dp-surface p-4 text-center">
        <p className="text-(length:--text-ui) font-medium text-dp-text">{t.title}</p>
        <p className="text-xs text-dp-text-2">{message}</p>
        <p className="text-xs text-dp-text-2">{t.consequence}</p>
        <div className="flex flex-wrap justify-center gap-1.5">
          <Button variant="outline" size="sm" onClick={retry}>
            {t.retry}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void openLogDir()}>
            {t.openLogs}
          </Button>
        </div>
      </div>
    </div>
  );
}
