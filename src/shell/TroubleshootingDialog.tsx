import { useState, type ReactNode } from "react";
import { BookOpen, Bug, CircleCheck, CircleAlert, Copy, FileText, FolderOpen, RefreshCw } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { toastError } from "@/lib/errorToast";
import { diagnosticText, guideUrl, issueUrl, openDataDir } from "@/app/diagnostics";
import { openLogDir } from "@/app/logs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AGENTS } from "@/agents/catalog";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { AccentButton, QuietButton } from "./buttons";
import { shellMessages } from "./messages";
import { checkAgain, troubleshootStore, useTroubleshoot } from "./troubleshoot";

/** The dialog's tools: hairline buttons, one size, their icons in the secondary text role. */
const secondaryButton = "bg-transparent font-normal [&_svg]:text-dp-text-2";

/** One check of the dialog: its state, what was found, and why it matters when missing. */
function Check({ id, ok, label, value, hint, plain = false }: { id: string; ok: boolean; label: string; value: ReactNode; hint?: string; plain?: boolean }) {
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <div data-check={id} className="flex items-start gap-2">
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", ok ? "text-dp-ok" : "text-dp-wait")} />
      <div className="min-w-0">
        <p className="text-dp-text">
          {label} · <span className={plain ? "text-dp-text-2" : "font-mono text-xs text-dp-text-2"}>{value}</span>
        </p>
        {hint && <p className="text-xs text-dp-text-2">{hint}</p>}
      </div>
    </div>
  );
}

/** Troubleshooting: what dummyPlane sees, and where to go from there. */
export function TroubleshootingDialog() {
  const t = useMessages(shellMessages).troubleshoot;
  const { open, diagnostics: d, error } = useTroubleshoot((s) => s);
  const [checking, setChecking] = useState(false);

  const recheck = async () => {
    setChecking(true);
    await checkAgain();
    setChecking(false);
  };
  const copy = () => {
    if (d)
      void navigator.clipboard.writeText(diagnosticText(d)).then(
        () => toast(t.copied),
        () => toastError(t.copyFailed),
      );
  };
  const report = async () => void openUrl(issueUrl(d?.version ?? (await getVersion())));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && troubleshootStore.setState({ open: false })}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-dp-danger">{t.failed(error)}</p>}
        {!d && !error && <p className="text-sm text-dp-text-2">{t.loading}</p>}
        {d && (
          <div className="grid gap-3 text-(length:--text-ui)">
            <p className="text-dp-text">
              dummyPlane {d.version} <span className="text-dp-text-2">· {d.os}</span>
            </p>
            <div>
              <p className="dp-label mb-1">{t.agents}</p>
              <ul className="grid gap-0.5">
                {d.agents.map((a) => (
                  <li key={a.id} data-agent={a.id} className="flex items-baseline gap-2">
                    <span className={cn("w-20 shrink-0", a.path ? "text-dp-text" : "text-dp-text-2")}>{AGENTS[a.id]?.label ?? a.id}</span>
                    {a.path ? (
                      <span className="truncate font-mono text-xs text-dp-text-2" title={a.path}>
                        {a.path}
                      </span>
                    ) : (
                      <span className="text-xs text-dp-text-2">{t.notFound}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <Check id="git" ok={d.git !== null} label="Git" value={d.git ?? t.notFound} hint={d.git ? undefined : t.gitMissing} />
            <Check id="gitBash" ok={d.gitBash !== null} label="Git Bash" value={d.gitBash ?? t.notFound} hint={d.gitBash ? undefined : t.gitBashMissing} />
            <Check id="server" plain ok={d.server} label={t.server} value={d.server ? t.running : t.stopped} hint={d.server ? undefined : t.serverDown} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void recheck()} disabled={checking} className={secondaryButton}>
            <RefreshCw className={checking ? "motion-safe:animate-spin" : undefined} /> {t.checkAgain}
          </Button>
          <Button variant="outline" onClick={copy} disabled={!d} className={secondaryButton}>
            <Copy /> {t.copy}
          </Button>
          <Button variant="outline" onClick={() => void openLogDir()} className={secondaryButton}>
            <FileText /> {t.openLogs}
          </Button>
          <Button variant="outline" onClick={() => void openDataDir()} className={secondaryButton}>
            <FolderOpen /> {t.openData}
          </Button>
        </div>
        <DialogFooter>
          <QuietButton onClick={() => void openUrl(guideUrl())}>
            <BookOpen /> {t.guide}
          </QuietButton>
          <AccentButton size="lg" onClick={() => void report()}>
            <Bug /> {t.report}
          </AccentButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
