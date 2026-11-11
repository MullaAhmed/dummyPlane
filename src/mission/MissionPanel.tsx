import { useId, useRef, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/errorToast";
import { cn } from "@/lib/utils";
import { GeneratedText } from "@/openui/GeneratedText";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useCanvas } from "@/canvas/canvasStore";
import { focusNode } from "@/canvas/focusNode";
import { BUDGET_COLOR } from "@/canvas/overlay/timeline";
import { linkedAgents, NO_LINKS } from "@/agents/wires";
import { messages, useMessages } from "@/i18n";
import { useNativeKeyDown } from "@/lib/useNativeKeyDown";
import { useNow } from "@/lib/useNow";
import { StatusLine } from "@/nodes/foot/StatusLine";
import { AccentButton, Hint, HintedButton } from "@/shell/buttons";
import type { DotState } from "@/nodes/terminal/StatusDot";
import { useActivities } from "@/store/agentActivity";
import { FLEET_CAPABLE } from "@/fleet/capable";
import { nodeNameOf, sessionOf, terminalOf, useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { openReview } from "@/review/reviewStore";
import { uiStore, useUi } from "@/store/ui";
import { cleanMission, launchMission } from "./launch";
import { budgetBar, budgetOf, MAX_AGENTS, memberTime, nightMin, remainingGlobal, type Mission, type MissionState, type Report } from "./mission";
import { missionMessages } from "./messages";
import { morningShown } from "./morning";
import { NightSummary } from "./NightSummary";
import { MorningReportView } from "./MorningReportView";
import { OvernightDialog } from "./OvernightDialog";
import { LEVELS, modelLabel } from "./router";
import { agentState, missionOf, setMission } from "./store";

/** A number field of the panel: shadcn's Input at the panel's density, its figures aligned. */
const NUMBER = "h-7 w-16 px-1.5 text-xs tabular-nums md:text-xs";

/** A quiet action at the end of a line: its words end on the line's 12px edge, its padding in the line's. */
const LINE_ACTION = "-mr-2 font-normal text-dp-text-2 hover:text-dp-text aria-pressed:bg-dp-hover aria-pressed:text-dp-text";

/**
 * The mission as its dot shows it, the same signature as an agent's: resting
 * until a task comes, waiting on the user's go-ahead (the one state that asks
 * for them), at work, done.
 */
const MISSION_DOT: Record<MissionState, DotState> = {
  redaction: "idle",
  plan: "waiting",
  lancement: "working",
  en_cours: "working",
  terminee: "done",
};

/** Under the fleet's terminal: settings, plan and go-ahead, team, summary (spec orchestrateur §6, §7). */
export function MissionPanel({ nodeId }: { nodeId: string }) {
  const mission = useNodes((s) => missionOf(s.nodes[nodeId]));
  return mission ? <MissionView nodeId={nodeId} mission={mission} /> : null;
}

/**
 * The fleet's foot, built like an agent's (nodes/foot): a status line
 * first, where the mission stands, then what it needs at that moment. The
 * settings fold into one line that tells their values, so the terminal above,
 * where the task is written, keeps its height.
 */
function MissionView({ nodeId, mission }: { nodeId: string; mission: Mission }) {
  const t = useMessages(missionMessages);
  const now = useNow(60_000);
  const header = useRef<HTMLElement>(null);
  // No key typed on the status line reaches the canvas: Backspace on its button would delete the node.
  useNativeKeyDown(header, () => undefined);
  const setup = mission.state === "redaction" || mission.state === "plan";
  return (
    <section
      data-mission={nodeId}
      aria-label={t.title(mission.name ?? "")}
      className="flex max-h-[55%] shrink-0 flex-col border-t border-dp-line text-xs text-dp-text-2"
    >
      <header ref={header} className="shrink-0">
        <StatusLine
          dot={mission.error ? "error" : MISSION_DOT[mission.state]}
          // The words agree with the red dot, which a screen reader does not hear.
          label={mission.error ? t.stateError : t.state[mission.state]}
          title={mission.error}
          facts={[mission.name, mission.state === "redaction" && t.writeTask]}
          end={
            <>
              {mission.overnight && <NightBadge mission={mission} now={now} />}
              {mission.branch && <span className="max-w-40 truncate font-mono text-dp-text-3">{mission.branch}</span>}
              {setup && !mission.overnight && <NightButton nodeId={nodeId} />}
            </>
          }
        />
      </header>
      <div data-mission-body className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3 empty:hidden">
        {mission.overnight && mission.state !== "terminee" && <NightSummary nodeId={nodeId} mission={mission} />}
        {setup && <Setup nodeId={nodeId} mission={mission} />}
        {mission.plan && (mission.state === "plan" || mission.state === "lancement") && <Plan mission={mission} />}
        {mission.error && (
          <p role="alert" className="text-dp-danger">
            {mission.error}
          </p>
        )}
        {morningShown(mission, now) && <MorningReportView mission={mission} />}
        {(mission.state === "en_cours" || mission.state === "terminee") && mission.manager && <RunBy mission={mission} />}
        {(mission.state === "en_cours" || mission.state === "terminee") && <Team mission={mission} />}
        {mission.queue && mission.queue.length > 0 && <Queue mission={mission} />}
        {mission.state === "terminee" && <GeneratedText text={mission.summaryUi ?? mission.summary ?? ""} compact className="text-dp-text" />}
      </div>
      {/* Actions stay out of the scrolling body, so they are always visible. */}
      {mission.plan && (mission.state === "plan" || mission.state === "lancement") && <PlanActions nodeId={nodeId} mission={mission} />}
      {mission.state === "terminee" && <SummaryActions nodeId={nodeId} />}
    </section>
  );
}

/**
 * Before the go-ahead: the team it can call on, the model router in plain view, and the other settings folded
 * into the line of their values. A night sets its own team size, so nothing is left to fold.
 */
function Setup({ nodeId, mission }: { nodeId: string; mission: Mission }) {
  const t = useMessages(missionMessages);
  const [open, setOpen] = useState(false);
  const grid = useId();
  const block = useRef<HTMLDivElement>(null);
  // No key typed in a field or on a button here reaches the canvas: Backspace would delete the node.
  useNativeKeyDown(block, () => undefined);
  return (
    <div ref={block} className="flex flex-col">
      <TeamLink nodeId={nodeId} />
      <RouterRow nodeId={nodeId} mission={mission} />
      {!mission.overnight && (
        <>
          <Button
            type="button"
            variant="ghost"
            aria-expanded={open}
            aria-controls={grid}
            onClick={() => setOpen(!open)}
            // Its words on the body's edge, its hover surface out into the padding.
            className="-mx-2 h-7 justify-start gap-2 px-2 text-xs font-normal text-dp-text-2 hover:text-dp-text"
          >
            {t.settings}
            <span className="min-w-0 truncate text-dp-text-3 tabular-nums">{t.settingsSummary(mission.maxAgents)}</span>
            <ChevronDown
              aria-hidden
              className={cn("ml-auto size-4 text-dp-text-3 transition-transform duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none", open && "rotate-180")}
            />
          </Button>
          {open && <SettingsGrid id={grid} nodeId={nodeId} mission={mission} />}
        </>
      )}
    </div>
  );
}

/**
 * The model router, always in view: with it on, each sub-task's level picks its agent's model, so the user
 * must be able to see the switch without opening anything. Its levels name Claude's models: a team on another
 * CLI keeps its own, and the row is not there (`teamModel`, launch.ts).
 */
function RouterRow({ nodeId, mission }: { nodeId: string; mission: Mission }) {
  const t = useMessages(missionMessages);
  const claudeTeam = useNodes((s) => (sessionOf(s.nodes[nodeId])?.agent ?? "claude") === "claude");
  const router = useId();
  if (!claudeTeam) return null;
  return (
    <div className="flex h-7 items-center gap-2">
      <Checkbox
        id={router}
        role="switch"
        aria-label={t.routerLabel}
        checked={mission.router === true}
        onCheckedChange={(checked) => setMission(nodeId, { router: checked === true || undefined })}
        className="after:-inset-1"
      />
      <Hint label={t.routerTitle} side="bottom">
        <label htmlFor={router} className="cursor-pointer">
          {t.routerLabel}
        </label>
      </Hint>
    </div>
  );
}

/** "2 Claude agents linked", and Link: the mode where each click on the canvas wires a group or an agent. */
function TeamLink({ nodeId }: { nodeId: string }) {
  const t = useMessages(missionMessages);
  const linking = useUi((s) => s.linking === nodeId);
  const links = useCanvas((s) => s.links[nodeId] ?? NO_LINKS);
  const frames = useCanvas((s) => s.frames);
  const agentIds = linkedAgents(links, frames).agentIds;
  const tooled = useNodes((s) => agentIds.filter((id) => FLEET_CAPABLE.includes(terminalOf(s.nodes[id])?.agent ?? "shell")).length);
  return (
    <div className="flex h-7 items-center gap-2">
      <span className="min-w-0 truncate tabular-nums">{t.linked(tooled)}</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        // Whose Link it is: the link layer passes a click on to the linker's own "Done" only (agents/LinkMode.tsx).
        data-link-toggle={nodeId}
        aria-pressed={linking}
        onClick={() => uiStore.getState().setLinking(linking ? null : nodeId)}
        className={cn("ml-auto", LINE_ACTION)}
      >
        {!linking && <Plus aria-hidden />}
        {linking ? t.done : t.link}
      </Button>
    </div>
  );
}

/** The settings the fold keeps, a label per row and every control on one line, all 28px tall (as the lines above). */
function SettingsGrid({ id, nodeId, mission }: { id: string; nodeId: string; mission: Mission }) {
  const t = useMessages(missionMessages);
  const agents = useId();
  return (
    <div id={id} className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 pt-1">
      {/* Named by its visible label (WCAG 2.5.3 label in name); the long phrasing is the label's hint. */}
      <Hint label={t.maxAgentsHint} side="bottom">
        <label htmlFor={agents}>{t.maxAgents}</label>
      </Hint>
      <div className="flex h-7 items-center">
        <Input
          id={agents}
          type="number"
          min={1}
          max={MAX_AGENTS}
          value={mission.maxAgents}
          onChange={(e) => {
            const count = Math.round(Number(e.target.value));
            if (count >= 1) setMission(nodeId, { maxAgents: Math.min(MAX_AGENTS, count) });
          }}
          className={NUMBER}
        />
      </div>
    </div>
  );
}

/** "overnight", and once the team is at work, how long the night still runs. */
function NightBadge({ mission, now }: { mission: Mission; now: number }) {
  const t = useMessages(missionMessages);
  const left = mission.state === "en_cours" ? remainingGlobal(mission, now) : undefined;
  return <span className="font-mono text-dp-text-3 tabular-nums">{left === undefined ? t.nightBadge : t.nightLeft(left)}</span>;
}

/** "Overnight run…": the other way to start a mission, at the end of its status line until it starts. */
function NightButton({ nodeId }: { nodeId: string }) {
  const t = useMessages(missionMessages);
  const [night, setNight] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="xs" onClick={() => setNight(true)} className={LINE_ACTION}>
        {t.nightButton}
      </Button>
      {night && <OvernightDialog nodeId={nodeId} open onOpenChange={setNight} />}
    </>
  );
}

function Plan({ mission }: { mission: Mission }) {
  const t = useMessages(missionMessages);
  const plan = mission.plan ?? [];
  return (
    <div className="flex flex-col gap-2">
      {mission.task && <GeneratedText text={mission.task} compact />}
      <ol className="flex flex-col gap-1">
        {plan.map((task, i) => (
          <li key={i} className="rounded-md bg-dp-card px-2 py-1">
            <div className="flex items-center gap-2 text-dp-text">
              <span className="font-medium">{task.title}</span>
              {task.level && (
                <span className="shrink-0 text-dp-text-3">
                  {t.level[task.level]}
                  {mission.router ? ` · ${LEVELS[task.level].modelLabel}` : ""}
                </span>
              )}
              <span className="ml-auto shrink-0 font-mono text-dp-text-3 tabular-nums">
                {task.agent}
                {task.group ? ` → ${task.group.name}` : ""} · {task.budgetMin} {t.min}
              </span>
            </div>
            <p className="line-clamp-2">{task.brief}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The tasks no agent has taken yet (spec overnight mission §4). */
function Queue({ mission }: { mission: Mission }) {
  const t = useMessages(missionMessages);
  const queue = mission.queue ?? [];
  return (
    <div data-queue className="flex flex-col gap-1">
      <span className="font-medium text-dp-text">{t.waitingTasks(queue.length)}</span>
      <ol className="flex flex-col gap-1">
        {queue.map((task) => (
          <li key={task.title} className="flex items-center gap-2 rounded-md bg-dp-card px-2 py-1">
            <span className="min-w-0 truncate">{task.title}</span>
            <span className="ml-auto shrink-0 font-mono text-dp-text-3 tabular-nums">
              {task.group ? `${task.group.name} · ` : ""}
              {task.budgetMin} {t.min}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlanActions({ nodeId, mission }: { nodeId: string; mission: Mission }) {
  const t = useMessages(missionMessages);
  const total = (mission.plan ?? []).reduce((sum, s) => sum + s.budgetMin, 0);
  const launching = mission.state === "lancement";
  return (
    <footer data-mission-actions className="flex shrink-0 items-center gap-2 border-t border-dp-line px-3 py-2">
      <span className="font-mono tabular-nums">{t.total(total, nightMin(mission))}</span>
      <AccentButton size="sm" disabled={launching} onClick={() => void launchMission(nodeId)} className="ml-auto">
        {launching ? t.launching : t.launch}
      </AccentButton>
    </footer>
  );
}

/**
 * Who runs the team, and where its cards are: the Manager under the board, each a click away. The team's rows
 * below say who does which task. A mission run the old way has no such line: its Fleet runs it.
 */
function RunBy({ mission }: { mission: Mission }) {
  const t = useMessages(missionMessages);
  const manager = mission.manager;
  const board = mission.board;
  const name = useNodes((s) => (manager ? nodeNameOf(s.nodes[manager]) : "")) || t.showManager;
  const managerHere = useNodes((s) => (manager ? s.nodes[manager] !== undefined : false));
  const boardHere = useNodes((s) => (board ? s.nodes[board] !== undefined : false));
  return (
    <div data-run-by className="flex h-7 items-center gap-2">
      <span className="min-w-0 truncate">{t.runBy(name)}</span>
      {manager && managerHere && (
        <HintedButton hint={t.showManagerTitle(name)} variant="ghost" size="xs" onClick={() => focusNode(manager)} className={cn("ml-auto", LINE_ACTION)}>
          {t.showManager}
        </HintedButton>
      )}
      {board && boardHere && (
        <HintedButton hint={t.showBoardTitle} variant="ghost" size="xs" onClick={() => focusNode(board)} className={cn(!(manager && managerHere) && "ml-auto", LINE_ACTION)}>
          {t.showBoard}
        </HintedButton>
      )}
    </div>
  );
}

function Team({ mission }: { mission: Mission }) {
  const t = useMessages(missionMessages);
  const members = mission.members;
  // The agents' states follow their activity and their processes; their times, the clock.
  useActivities();
  const now = useNow(15_000);
  useStore(terminalStatusStore, (s) => s.statuses);
  const nodes = useNodes((s) => s.nodes);
  return (
    <ul className="flex flex-col gap-1">
      {members.map((member) => {
        const steps = terminalOf(nodes[member.nodeId])?.steps ?? [];
        const done = steps.filter((s) => s.state === "fait").length;
        return (
          <li key={member.nodeId || member.name} data-member={member.name} className="flex items-center gap-2 rounded-md bg-dp-card px-2 py-1">
            <span className="font-medium text-dp-text">{member.name}</span>
            <span className="min-w-0 truncate">{member.task}</span>
            {member.done && member.done.length > 0 && (
              <Hint label={t.finishedBefore(member.done.join(", "))} side="bottom">
                {/* A tab stop, so the hint reaches the keyboard as well. */}
                <span
                  data-finished
                  tabIndex={0}
                  className="flex shrink-0 items-center gap-0.5 rounded-sm font-mono text-dp-text-3 tabular-nums focus-visible:ring-2 focus-visible:ring-dp-accent/70 focus-visible:outline-none"
                >
                  <Check aria-hidden className="size-3.5" />
                  {member.done.length}
                </span>
              </Hint>
            )}
            {member.model && <span className="shrink-0 font-mono text-dp-text-3">{modelLabel(member.model)}</span>}
            <span className="ml-auto shrink-0">{t.agent[agentState(member.nodeId)]}</span>
            {steps.length > 0 && (
              <span className="shrink-0 font-mono tabular-nums">
                {done}/{steps.length}
              </span>
            )}
            {member.handedTo ? (
              <span className="shrink-0">→ {member.handedTo}</span>
            ) : member.sentAt !== undefined ? (
              <MemberTime spent={memberTime(mission, member, now)} budget={budgetOf(member)} />
            ) : null}
            {/* -my-1: its 24px box reaches into the row's padding, so the row keeps its height. */}
            <HintedButton
              hint={t.reviewTitle(member.name)}
              variant="ghost"
              size="xs"
              aria-label={t.reviewLabel(member.name)}
              onClick={() => openReview(member.nodeId)}
              className="-my-1 shrink-0 px-1.5 font-mono font-normal text-dp-text-2 hover:bg-dp-field"
            >
              {t.diff}
            </HintedButton>
            {member.report && <ReportWord report={member.report} merged={member.merged === true} />}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "done", "blocked": the agent's report in a word. Its summary, the agent's own account, is the word's hint, and
 * the word a tab stop, so the hint reaches the keyboard as well (as the finished count's does).
 */
function ReportWord({ report, merged }: { report: Report; merged: boolean }) {
  const t = useMessages(missionMessages);
  const word = (
    <span
      data-report={report.status}
      tabIndex={report.summary.trim() ? 0 : undefined}
      className={cn(
        "shrink-0 rounded-sm focus-visible:ring-2 focus-visible:ring-dp-accent/70 focus-visible:outline-none",
        report.status === "termine" ? "text-dp-text" : "text-dp-danger",
      )}
    >
      {t.report[report.status]}
      {merged ? t.merged : ""}
    </span>
  );
  return report.summary.trim() ? (
    <Hint label={report.summary} side="bottom">
      {word}
    </Hint>
  ) : (
    word
  );
}

/** "6 / 20 min", coloured like its bar (spec §8.3). */
/** A member's time, unless it cannot be told (a mission ended before end times were kept). */
function MemberTime({ spent, budget }: { spent: number | undefined; budget: number }) {
  return spent === undefined ? null : <BudgetTime spent={spent} budget={budget} />;
}

function BudgetTime({ spent, budget }: { spent: number; budget: number }) {
  const t = useMessages(missionMessages);
  return (
    <span className="shrink-0 font-mono tabular-nums" style={{ color: BUDGET_COLOR[budgetBar(spent, budget).tone] }}>
      {t.spent(Math.floor(spent), budget)}
    </span>
  );
}

function SummaryActions({ nodeId }: { nodeId: string }) {
  const t = useMessages(missionMessages);
  const clean = async () => {
    const result = await cleanMission(nodeId);
    if (typeof result === "string") toastError(messages(missionMessages).cleanFailed, { error: result });
    else toast.success(messages(missionMessages).cleaned(result.removed, result.kept));
  };
  return (
    <footer data-mission-actions className="flex shrink-0 justify-end border-t border-dp-line px-3 py-2">
      <Button variant="outline" size="sm" onClick={() => void clean()}>
        {t.clean}
      </Button>
    </footer>
  );
}
