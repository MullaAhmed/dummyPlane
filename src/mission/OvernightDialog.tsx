import { useEffect, useState } from "react";
import { OptionItem, OptionList } from "@/components/OptionList";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n";
import { missionChecks, type ProjectChecks } from "@/ipc/mission";
import type { Permission } from "@/ipc/pty";
import { AccentButton, Hint, QuietButton } from "@/shell/buttons";
import { useNodes } from "@/store/nodes";
import { useUsage } from "@/usage/usageStore";
import { MAX_AGENTS } from "./mission";
import { useMissionFolder } from "./folder";
import { missionMessages } from "./messages";
import { DEFAULT_AWAY_HOURS, DEFAULT_LABEL, MAX_AWAY_HOURS, startOvernight } from "./overnight";
import { blockers, usageWarning } from "./overnightChecks";
import { missionOf } from "./store";

/** From the tightest to the most open: commands stay an explicit choice (review). */
const PERMISSIONS: readonly Permission[] = ["ask", "edits", "work"];

/** "Overnight mission" (spec overnight mission §5.1): how long the user is away, and what the team works from. */
export function OvernightDialog({ nodeId, open, onOpenChange }: { nodeId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useMessages(missionMessages).overnight;
  const maxAgents = useNodes((s) => missionOf(s.nodes[nodeId])?.maxAgents);
  const [hours, setHours] = useState(String(DEFAULT_AWAY_HOURS));
  const [agents, setAgents] = useState(String(maxAgents ?? 4));
  const [kind, setKind] = useState<"github" | "backlog">("github");
  const [label, setLabel] = useState(DEFAULT_LABEL);
  const [auto, setAuto] = useState(false);
  const [permission, setPermission] = useState<Permission>("edits");
  const project = useMissionFolder(nodeId);
  const [checks, setChecks] = useState<ProjectChecks | null>(null);
  useEffect(() => {
    if (!project) return;
    let current = true;
    void missionChecks(project).then((found) => current && setChecks(found), () => undefined);
    return () => {
      current = false;
    };
  }, [project]);
  const limits = useUsage((s) => s.limits);
  const usage = usageWarning(limits, Date.now());
  const blocked = checks ? blockers(checks, kind) : [];
  const away = Number(hours);
  const count = Number(agents);
  const valid = away > 0 && away <= MAX_AWAY_HOURS && Number.isInteger(count) && count >= 1 && count <= MAX_AGENTS && (kind === "backlog" || label.trim() !== "") && blocked.length === 0;
  const start = () => {
    startOvernight(nodeId, {
      awayMin: Math.round(away * 60),
      agents: count,
      source: kind === "backlog" ? { kind } : { kind, label: label.trim() },
      autoLaunch: auto,
      permission,
    });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-sm text-dp-text">
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between gap-3">
              {t.away}
              <Input type="number" min={0.5} max={MAX_AWAY_HOURS} step={0.5} aria-label={t.awayLabel} value={hours} onChange={(e) => setHours(e.target.value)} className="w-20 tabular-nums" />
            </label>
            <label className="flex items-center justify-between gap-3">
              {t.agents}
              <Input type="number" min={1} max={MAX_AGENTS} aria-label={t.agentsLabel} value={agents} onChange={(e) => setAgents(e.target.value)} className="w-20 tabular-nums" />
            </label>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="dp-label mb-1">{t.source}</legend>
            <OptionList label={t.source} value={kind} onValueChange={setKind} className="-mx-2 w-auto">
              <OptionItem value="github" label={t.github} />
              <OptionItem value="backlog" label={t.backlog} />
            </OptionList>
            {kind === "github" && (
              // Under the option's words, past its 14px dot and 8px gap.
              <Hint label={t.labelTitle} side="bottom">
                <label className="ml-5.5 flex items-center gap-2 text-xs text-dp-text-2">
                  {t.label}
                  <Input aria-label={t.labelLabel} value={label} onChange={(e) => setLabel(e.target.value)} className="h-7 w-32 px-2 text-xs md:text-xs" />
                </label>
              </Hint>
            )}
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="dp-label mb-1">{t.permission}</legend>
            <OptionList label={t.permission} value={permission} onValueChange={setPermission} className="-mx-2 w-auto">
              {PERMISSIONS.map((id) => (
                <OptionItem key={id} value={id} label={t.permissions[id]} help={t.permissionHelp[id]} />
              ))}
            </OptionList>
            <p className="pt-1 text-xs text-dp-text-2">{t.noPush}</p>
          </fieldset>
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox aria-label={t.auto} checked={auto} onCheckedChange={(checked) => setAuto(checked === true)} className="border-dp-text-3 after:-inset-1" />
            {t.auto}
          </label>
          <ul data-checks className="flex flex-col gap-1 text-xs text-dp-text-2">
            {blocked.map((id) => (
              <li key={id} role="alert" className="text-dp-danger">
                {t.blocked[id]}
              </li>
            ))}
            {usage !== null && <li className="text-dp-wait">{t.usage(usage)}</li>}
            <li>{t.awake}</li>
          </ul>
        </div>
        <DialogFooter>
          <QuietButton onClick={() => onOpenChange(false)}>{t.cancel}</QuietButton>
          <AccentButton size="lg" disabled={!valid} onClick={start}>
            {t.start}
          </AccentButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
