import { useEffect, useId, useRef, useState } from "react";
import { ListChecks, ListX, RotateCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { loadAccounts, useAccounts } from "@/accounts/store";
import { useMessages } from "@/i18n";
import {
  canSwitch,
  claudeExtensions,
  isOn,
  withItem,
  withItems,
  type ClaudeExtensions,
  type ExtensionChoice,
  type ExtensionItem,
} from "@/ipc/claudeExtensions";
import { cn } from "@/lib/utils";
import { useNativeKeyDown } from "@/lib/useNativeKeyDown";
import { resumeTerminal } from "@/nodes/terminal/registry";
import { nodesStore, sessionOf, updateSession, useNodes } from "@/store/nodes";
import { canvasMessages } from "./messages";
import { keepCanvasFocus } from "./PanelAction";
import { forgetStartedChoice, noteChoiceChange, useRestartPending } from "./startedChoice";

/*
 * The skills, plugins, MCP servers and subagents a Claude terminal can turn
 * off or on, from its folder, its profile, its claude.ai account and its
 * plugins. A plugin's skills, MCP servers and subagents are listed (source
 * "plugin") and are on only while their plugin is; its skills are fixed to its
 * switch in Plugins (`skillOverrides` doesn't reach them). dummyPlane's own MCP
 * server is listed, fixed. What nothing on disk names is said under its list,
 * not hidden: claude.ai's connectors, Claude Code's built-in plugins, bundled
 * skills and built-in subagents.
 */

export type ExtensionKind = keyof ClaudeExtensions;

export type ExtensionLists = { state: "loading" } | { state: "ready"; data: ClaudeExtensions } | { state: "error"; message: string };

/** From this many items on, a list gets a search field. */
const SEARCH_FROM = 9;

/**
 * What a Claude terminal in `cwd`, with its profile, can find, read once a
 * list is `wanted` and again when the folder or the profile changes. One call
 * returns the four lists. A terminal bound to a profile waits for the profiles:
 * the default one's lists would be another setup's.
 */
export function useClaudeExtensions(cwd: string, accountId: string | undefined, wanted: boolean): { lists: ExtensionLists; retry: () => void } {
  const accountsLoaded = useAccounts((s) => s.loaded);
  const configDir = useAccounts((s) => (accountId ? s.profiles.find((p) => p.id === accountId)?.configDir : undefined));
  const ready = !accountId || accountsLoaded;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<(ExtensionLists & { token: string }) | null>(null);
  const token = `${cwd}\n${configDir ?? ""}\n${attempt}`;
  const due = wanted && ready && result?.token !== token;

  useEffect(() => {
    if (wanted && !ready) void loadAccounts();
  }, [wanted, ready]);

  useEffect(() => {
    if (!due) return;
    setResult({ token, state: "loading" });
    // An answer for another folder or profile, or an older attempt, is dropped.
    const settle = (next: ExtensionLists) => setResult((previous) => (previous?.token === token ? { ...next, token } : previous));
    claudeExtensions(cwd, configDir).then(
      (data) => settle({ state: "ready", data }),
      (error: unknown) => settle({ state: "error", message: error instanceof Error ? error.message : String(error) }),
    );
  }, [due, token, cwd, configDir]);

  return { lists: result?.token === token ? result : { state: "loading" }, retry: () => setAttempt((n) => n + 1) };
}

/** Over a list, the wheel scrolls it. Ctrl or Cmd held still zooms the canvas. A ref callback: it returns its cleanup. */
function keepListWheel(node: HTMLElement | null): (() => void) | undefined {
  if (!node) return undefined;
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
  };
  node.addEventListener("wheel", onWheel);
  return () => node.removeEventListener("wheel", onWheel);
}

const folderName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;

/**
 * One kind's list in the edit panel of a Claude terminal, or of a Fleet (its
 * session's, nested in the node): its items, each on or off for it alone, or
 * fixed and saying why. dummyPlane's own MCP server is one row (`withoutOwnServer`).
 */
export function ExtensionList(props: { nodeId: string; kind: ExtensionKind; cwd: string; choice: ExtensionChoice | undefined; lists: ExtensionLists; onRetry: () => void }) {
  const { nodeId, kind, lists } = props;
  const t = useMessages(canvasMessages);
  const s = t.selection;
  const [query, setQuery] = useState("");
  const fleet = useNodes((state) => state.nodes[nodeId]?.kind === "fleet");

  if (lists.state === "loading") return <Note>{t.loading}</Note>;
  if (lists.state === "error") {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-xs break-words text-dp-text-2">
          {s.listFailed(lists.message)}
        </p>
        <Button type="button" variant="secondary" size="sm" onMouseDown={keepCanvasFocus} onClick={props.onRetry} className="text-xs font-normal">
          {s.retry}
        </Button>
      </div>
    );
  }

  const items = lists.data[kind] ?? [];
  // What Claude loads but nothing on disk names (claude.ai's connectors, Claude Code's own plugins, skills and
  // subagents): each tab says so under its list rather than leave it out unsaid.
  const unlisted = <Note>{s.notListed[kind]}</Note>;
  if (items.length === 0) {
    return (
      <>
        <Note>{s.empty[kind](folderName(props.cwd))}</Note>
        {unlisted}
      </>
    );
  }

  const needle = query.trim().toLowerCase();
  const shown = needle ? items.filter((item) => [item.name, item.id, item.description ?? ""].some((text) => text.toLowerCase().includes(needle))) : items;
  // The latest stored choice, not the one of this render: two quick clicks both count.
  // Read and written where the session lives: a terminal's payload, a Fleet's `session`.
  const latest = () => sessionOf(nodesStore.getState().nodes[nodeId])?.extensions;
  const store = (before: ExtensionChoice | undefined, next: ExtensionChoice | undefined) => {
    noteChoiceChange(nodeId, before);
    updateSession(nodeId, { extensions: next });
  };
  const toggle = (item: ExtensionItem, on: boolean) => {
    const before = latest();
    store(before, withItem(kind, item, on, before));
  };
  // Select all, Unselect all: every item shown (the search applies) that a choice can switch, in one change.
  const switchAll = (on: boolean) => {
    const before = latest();
    const changing = shown.filter((item) => canSwitch(kind, item) && isOn(kind, item, before) !== on);
    if (changing.length > 0) store(before, withItems(kind, changing, on, before));
  };
  const switchable = shown.filter((item) => canSwitch(kind, item));
  const onCount = shown.filter((item) => isOn(kind, item, props.choice)).length;

  const searchable = items.length >= SEARCH_FROM;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {searchable && <SearchField label={s.search(s.kinds[kind])} value={query} onChange={setQuery} />}
      {shown.length > 0 && (
        <ListToolbar
          // While a search narrows the list, it counts the items shown: the ones its buttons switch.
          count={needle ? s.onCountShown(onCount, shown.length) : s.onCount(onCount, items.length)}
          canSelect={switchable.some((item) => !isOn(kind, item, props.choice))}
          canUnselect={switchable.some((item) => isOn(kind, item, props.choice))}
          onSwitchAll={switchAll}
          // Under a scrollbar's stable gutter, the checkboxes' column sits 8 px further in.
          gutter={searchable}
        />
      )}
      {shown.length === 0 ? (
        <Note>{s.noMatch(query.trim())}</Note>
      ) : (
        // The rows' text starts on the panel's edge, under its title and tabs; their hover runs 8 px past it (-mx-2).
        // A long list keeps its scrollbar's room: narrowing the search doesn't shift the checkboxes.
        <ul ref={keepListWheel} aria-label={s.tabs[kind]} className={cn("-mx-2 min-h-0 flex-1 overflow-y-auto", searchable && "[scrollbar-gutter:stable]")}>
          {shown.map((item) => (
            <ExtensionRow
              key={item.id}
              item={item}
              on={isOn(kind, item, props.choice)}
              // Plugins turn on as well as off; the others only turn off what the user's settings leave on.
              locked={!canSwitch(kind, item)}
              fleet={fleet}
              onToggle={(on) => toggle(item, on)}
            />
          ))}
        </ul>
      )}
      {unlisted}
      <RestartLine nodeId={nodeId} choice={props.choice} />
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="py-1 text-xs text-dp-text-3">
      {children}
    </p>
  );
}

/**
 * A list's search. Its keys are its own (useNativeKeyDown): Backspace must not
 * reach the canvas, where it deletes the selected terminal. Escape clears the
 * search, then leaves the field.
 */
function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const placeholder = useMessages(canvasMessages).selection.searchPlaceholder;
  const field = useRef<HTMLInputElement>(null);
  useNativeKeyDown(field, (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (field.current?.value) onChange("");
    else field.current?.blur();
  });
  return (
    <div className="relative shrink-0">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-dp-text-3" />
      <Input
        ref={field}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        spellCheck={false}
        className="h-7 rounded-md pl-7 text-xs md:text-xs"
      />
    </div>
  );
}

/** The toolbar's buttons: as quiet as the count beside them until pointed at (Button's own weight is 500). */
const QUIET_BUTTON = "font-normal text-dp-text-2 hover:text-dp-text";

/**
 * Over a list, secondary to it: how many of its items are on, in the muted
 * text, and two buttons that switch every item shown on or off. A button that
 * would change nothing is disabled. The count starts on the rows' names; the
 * last button's label ends on the checkboxes' column, its hover as wide as a
 * row's (-mr-2), or the gutter's 8 px further in.
 */
function ListToolbar(props: { count: string; canSelect: boolean; canUnselect: boolean; onSwitchAll: (on: boolean) => void; gutter: boolean }) {
  const t = useMessages(canvasMessages).selection;
  return (
    // A press on a disabled button lands here: it must not take the keyboard off the canvas either.
    <div onMouseDown={keepCanvasFocus} className={cn("flex h-6 shrink-0 items-center justify-between gap-2", !props.gutter && "-mr-2")}>
      <p role="status" className="min-w-0 truncate text-xs text-dp-text-3 tabular-nums">
        {props.count}
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="xs" disabled={!props.canSelect} onMouseDown={keepCanvasFocus} onClick={() => props.onSwitchAll(true)} className={QUIET_BUTTON}>
          <ListChecks aria-hidden data-icon="inline-start" className="size-3.5" />
          {t.selectAll}
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={!props.canUnselect} onMouseDown={keepCanvasFocus} onClick={() => props.onSwitchAll(false)} className={QUIET_BUTTON}>
          <ListX aria-hidden data-icon="inline-start" className="size-3.5" />
          {t.unselectAll}
        </Button>
      </div>
    </div>
  );
}

/**
 * The on/off box of a row, quieter than shadcn's filled one, which would be
 * the loudest thing in the panel thirteen times over: an empty frame when off;
 * when on, a faint ink tint and the check in ink. Its frame brightens with the
 * row's hover (HOVERED_BOX), unless the row is locked.
 */
export const QUIET_BOX =
  "border-dp-text-3 bg-transparent transition-colors duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none after:-inset-1 dark:bg-transparent data-checked:border-dp-text-3 data-checked:bg-dp-accent-soft data-checked:text-dp-text dark:data-checked:bg-dp-accent-soft";
export const HOVERED_BOX = "group-hover/row:border-dp-text-2 data-checked:group-hover/row:border-dp-text-2";

/**
 * One item: its name, where it is set up (quiet mono text) and a one-line
 * description, whole on hover. The row is the checkbox's label. An item the
 * user's own settings (or its plugin) turn off stays off here, and an item
 * that is fixed (a plugin's skill, dummyPlane's own server) stays as it is:
 * each says why on its second line, where the description would be.
 */
/**
 * A row's second line, cut to one line; its whole text was only in a native title, which the keyboard never shows.
 * With the keyboard on the row's checkbox, it unfolds to four lines at most: a long description stays bounded.
 */
const REVEAL = "group-has-[:focus-visible]/row:line-clamp-4 group-has-[:focus-visible]/row:whitespace-normal";

function ExtensionRow(props: { item: ExtensionItem; on: boolean; locked: boolean; fleet: boolean; onToggle: (on: boolean) => void }) {
  const { item, on, locked, onToggle } = props;
  const t = useMessages(canvasMessages).selection;
  const id = useId();
  const described = useId();
  const reason = useId();
  // Fixed, it says what it follows; off, why: a plugin's server or subagent is off because its plugin is, not
  // because of a setting of its own.
  const whyOff =
    item.fixed === "own" ? (props.fleet ? t.missionServerAlwaysOn : t.ownServerAlwaysOn) : item.fixed === "plugin" ? t.followsPlugin : item.source === "plugin" ? t.offWithPlugin : t.offInSettings;
  return (
    <li
      data-extension={item.id}
      className={cn(
        "group/row flex min-h-10 items-center gap-3 rounded-md px-2 py-0.5",
        !locked && "hover:bg-dp-hover",
      )}
    >
      <label htmlFor={id} onMouseDown={keepCanvasFocus} className={cn("min-w-0 flex-1", locked ? "cursor-not-allowed" : "cursor-pointer")}>
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 truncate text-(length:--text-ui) leading-5", locked ? "text-dp-text-3" : "text-dp-text")}>{item.name}</span>
          <span className="shrink-0 font-mono text-xs text-dp-text-3" title={t.sourceHints[item.source]}>
            {t.sources[item.source]}
          </span>
        </span>
        {/* One line, its whole text on hover; the keyboard on the row's checkbox unfolds it, up to four lines (REVEAL). */}
        {locked ? (
          <span id={reason} className={cn("block truncate text-xs text-dp-text-3", REVEAL)} title={whyOff}>
            {whyOff}
          </span>
        ) : (
          item.description && (
            <span id={described} className={cn("block truncate text-xs text-dp-text-2", REVEAL)} title={item.description}>
              {item.description}
            </span>
          )
        )}
      </label>
      <Checkbox
        id={id}
        aria-label={item.name}
        aria-describedby={locked ? reason : item.description ? described : undefined}
        checked={on}
        disabled={locked}
        onCheckedChange={(checked) => onToggle(checked === true)}
        onMouseDown={keepCanvasFocus}
        className={cn(QUIET_BOX, !locked && HOVERED_BOX)}
      />
    </li>
  );
}

/** Under a list: when a change applies, and, for a running terminal whose session started with another choice, restarting it now. */
function RestartLine({ nodeId, choice }: { nodeId: string; choice: ExtensionChoice | undefined }) {
  const t = useMessages(canvasMessages).selection;
  const pending = useRestartPending(nodeId, choice);
  const fleet = useNodes((state) => state.nodes[nodeId]?.kind === "fleet");
  const restart = () => {
    forgetStartedChoice(nodeId);
    resumeTerminal(nodeId);
  };
  // One line either way, as tall as the button (leading-7): beside it, the shorter note fits the panel's width.
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-dp-line pt-2">
      <p className="min-w-0 truncate text-xs leading-7 text-dp-text-3">{pending ? t.runningOldChoice : fleet ? t.appliesOnRestartFleet : t.appliesOnRestart}</p>
      {pending && (
        <Button type="button" variant="secondary" size="sm" onMouseDown={keepCanvasFocus} onClick={restart} className="text-xs font-normal text-dp-text-2 hover:text-dp-text">
          <RotateCw className="size-3.5" />
          {t.restartNow}
        </Button>
      )}
    </div>
  );
}
