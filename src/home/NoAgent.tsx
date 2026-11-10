import { useState } from "react";
import { Copy, Download, ExternalLink, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { agentsStore } from "@/agents/agentsStore";
import { AGENTS, agentInk } from "@/agents/catalog";
import { AGENT_INSTALLS } from "@/agents/installCommands";
import { InstallPrompt } from "@/agents/InstallPrompt";
import { useMessages } from "@/i18n";
import type { AgentId } from "@/ipc/pty";
import { cn } from "@/lib/utils";
import { AccentButton } from "@/shell/buttons";
import { recentProject, useProjects } from "@/store/projects";
import { installFromHome } from "./installFromHome";
import { homeMessages } from "./messages";

const CLAUDE = AGENT_INSTALLS.claude!;
const OTHERS = (Object.keys(AGENT_INSTALLS) as AgentId[]).filter((id) => id !== "claude");

/** A quiet text action: 28 px, its icons in the secondary text role. */
const linkClass = "gap-1.5 px-2 text-xs font-normal [&_svg]:text-dp-text-2";

/** "No code agent found": Claude Code first, then the others (spec installation §4.2). */
export function NoAgent() {
  const t = useMessages(homeMessages).noAgent;
  const [checking, setChecking] = useState(false);
  const [asked, setAsked] = useState<AgentId | null>(null);
  const project = useProjects((s) => recentProject(s.projects));
  const claude = AGENTS.claude;

  const copy = () =>
    void navigator.clipboard.writeText(CLAUDE.command).then(
      () => toast(t.copied),
      () => toast.error(t.copyFailed),
    );
  const install = (agent: AgentId) => {
    setAsked(null);
    void installFromHome(agent);
  };
  const recheck = async () => {
    setChecking(true);
    try {
      await agentsStore.getState().recheck();
    } catch (error) {
      toast.error(t.recheckFailed(String(error)));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div data-no-agent className="mt-6 border-t border-dp-line pt-6">
      <p className="font-medium text-dp-text">{t.title}</p>
      <p className="mb-4 text-sm text-dp-text-2">{t.hint}</p>
      <div className="rounded-lg border border-dp-line bg-dp-card p-4">
        <div className="flex items-center gap-2">
          <claude.Icon className="size-4" style={{ color: agentInk(claude.tint) }} />
          <span className="text-(length:--text-ui) font-medium text-dp-text">Claude Code</span>
          {/* A quiet text badge: the one recommendation of the screen. */}
          <span className="rounded-sm border border-dp-line px-1.5 text-xs leading-5 text-dp-text-2">{t.recommended}</span>
        </div>
        <p className="mt-1 text-xs text-dp-text-2">{t.claudeWhy}</p>
        <p className="mt-3 text-xs text-dp-text-2">{t.claudeHow}</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-dp-hover px-2 py-1.5 font-mono text-xs text-dp-text">{CLAUDE.command}</code>
          <Button variant="ghost" size="sm" onClick={copy} className={linkClass}>
            <Copy /> {t.copy}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <AccentButton onClick={() => install("claude")}>
            <Download /> {t.installAgent("Claude Code")}
          </AccentButton>
          <Button variant="ghost" size="sm" data-link onClick={() => void openUrl(CLAUDE.docs)} className={cn(linkClass, "text-dp-accent-ink hover:text-dp-accent-ink")}>
            {t.guide} <ExternalLink />
          </Button>
        </div>
      </div>
      <p className="mt-4 mb-1 text-xs text-dp-text-2">{t.others}</p>
      <ul className="-ml-2 flex flex-wrap gap-1">
        {OTHERS.map((id) => {
          const agent = AGENTS[id];
          return (
            <li key={id} className="flex items-center gap-1">
              <Button variant="ghost" size="sm" data-link onClick={() => void openUrl(AGENT_INSTALLS[id]!.docs)} className={linkClass}>
                <agent.Icon style={{ color: agentInk(agent.tint) }} /> {agent.label} <ExternalLink />
              </Button>
              <Button
                variant="outline"
                size="sm"
                data-install={id}
                aria-label={t.installAgent(agent.label)}
                onClick={() => setAsked(id)}
                className="px-2 text-xs font-normal"
              >
                {t.install}
              </Button>
            </li>
          );
        })}
      </ul>
      {asked && (
        <div className="mt-2 max-w-md rounded-lg border border-dp-line bg-dp-card p-2">
          <InstallPrompt key={asked} agent={asked} onBack={() => setAsked(null)} onRun={() => install(asked)} />
        </div>
      )}
      <p className="mt-3 text-xs text-dp-text-2">{project ? t.opensIn(project.name) : t.asksFolder}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <AccentButton onClick={() => void recheck()} disabled={checking}>
          <RefreshCw className={checking ? "animate-spin" : undefined} /> {t.recheck}
        </AccentButton>
        <p className="text-xs text-dp-text-2">{t.recheckHint}</p>
      </div>
    </div>
  );
}
