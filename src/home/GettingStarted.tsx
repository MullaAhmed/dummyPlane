import { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { useAgents } from "@/agents/agentsStore";
import { loadDiagnostics } from "@/app/diagnostics";
import { useMessages } from "@/i18n";
import { keyLabel } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { homeMessages } from "./messages";
import { NoAgent } from "./NoAgent";

const GIT_DOWNLOAD = "https://git-scm.com/download/win";

/** Whether a coding agent is installed, once the agents are known; null before. */
export function useHasAgent(): boolean | null {
  const loaded = useAgents((s) => s.loaded);
  const hasAgent = useAgents((s) => s.agents.some((a) => a.available && a.id !== "shell" && a.id !== "custom"));
  return loaded ? hasAgent : null;
}

/** Whether "Getting started" shows: the agents known (it would flash on every start), and one of its steps left. */
export const gettingStartedShown = (hasAgent: boolean | null, hasProject: boolean) => hasAgent !== null && !(hasAgent && hasProject);

/** Whether Git is missing, asked once while the project step waits: only then does "No Git? Install it" show. */
function useGitMissing(asking: boolean): boolean {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!asking) return;
    let alive = true;
    loadDiagnostics().then(
      (d) => {
        if (alive) setMissing(d?.git === null);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [asking]);
  return missing;
}

/**
 * "Getting started" (spec first version §7.2): while no project exists or
 * no coding agent is installed, three steps and their state.
 */
export function GettingStarted({ hasProject }: { hasProject: boolean }) {
  const t = useMessages(homeMessages).start;
  const hasAgent = useHasAgent();
  const gitMissing = useGitMissing(!hasProject);
  if (!gettingStartedShown(hasAgent, hasProject)) return null;
  const steps = [
    { id: "agent", title: t.installAgent, hint: t.installAgentHint, done: hasAgent === true },
    { id: "project", title: t.addProject, hint: t.addProjectHint, done: hasProject },
    { id: "launch", title: t.launch, hint: t.launchHint(keyLabel("Ctrl+K")), done: false },
  ];
  return (
    <section data-getting-started className="dp-glass-strong mb-6 rounded-xl p-6">
      <h2 className="mb-4 text-sm font-medium text-dp-text">{t.title}</h2>
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.id} data-step={step.id} data-done={String(step.done)} className="flex items-start gap-3">
            {/* The step's number in a quiet hairline circle; a done step, its tick in the positive colour. */}
            <span
              className={cn(
                "grid size-6 shrink-0 rounded-full place-items-center border font-mono text-xs tabular-nums",
                step.done ? "border-transparent bg-dp-ok/15 text-dp-ok" : "border-dp-line text-dp-text-2",
              )}
            >
              {step.done ? (
                <>
                  <Check className="size-3.5" aria-hidden />
                  <span className="sr-only">{t.done}</span>
                </>
              ) : (
                i + 1
              )}
            </span>
            <div className="min-w-0">
              <p className={cn("text-(length:--text-ui) font-medium", step.done ? "text-dp-text-3 line-through" : "text-dp-text")}>{step.title}</p>
              <p className="text-xs text-dp-text-2">{step.hint}</p>
              {step.id === "project" && !step.done && gitMissing && (
                <Button
                  variant="ghost"
                  size="xs"
                  data-link
                  onClick={() => void openUrl(GIT_DOWNLOAD)}
                  className="-mx-2 mt-1 px-2 font-normal text-dp-accent-ink hover:text-dp-accent-ink"
                >
                  {t.installGit} <ExternalLink />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!hasAgent && <NoAgent />}
    </section>
  );
}
