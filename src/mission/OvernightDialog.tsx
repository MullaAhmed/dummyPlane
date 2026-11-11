import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, Circle, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { OptionItem, OptionList } from "@/components/OptionList";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { showNode } from "@/canvas/arrive";
import { messages, useMessages } from "@/i18n";
import { missionChecks, type ProjectChecks } from "@/ipc/mission";
import { codexLinearLogin, type Permission } from "@/ipc/pty";
import { errorText } from "@/lib/format";
import { cn } from "@/lib/utils";
import { focusTerminal } from "@/nodes/terminal/registry";
import { AccentButton, QuietButton } from "@/shell/buttons";
import { nodesStore, sessionOf, useNodes } from "@/store/nodes";
import { useUsage } from "@/usage/usageStore";
import { MAX_AGENTS, windDownMin } from "./mission";
import { useMissionFolder } from "./folder";
import { missionMessages } from "./messages";
import { choiceOf, DEFAULT_AWAY_HOURS, DEFAULT_LABEL, MAX_AWAY_HOURS, nightSession, startOvernight } from "./overnight";
import { blockers, checksFor, usageWarning } from "./overnightChecks";
import { missionOf } from "./store";
import type { TicketSource } from "./tickets";

/** From the tightest to the most open: commands stay an explicit choice (review). */
const PERMISSIONS: readonly Permission[] = ["ask", "edits", "work"];
const SOURCES: readonly TicketSource["kind"][] = ["github", "backlog", "linear"];

/** A number field of the dialog: its figures aligned, one width for both. */
const NUMBER = "h-8 w-20 tabular-nums";
/** A filter field under a source's words. */
const FILTER = "h-7 px-2 text-xs md:text-xs";

/** What the dialog starts from: the night already set, when it is changed, else the defaults. */
function initial(fleetId: string) {
  const set = choiceOf(fleetId);
  const source = set?.source;
  return {
    hours: String(set ? set.awayMin / 60 : DEFAULT_AWAY_HOURS),
    agents: String(set?.agents ?? missionOf(nodesStore.getState().nodes[fleetId])?.maxAgents ?? 4),
    kind: source?.kind ?? ("github" as TicketSource["kind"]),
    label: source && source.kind !== "backlog" ? source.label : DEFAULT_LABEL,
    team: source?.kind === "linear" ? source.team : "",
    auto: set?.autoLaunch ?? false,
    permission: set?.permission ?? ("edits" as Permission),
    changing: set !== null,
  };
}

/** "10:42": the clock time `minutes` from now, as the user reads their clock. */
const clockIn = (minutes: number, now: number) => new Date(now + minutes * 60_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * "Overnight run" (spec overnight mission §5.1): how long the user is away, where the tickets are, what
 * agents may do unasked, how the night starts, then what is checked before they go. Opened again on a
 * night already set, it shows that night and changes it.
 */
export function OvernightDialog({ nodeId, open, onOpenChange }: { nodeId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  // Read at each opening: the fields are the user's from then on.
  return open ? <OvernightForm key={nodeId} nodeId={nodeId} onOpenChange={onOpenChange} /> : null;
}

function OvernightForm({ nodeId, onOpenChange }: { nodeId: string; onOpenChange: (open: boolean) => void }) {
  const t = useMessages(missionMessages).overnight;
  const [start] = useState(() => initial(nodeId));
  const [hours, setHours] = useState(start.hours);
  const [agents, setAgents] = useState(start.agents);
  const [kind, setKind] = useState(start.kind);
  const [label, setLabel] = useState(start.label);
  const [team, setTeam] = useState(start.team);
  const [auto, setAuto] = useState(start.auto);
  const [permission, setPermission] = useState(start.permission);
  const linearOn = useNodes((s) => sessionOf(s.nodes[nodeId])?.linear === true);
  // A Codex Fleet and its team run under Codex's sandbox and approvals: their options read otherwise.
  const codex = useNodes((s) => sessionOf(s.nodes[nodeId])?.agent === "codex");
  const permissionHelp = codex ? t.permissionHelpCodex : t.permissionHelp;
  const project = useMissionFolder(nodeId);
  const [checks, setChecks] = useState<ProjectChecks | null>(null);
  // A check that failed is a blocker of its own, with a retry: it never reads as "nothing in the way".
  const [checkError, setCheckError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!project) return;
    let current = true;
    void missionChecks(project).then(
      (found) => current && setChecks(found),
      (error: unknown) => current && setCheckError(errorText(error)),
    );
    return () => {
      current = false;
    };
  }, [project, attempt]);
  const checkAgain = () => {
    setChecks(null);
    setCheckError(null);
    setAttempt((n) => n + 1);
  };
  // Until the checks answer, the night cannot start: `gh auth status` can take seconds, longer offline.
  const checking = Boolean(project) && checks === null && checkError === null;
  const limits = useUsage((s) => s.limits);
  const now = Date.now();
  const usage = usageWarning(limits, now);
  const blocked = checks ? blockers(checks, kind, linearOn) : [];
  const away = Number(hours);
  const count = Number(agents);
  const awayValid = away > 0 && away <= MAX_AWAY_HOURS;
  const countValid = Number.isInteger(count) && count >= 1 && count <= MAX_AGENTS;
  const filled = kind === "backlog" || (label.trim() !== "" && (kind !== "linear" || team.trim() !== ""));
  const valid = awayValid && countValid && filled && blocked.length === 0 && !checking && checkError === null;
  const awayMin = Math.round(away * 60);

  const source = (): TicketSource =>
    kind === "backlog" ? { kind } : kind === "linear" ? { kind, team: team.trim(), label: label.trim() } : { kind, label: label.trim() };
  const prepare = () => {
    void startOvernight(nodeId, { awayMin, agents: count, source: source(), autoLaunch: auto, permission });
    onOpenChange(false);
  };
  // Linear's server joins the Fleet's tools (its session restarts on the same conversation); signing in is the user's:
  // in Claude's terminal, or in the browser Codex opens.
  const connectLinear = async () => {
    onOpenChange(false);
    const session = sessionOf(nodesStore.getState().nodes[nodeId]);
    await nightSession(nodeId, { permission: session?.permission, linear: true });
    const o = messages(missionMessages).overnight;
    if (session?.agent === "codex") {
      toast.info(o.linearStepsCodex, { duration: 12_000 });
      codexLinearLogin().then(
        () => toast.success(o.linearSigned),
        (error: unknown) => toast.error(o.linearFailed(errorText(error))),
      );
      return;
    }
    showNode(nodeId);
    focusTerminal(nodeId);
    toast.info(o.linearSteps, { duration: 12_000 });
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* The header and the footer stay put, the sections scroll between them: "Prepare the night" is always in view. */}
      <DialogContent showCloseButton={false} className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{start.changing ? t.titleChange : t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <div data-night-body className="-mx-4 flex min-h-0 flex-col gap-5 overflow-y-auto px-4 text-sm text-dp-text">
          <Section title={t.time}>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
              <NumberRow label={t.away} aria={t.awayLabel} unit={t.hours} value={hours} onChange={setHours} min={0.5} max={MAX_AWAY_HOURS} step={0.5} error={awayValid ? undefined : t.awayInvalid(MAX_AWAY_HOURS)} />
              <NumberRow label={t.agents} aria={t.agentsLabel} value={agents} onChange={setAgents} min={1} max={MAX_AGENTS} error={countValid ? undefined : t.agentsInvalid(MAX_AGENTS)} />
            </div>
            {awayValid && (
              <p data-ends className="text-xs text-dp-text-2 tabular-nums">
                {t.ends(clockIn(awayMin, now), Math.round(windDownMin(awayMin)))}
              </p>
            )}
          </Section>

          <Section title={t.source}>
            <OptionList label={t.source} value={kind} onValueChange={setKind} className="-mx-2 w-auto">
              {SOURCES.map((id) => (
                <OptionItem key={id} value={id} label={t.sources[id]} help={t.sourceHelp[id]} />
              ))}
            </OptionList>
            {kind !== "backlog" && (
              // Under the options' words, past their 14px dot and 8px gap.
              <div className="ml-5.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-dp-text-2">
                {kind === "linear" && (
                  <label className="flex items-center gap-2">
                    {t.team}
                    <Input aria-label={t.teamLabel} placeholder={t.teamPlaceholder} value={team} onChange={(e) => setTeam(e.target.value)} className={cn(FILTER, "w-24")} />
                  </label>
                )}
                <label className="flex items-center gap-2">
                  {t.label}
                  <Input aria-label={t.labelLabel} value={label} onChange={(e) => setLabel(e.target.value)} className={cn(FILTER, "w-32")} />
                </label>
              </div>
            )}
          </Section>

          <Section title={t.permission}>
            <OptionList label={t.permission} value={permission} onValueChange={setPermission} className="-mx-2 w-auto">
              {PERMISSIONS.map((id) => (
                <OptionItem key={id} value={id} label={t.permissions[id]} help={permissionHelp[id]} />
              ))}
            </OptionList>
            <p className="text-xs text-dp-text-2">{codex ? t.fleetNightCodex : t.fleetNight}</p>
            <p data-no-push className="text-xs text-dp-text-3">{codex ? t.noPushCodex : t.noPush}</p>
          </Section>

          <Section title={t.start}>
            <OptionList label={t.start} value={auto ? "auto" : "wait"} onValueChange={(next) => setAuto(next === "auto")} className="-mx-2 w-auto">
              <OptionItem value="wait" label={t.starts.wait} help={t.startHelp.wait} />
              <OptionItem value="auto" label={t.starts.auto} help={t.startHelp.auto} />
            </OptionList>
          </Section>

          <Section title={t.checks}>
            <ul data-checks className="flex flex-col gap-1.5 text-xs">
              {checking && <CheckRow state="pending" text={t.checking} />}
              {checkError !== null && (
                <CheckRow state="blocked" text={t.checkFailed(checkError)}>
                  <Button type="button" variant="ghost" size="xs" onClick={checkAgain} className="-my-1 ml-auto shrink-0 font-normal text-dp-text-2 hover:text-dp-text">
                    {t.checkAgain}
                  </Button>
                </CheckRow>
              )}
              {checksFor(kind).map((id) => (
                <CheckRow key={id} state={checks === null ? "pending" : blocked.includes(id) ? "blocked" : "ok"} text={blocked.includes(id) ? t.blocked[id] : t.check[id]}>
                  {id === "linear" && (
                    <Button type="button" variant="ghost" size="xs" onClick={() => void connectLinear()} className="-my-1 ml-auto shrink-0 font-normal text-dp-text-2 hover:text-dp-text">
                      {linearOn ? t.linearAgain : t.connectLinear}
                    </Button>
                  )}
                </CheckRow>
              ))}
              {usage !== null && <CheckRow state="warning" text={t.usage(usage)} />}
              <CheckRow state="info" text={t.check.awake} />
            </ul>
          </Section>
        </div>
        <DialogFooter>
          <QuietButton onClick={() => onOpenChange(false)}>{t.cancel}</QuietButton>
          <AccentButton size="lg" disabled={!valid} onClick={prepare}>
            {start.changing ? t.update : t.prepare}
          </AccentButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="dp-label mb-2">{title}</legend>
      {children}
    </fieldset>
  );
}

/** A number and its unit; out of range, the field says so and the reason sits under it. */
function NumberRow(props: { label: string; aria: string; unit?: string; value: string; onChange: (value: string) => void; min: number; max: number; step?: number; error?: string }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <>
      <label htmlFor={id} className="text-dp-text-2">
        {props.label}
      </label>
      <span className="flex items-center gap-2 text-dp-text-2">
        <Input
          id={id}
          type="number"
          min={props.min}
          max={props.max}
          step={props.step}
          aria-label={props.aria}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={props.error ? errorId : undefined}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className={NUMBER}
        />
        {props.unit}
      </span>
      {props.error && (
        <p id={errorId} className="col-start-2 text-xs text-dp-danger">
          {props.error}
        </p>
      )}
    </>
  );
}

type CheckState = "ok" | "blocked" | "pending" | "warning" | "info";

const MARKS: Record<CheckState, ReactNode> = {
  ok: <Check aria-hidden className="size-3.5 text-dp-ok" />,
  blocked: <X aria-hidden className="size-3.5 text-dp-danger" />,
  pending: <Circle aria-hidden className="size-3.5 text-dp-text-3" />,
  warning: <TriangleAlert aria-hidden className="size-3.5 text-dp-wait" />,
  info: <Circle aria-hidden className="size-3.5 text-dp-text-3" />,
};

/** A line of the checklist: its mark says the state, so it does not rest on the colour alone. */
function CheckRow({ state, text, children }: { state: CheckState; text: string; children?: ReactNode }) {
  return (
    <li data-check={state} role={state === "blocked" ? "alert" : undefined} className={cn("flex items-start gap-2", state === "blocked" ? "text-dp-danger" : "text-dp-text-2")}>
      <span className="mt-0.5 shrink-0">{MARKS[state]}</span>
      <span className="min-w-0">{text}</span>
      {children}
    </li>
  );
}
