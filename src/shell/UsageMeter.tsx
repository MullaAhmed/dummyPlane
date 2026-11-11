import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowRight } from "lucide-react";
import { useStore } from "zustand";
import { loadDiagnostics } from "@/app/diagnostics";
import { BUDGET_COLOR } from "@/canvas/overlay/timeline";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AGENTS } from "@/agents/catalog";
import { useMessages } from "@/i18n";
import { formatClock, formatDecimal } from "@/i18n/format";
import { formatDuration } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { sessionOf, useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { currentLimit, formatTokens, formatUsd, limitTone, liveCacheSessions, totals, type Limit, type Limits } from "@/usage/usage";
import { useUsage } from "@/usage/usageStore";
import { HintedButton } from "./buttons";
import { shellMessages } from "./messages";
import { TokensView } from "./TokensView";

function Bar({ limit, wide = false }: { limit: Limit; wide?: boolean }) {
  const tone = limitTone(limit.usedPercent);
  return (
    <span data-tone={tone} className={wide ? "block h-1.5 w-full rounded-full bg-dp-line" : "block h-1 w-8 rounded-full bg-dp-line"}>
      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, limit.usedPercent)}%`, backgroundColor: BUDGET_COLOR[tone] }} />
    </span>
  );
}

/** Whether a Claude session dummyPlane started (an agent or a fleet's) is running. */
function useClaudeSessionRunning(): boolean {
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  return Object.keys(nodes).some((id) => sessionOf(nodes[id])?.agent === "claude" && statuses[id]?.state === "running");
}

/** Whether Git Bash is missing, which keeps Claude's status line (the source of the meter) from running. Asked once, while `enabled`. */
function useGitBashMissing(enabled: boolean): boolean {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadDiagnostics().then(
      (d) => {
        if (alive) setMissing(d?.gitBash === null);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [enabled]);
  return missing;
}

/**
 * The title bar's usage: the plan's session and week, from
 * Claude's status lines; the detail of this run's sessions on a click.
 */
/** The limits as of now: a window past its reset shows as reset (final review maj §6). */
function useCurrentLimits(): Limits | null {
  const limits = useUsage((s) => s.limits);
  const now = useNow(60_000);
  if (!limits) return null;
  return {
    ...limits,
    fiveHour: limits.fiveHour && currentLimit(limits.fiveHour, now),
    sevenDay: limits.sevenDay && currentLimit(limits.sevenDay, now),
    models: limits.models.map((m) => ({ ...m, limit: currentLimit(m.limit, now) })),
  };
}

export function UsageMeter() {
  const t = useMessages(shellMessages);
  const u = t.usage;
  const limits = useCurrentLimits();
  const hasLimits = !!(limits?.fiveHour || limits?.sevenDay || limits?.models.length);
  const running = useClaudeSessionRunning();
  const gitBashMissing = useGitBashMissing(running && !hasLimits);
  // The three empty states: no Claude session yet; one running without limits (Git Bash missing, or its first answer pending).
  const emptyHint = !running ? u.noSession : gitBashMissing ? u.needsGitBash : u.waitingFirstAnswer;
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* The hint explains a meter that may show nothing yet; it stays shut while the popover is open. */}
        <HintedButton
          hint={limits ? u.titleWithLimits : u.titleWithoutLimits}
          variant="ghost"
          size="xs"
          data-usage
          className="gap-2 rounded-md px-1.5 font-mono font-normal tabular-nums text-dp-text-2 hover:text-dp-text"
        >
          {!hasLimits ? (
            <>
              {u.title}
              <span className="opacity-70">· {emptyHint}</span>
            </>
          ) : (
            <>
              {limits.fiveHour && (
                <span className="flex items-center gap-1">
                  {u.session} {t.percent(Math.round(limits.fiveHour.usedPercent))}<Bar limit={limits.fiveHour} />
                </span>
              )}
              {limits.sevenDay && (
                <span className="flex items-center gap-1">
                  {u.week} {t.percent(Math.round(limits.sevenDay.usedPercent))}<Bar limit={limits.sevenDay} />
                </span>
              )}
              {limits.models.map((m) => (
                <span key={m.key} className="flex items-center gap-1">
                  {m.label} {t.percent(Math.round(m.limit.usedPercent))}<Bar limit={m.limit} />
                </span>
              ))}
            </>
          )}
        </HintedButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px]">
        <UsageContent />
      </PopoverContent>
    </Popover>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <p className="dp-label">{title}</p>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-dp-text-2">{label}</span>
      <span className="ml-auto text-right font-mono text-dp-text">{children}</span>
    </div>
  );
}

function LimitRow({ label, limit, now }: { label: string; limit: Limit; now: number }) {
  const t = useMessages(shellMessages);
  return (
    <div className="flex flex-col gap-1">
      <Row label={label}>
        {t.percent(Math.round(limit.usedPercent))}
        {limit.resetsAt ? t.usage.resumes(formatClock(limit.resetsAt, now)) : ""}
      </Row>
      <Bar limit={limit} wide />
    </div>
  );
}

/**
 * The usage detail, or the 30-day tokens it links to. The keyboard follows the swap: Tokens takes
 * it on its Back, and Back hands it to the link that opened it, never to the page behind the popover.
 */
function UsageContent() {
  const [tokens, setTokens] = useState(false);
  const link = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  useLayoutEffect(() => {
    if (tokens || !returning.current) return;
    returning.current = false;
    link.current?.focus();
  }, [tokens]);
  return tokens ? (
    <TokensView
      onBack={() => {
        returning.current = true;
        setTokens(false);
      }}
    />
  ) : (
    <UsageDetail tokensLink={link} onTokens={() => setTokens(true)} />
  );
}

function UsageDetail({ onTokens, tokensLink }: { onTokens: () => void; tokensLink: RefObject<HTMLButtonElement | null> }) {
  const t = useMessages(shellMessages);
  const u = t.usage;
  const limits = useCurrentLimits();
  const sessions = useUsage((s) => s.sessions);
  const nodes = useNodes((s) => s.nodes);
  const now = useNow(30_000);
  const list = Object.values(sessions);
  const warm = liveCacheSessions(list, new Set(Object.keys(nodes)));
  const sum = totals(list);
  const fable = limits?.models.find((m) => m.label === "Fable");
  const nameOf = (nodeId: string) => {
    const session = sessionOf(nodes[nodeId]);
    return session ? session.name || AGENTS[session.agent].label : u.closedSession;
  };
  return (
    <div data-usage-detail className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
      <Section title={u.limitsTitle}>
        {limits?.fiveHour ? <LimitRow label={u.session5h} limit={limits.fiveHour} now={now} /> : <Row label={u.session5h}>—</Row>}
        {limits?.sevenDay ? <LimitRow label={u.weekAll} limit={limits.sevenDay} now={now} /> : <Row label={u.weekAll}>—</Row>}
        {fable ? (
          <LimitRow label={u.weekFable} limit={fable.limit} now={now} />
        ) : (
          <div className="flex flex-col gap-0.5">
            <Row label={u.weekFable}>
              <span className="font-sans text-dp-text-3">{u.notSent}</span>
            </Row>
            {/* Why, in words anyone can reach, rather than a native title on plain text. */}
            <p data-not-sent-why className="text-xs text-dp-text-3">
              {u.notSentHint}
            </p>
          </div>
        )}
        {limits?.models
          .filter((m) => m.label !== "Fable")
          .map((m) => (
            <LimitRow key={m.key} label={u.weekModel(m.label)} limit={m.limit} now={now} />
          ))}
      </Section>
      <Section title={u.sessionsTitle(sum.sessions)}>
        <Row label={u.totalCost}>{formatUsd(sum.costUsd)}</Row>
        <Row label={u.apiTime}>{formatDuration(sum.apiMs)}</Row>
        <Row label={u.wallTime}>{formatDuration(sum.wallMs)}</Row>
        <Row label={u.code}>
          <span className="text-dp-ok">+{sum.linesAdded}</span> <span className="text-dp-danger">−{sum.linesRemoved}</span>
        </Row>
        <div className="flex flex-col gap-0.5">
          <Row label={u.co2}>{sum.co2Grams < 10 ? formatDecimal(sum.co2Grams, 1) : Math.round(sum.co2Grams)} g</Row>
          <p data-co2-source className="text-xs text-dp-text-3">
            {u.co2Hint}
          </p>
        </div>
      </Section>
      {sum.byModel.length > 0 && (
        <Section title={u.byModel}>
          {sum.byModel.map((m) => (
            <Row key={m.name} label={m.name}>
              {formatUsd(m.costUsd)} · {u.tokens(formatTokens(m.inputTokens), formatTokens(m.outputTokens))}
            </Row>
          ))}
        </Section>
      )}
      {warm.length > 0 && (
        <Section title={u.cache}>
          {warm
            .map((s) => (
              <Row key={s.sessionId} label={`${nameOf(s.nodeId)} · ${s.model?.name ?? ""}`}>
                {s.cache!.warm && (s.cache!.expiresAt === null || s.cache!.expiresAt > now)
                  ? u.warm(s.cache!.hitRatio !== null ? Math.round(s.cache!.hitRatio * 100) : null, s.cache!.expiresAt ? formatClock(s.cache!.expiresAt, now) : null)
                  : u.cold}
              </Row>
            ))}
        </Section>
      )}
      <Button
        ref={tokensLink}
        variant="ghost"
        size="xs"
        data-tokens-link
        onClick={onTokens}
        className="-ml-2 self-start rounded-md px-2 font-normal text-dp-accent-ink hover:text-dp-accent-ink"
      >
        {u.tokensLink} <ArrowRight />
      </Button>
      <p className="text-xs text-dp-text-3">{u.footnote}</p>
    </div>
  );
}
