import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMessages } from "@/i18n";
import { npmAvailable, refreshPath, type AgentId } from "@/ipc/pty";
import { Button } from "@/components/ui/button";
import { AccentButton } from "@/shell/buttons";
import { SHELL_LABELS } from "@/nodes/terminal/launch";
import { AGENTS } from "./catalog";
import { AGENT_INSTALLS } from "./installCommands";
import { agentsMessages } from "./messages";

const NODE_DOWNLOAD = "https://nodejs.org/en/download";

/** The way back to the agent list: quiet text whose hover fill reaches past it, the text staying in place. */
export const BACK = "-ml-1.5 gap-2 self-start rounded-md px-1.5 font-normal text-dp-text-2 hover:text-dp-text";
/** A text link of these steps: the ink, underlined on hover, sized by its text. */
export const LINK = "h-auto gap-1 rounded-sm p-0 text-xs font-normal text-dp-accent-ink";

/** The whole command, read before the click that runs it (spec installation §2). */
export function InstallPrompt({ agent, onBack, onRun }: { agent: AgentId; onBack: () => void; onRun: () => void }) {
  const t = useMessages(agentsMessages).install;
  const install = AGENT_INSTALLS[agent];
  const needsNode = install?.needsNode ?? false;
  const [npmMissing, setNpmMissing] = useState(false);

  // PATH is read again first: Node.js may just have been installed. A failed look proves nothing and blocks nothing.
  const lookForNpm = () =>
    refreshPath()
      .then(npmAvailable)
      .then(
        (found) => setNpmMissing(!found),
        () => setNpmMissing(false),
      );

  useEffect(() => {
    if (needsNode) void lookForNpm();
  }, [needsNode]);

  if (!install) return null;
  return (
    <div data-install-prompt={agent} className="grid gap-2 p-1">
      <Button type="button" variant="ghost" size="xs" onClick={onBack} className={BACK}>
        <ArrowLeft className="size-3.5" /> {t.installAgent(AGENTS[agent].label)}
      </Button>
      <p className="text-xs text-dp-text-2">{t.runsIn(SHELL_LABELS[install.shell])}</p>
      <code className="block rounded-md bg-dp-field px-2 py-1.5 font-mono text-xs break-all text-dp-text">{install.command}</code>
      {needsNode && !npmMissing && <p className="text-xs text-dp-text-2">{t.needsNode}</p>}
      {npmMissing && (
        <div className="grid justify-items-start gap-1">
          <p className="text-xs text-dp-danger">{t.npmMissing}</p>
          <Button type="button" variant="link" data-link onClick={() => void openUrl(NODE_DOWNLOAD)} className={LINK}>
            {t.getNode} <ExternalLink className="size-3.5" />
          </Button>
          <Button type="button" variant="link" onClick={() => void lookForNpm()} className={LINK}>
            {t.recheck}
          </Button>
        </div>
      )}
      <Button type="button" variant="link" data-link onClick={() => void openUrl(install.docs)} className={LINK}>
        {t.officialPage} <ExternalLink className="size-3.5" />
      </Button>
      <AccentButton onClick={onRun} disabled={npmMissing}>
        {t.run}
      </AccentButton>
    </div>
  );
}
