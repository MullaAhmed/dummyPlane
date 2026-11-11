import { useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { ArrowUp, X } from "lucide-react";
import { useStore } from "zustand";
import { cn } from "@/lib/utils";
import type { SceneFrame } from "@/canvas/groups";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { useNativeKeyDown } from "@/lib/useNativeKeyDown";
import { takeOverPaste, withPathAt } from "@/nodes/terminal/imagePaste";
import { sendCommand } from "./broadcast";
import { Keycap } from "./composer/Keycap";
import { LocalComposer } from "./composer/LocalComposer";
import { routeCommand } from "./composer/route";
import { AgentStatusDot, TargetIcon } from "./composer/TargetMark";
import { agentsMessages } from "./messages";
import { browseHistory, historyStore } from "./history";
import { commandAt, isKnownCommand, matchCommands } from "./slashCommands";
import {
  completedMention,
  extractMentions,
  keptDismissal,
  matchOptions,
  mentionAt,
  mentionParts,
  partTargets,
  targetKey,
  targetOptions,
  uniqueTargets,
  withoutMention,
  type Target,
  type TargetAgent,
} from "./targets";

const MENU_SIZE = 8;

const NO_TARGETS: readonly Target[] = [];

/** A line of the list above the field: a target, or a command of the agents' CLI. */
interface Suggestion {
  key: string;
  label: string;
  detail: string;
  /** A target's line shows its icon, and an agent's its status dot. */
  target?: Target;
  pick: () => void;
}

/** Escape keeps the list closed while the same `@` mention or `/command` is typed. */
type Dismissal = { kind: "mention" | "command"; at: number };

function keptClosed(dismissed: Dismissal | null, text: string, caret: number): Dismissal | null {
  if (dismissed === null) return null;
  if (dismissed.kind === "mention") return keptDismissal(dismissed.at, text, caret) === null ? null : dismissed;
  return commandAt(text, caret)?.start === dismissed.at ? dismissed : null;
}

interface CommandInputProps {
  agents: readonly TargetAgent[];
  groups: readonly SceneFrame[];
  /** Reached without `@`: the selection, or a fleet's agents. */
  fallback: readonly string[];
  placeholder: string;
  /**
   * The field's accessible name, "Message agents": it stays while chips empty the placeholder, and must stay
   * true whoever the chips name (the placeholder by default, for a field that only ever reaches the same agents).
   */
  label?: string;
  /** Why Envoyer is grey when nothing is targeted. */
  emptyHint: string;
  /** Who `fallback` is, when it is one agent the user did not select (the active terminal): named so Send never surprises. */
  sendsTo?: string;
  /**
   * The targets of the moment, the selection or else the active terminal: shown as chips of their own, as if
   * typed with `@`, and replaced when the selection or the active terminal changes, as long as the user has not
   * chosen the chips. One removed (its ✕, Backspace) is not sent to, nor reached through `fallback`, until
   * the targets of the moment change.
   */
  autoTargets?: readonly Target[];
  /**
   * The targets of the moment are the user's selection, not a guess: a new one replaces the chips the last send
   * left too (never a draft's), since selecting is saying who.
   */
  fromSelection?: boolean;
  /** A node's foot: one line, the field and its Send, at the foot's density. */
  compact?: boolean;
  /** Escape with no list open: where the keyboard goes back (a node's terminal). */
  onEscape?: () => void;
}

/**
 * The field of the command bar and of a fleet (spec theme §12, §13):
 * `@` targets in chips (`@batman/superman` for several), `/` the agents' commands,
 * Enter sends to them (or to `fallback`), ↑ ↓ recall. It is assistant-ui's
 * composer (Root, Input, Send) on a runtime with no model: the composer holds
 * the text and sends it, the field decides who receives it.
 */
export function CommandInput(props: CommandInputProps) {
  // Filled by the field on each render: who a send reaches depends on its chips and on the canvas.
  const deliver = useRef<(text: string) => void>(() => undefined);
  return (
    <LocalComposer onSend={(text) => deliver.current(text)}>
      <CommandField {...props} deliver={deliver} />
    </LocalComposer>
  );
}

function CommandField(props: CommandInputProps & { deliver: RefObject<(text: string) => void> }) {
  const { agents, groups, placeholder, label = placeholder, emptyHint, sendsTo, autoTargets = NO_TARGETS, fromSelection = false, compact = false, onEscape, deliver } = props;
  const t = useMessages(agentsMessages).command;
  const aui = useAui();
  // The composer owns the text: typing, completing, recalling and sending all go through it.
  const text = useAuiState((s) => s.composer.text);
  const [caret, setCaret] = useState(0);
  const [targets, setTargets] = useState<Target[]>([]);
  const [active, setActive] = useState(0);
  // Escape closes the list for the mention typed at that position.
  const [dismissed, setDismissed] = useState<Dismissal | null>(null);
  const [browsing, setBrowsing] = useState<{ index: number; draft: string } | null>(null);
  // The field has the keyboard: how to target shows before the first word, not after it.
  const [focused, setFocused] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // The chips the field put there itself (autoTargets), and those of them the user took away.
  const placed = useRef<ReadonlySet<string>>(new Set());
  const [refused, setRefused] = useState<readonly Target[]>(NO_TARGETS);
  const autoKeys = autoTargets.map(targetKey).join(" ");
  // A refused target of the moment is not reached without `@` either: neither the agent, nor a group's members.
  const refusedIds = new Set(refused.flatMap((r) => (r.kind === "agent" ? [r.id] : r.kind === "group" ? (groups.find((g) => g.id === r.id)?.memberIds ?? []) : [])));
  const fallback = refusedIds.size > 0 ? props.fallback.filter((id) => !refusedIds.has(id)) : props.fallback;
  const listId = useId();
  const history = useStore(historyStore, (s) => s.entries);

  const options = useMemo(() => targetOptions(agents, groups), [agents, groups]);
  const labels = new Map(options.map((o) => [targetKey(o.target), o.label]));
  const kept = targets.filter((t) => labels.has(targetKey(t)));
  // The chips of the moment give way to a name typed after `@`: the user said who, they were only a guess.
  const onlyPlaced = kept.length > 0 && kept.every((c) => placed.current.has(targetKey(c)));
  const chips = onlyPlaced && extractMentions(text, options).targets.length > 0 ? [] : kept;
  const mention = mentionAt(text, caret);
  const parts = mention ? mentionParts(mention.query, options) : null;
  const command = mention ? null : commandAt(text, caret);
  const menuStart = mention?.start ?? command?.start ?? null;
  const menuKind = mention ? "mention" : "command";
  // A recalled command keeps its list closed: ↑ goes on through the history.
  const shown = menuStart !== null && !(dismissed?.kind === menuKind && dismissed.at === menuStart) && browsing === null;
  const fullCommand = command !== null && isKnownCommand(`/${command.query}`);
  const suggestions: Suggestion[] = !shown
    ? []
    : parts
      ? matchOptions(options, parts.query)
          .slice(0, MENU_SIZE)
          .map((option, i) => ({
            key: `${targetKey(option.target)}-${i}`,
            label: option.label,
            detail: option.detail,
            target: option.target,
            pick: () => {
              const known = partTargets(parts.typed, options);
              // An unknown name stays as typed: the mention is completed, not reduced to the known ones.
              if (known.length < parts.typed.length) completeText(completedMention(parts.typed, option));
              else insertTargets([...known, option.target]);
            },
          }))
      : matchCommands(command?.query ?? "")
          .slice(0, MENU_SIZE)
          .map((found) => ({ key: found.name, label: found.name, detail: found.hint, pick: () => insertCommand(found.name) }));
  // A list that shrank under the highlight starts again at the top.
  const row = active < suggestions.length ? active : 0;
  const listOpen = suggestions.length > 0;
  const scope = { chips, options, agents, groups, fallback };
  const { targets: allTargets, ids, unknown, canSend } = routeCommand(text, scope);
  const nothingTargeted = allTargets.length === 0 && fallback.length === 0;
  // Targets were chosen, but they hold no agent (an empty group).
  const noAgents = allTargets.length > 0 && ids.length === 0;
  // Nothing was typed after `@`: the command goes to who `fallback` names.
  const namedFallback = allTargets.length === 0 ? sendsTo : undefined;

  /** The targets of the moment become the chips, as if typed. */
  const place = (moment: readonly Target[]) => {
    placed.current = new Set(moment.map(targetKey));
    setTargets([...moment]);
  };

  // Other targets of the moment: their chips take the place of the last ones, unless the user chose the chips.
  // A new selection takes the place of the chips a send left as well, though not of those of a draft being written.
  useEffect(() => {
    setRefused(NO_TARGETS);
    const untouched = targets.every((c) => placed.current.has(targetKey(c)));
    const selected = fromSelection && autoTargets.length > 0 && text.trim() === "";
    if (untouched || selected) place(autoTargets);
    // Only new targets of the moment move the chips: `targets` and the text are read as they stand then.
  }, [autoKeys]);

  /**
   * A chip taken away; one of the moment is then refused until the targets of the moment change. The user's own
   * last chip gone, the targets of the moment show again: who Enter reaches is never left without its chips.
   */
  const removeChip = (target: Target) => {
    const key = targetKey(target);
    const rest = chips.filter((c) => targetKey(c) !== key);
    if (placed.current.has(key)) {
      placed.current = new Set([...placed.current].filter((k) => k !== key));
      setRefused((current) => [...current, target]);
      setTargets(rest);
      return;
    }
    const again = autoTargets.filter((t) => !refused.some((r) => targetKey(r) === targetKey(t)));
    if (rest.length === 0 && again.length > 0) place(again);
    else setTargets(rest);
  };

  /** A change the field makes itself; what the user types reaches the composer through its Input. */
  const edit = (value: string, at: number) => {
    aui.composer.setText(value);
    typed(value, at);
  };

  const typed = (value: string, at: number) => {
    setCaret(at);
    setActive(0);
    setBrowsing(null);
    setDismissed((current) => keptClosed(current, value, at));
  };

  const moveCaret = (at: number) => requestAnimationFrame(() => field.current?.setSelectionRange(at, at));

  const insertTargets = (picked: readonly Target[]) => {
    if (!mention) return;
    // A name picked from the list replaces the chips of the moment rather than joining them.
    if (onlyPlaced) placed.current = new Set();
    setTargets(uniqueTargets([...(onlyPlaced ? [] : chips), ...picked]));
    const next = withoutMention(text, mention.start, caret);
    edit(next.text, next.caret);
    moveCaret(next.caret);
  };

  const completeText = (mentionText: string) => {
    if (!mention) return;
    const value = `${text.slice(0, mention.start)}${mentionText}${text.slice(caret)}`;
    const at = mention.start + mentionText.length;
    edit(value, at);
    moveCaret(at);
  };

  // A pasted image becomes the path of its saved file, as in a terminal (imagePaste.ts); text pastes as usual. The path
  // goes where the caret is once the image is saved: the user may have typed meanwhile, and a closed field gets nothing.
  const insertPath = (path: string) => {
    const element = field.current;
    if (!element) return;
    const next = withPathAt(element.value, element.selectionStart, element.selectionEnd, path);
    edit(next.text, next.caret);
    moveCaret(next.caret);
  };

  const insertCommand = (name: string) => {
    if (!command) return;
    // The space that follows the caret already separates the command from the rest.
    const rest = text.slice(caret);
    const value = `${text.slice(0, command.start)}${name}${rest.startsWith(" ") ? "" : " "}${rest}`;
    const at = command.start + name.length + 1;
    edit(value, at);
    moveCaret(at);
  };

  // The composer empties itself, then hands over what it sent: its targets stay as chips for the next one.
  deliver.current = (sent: string) => {
    const route = routeCommand(sent, scope);
    if (!route.canSend) {
      aui.composer.setText(sent);
      return;
    }
    historyStore.getState().add(sent);
    setTargets(route.targets);
    typed("", 0);
    void sendCommand(route.ids, route.instruction);
  };

  // Only what this field can deliver is sent: the composer alone would send any text, and empty the field.
  const send = () => {
    if (canSend) aui.composer.send();
  };

  const recall = (direction: "up" | "down") => {
    const index = browseHistory(history, browsing?.index ?? null, direction);
    const draft = browsing?.draft ?? text;
    const value = index === null ? draft : history[index];
    aui.composer.setText(value);
    setCaret(value.length);
    setBrowsing(index === null ? null : { index, draft });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // The Enter (or arrow) of an IME composition picks a candidate: it is not ours.
    if (e.isComposing || e.keyCode === 229) return;
    if (listOpen && menuStart !== null) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : suggestions.length - 1;
        setActive((i) => (i + step) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !fullCommand)) {
        e.preventDefault();
        suggestions[row].pick();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed({ kind: menuKind, at: menuStart });
        return;
      }
    }
    const element = e.currentTarget as HTMLTextAreaElement;
    if (e.key === "Escape" && onEscape) {
      e.preventDefault();
      onEscape();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === "ArrowUp" && !element.value.slice(0, element.selectionStart).includes("\n")) {
      e.preventDefault();
      recall("up");
    } else if (e.key === "ArrowDown" && browsing && !element.value.slice(element.selectionEnd).includes("\n")) {
      e.preventDefault();
      recall("down");
    } else if (e.key === "Backspace" && element.selectionEnd === 0 && element.selectionStart === 0 && chips.length > 0) {
      removeChip(chips[chips.length - 1]);
    }
  };
  // In a fleet the field sits inside the canvas, which must not see its keys. The native
  // listener also stops them before React: the Input's own key handling never runs, these keys rule.
  useNativeKeyDown(field, onKeyDown);
  // The same for every key of the composer: Tab can bring the keyboard to Send or to a chip's ✕, and
  // a Backspace there must not delete the node. The field's keys stop at the field and never get here.
  const root = useRef<HTMLFormElement>(null);
  useNativeKeyDown(root, () => undefined);

  // A click on a chip's ✕ or on Send leaves the caret in the field, never the keyboard on a button the canvas would read.
  const keepCaret = (e: ReactMouseEvent<HTMLButtonElement>) => e.preventDefault();

  // An empty field shows its keys as keycaps, where the placeholder used to spell them out.
  const showKeys = !compact && text === "" && chips.length === 0;
  const chipLabels = chips.map((target) => labels.get(targetKey(target)) ?? "");
  // The field's description: who the chips send to, then its keys.
  const describedBy = [chips.length > 0 ? `${listId}-to` : null, showKeys ? `${listId}-keys` : null].filter((id) => id !== null).join(" ");

  return (
    <ComposerPrimitive.Root ref={root} className="relative flex min-w-0 flex-1 items-end gap-2">
      {listOpen && (
        <ul
          id={listId}
          role="listbox"
          className={cn("dp-glass-strong absolute bottom-full left-0 z-10 mb-2 overflow-hidden rounded-lg p-1", parts ? "w-72" : "w-96 max-w-full")}
        >
          {suggestions.map((suggestion, i) => (
            <li
              key={suggestion.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === row}
              title={suggestion.detail}
              onMouseDown={(e) => {
                e.preventDefault();
                suggestion.pick();
              }}
              onMouseMove={() => i !== row && setActive(i)}
              // No transition: the highlight follows the arrow keys at once.
              className={cn("flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-xs", i === row ? "bg-dp-hover text-dp-text" : "text-dp-text-2")}
            >
              {suggestion.target && <TargetIcon target={suggestion.target} />}
              <span className="shrink-0 font-mono text-dp-text">{suggestion.label}</span>
              <span className="ml-auto truncate">{suggestion.detail}</span>
              {suggestion.target?.kind === "agent" && <AgentStatusDot id={suggestion.target.id} />}
            </li>
          ))}
        </ul>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {(text.trim() || focused) && nothingTargeted && <p className="text-xs text-dp-text-2">{emptyHint}</p>}
        {text.trim() && noAgents && !unknown && <p className="text-xs text-dp-text-2">{t.noAgents}</p>}
        {unknown && <p className="text-xs text-dp-text-2">{t.unknownTarget(unknown)}</p>}
        {text.trim() && namedFallback && !unknown && <p className="text-xs text-dp-text-2">{t.sendsTo(namedFallback)}</p>}
        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-1",
            // In a node's foot the field is the line itself: 28px, a hairline at rest, the focus ring once written in.
            compact &&
              "min-h-7 rounded-md bg-dp-field px-1 ring-1 ring-dp-line ring-inset focus-within:ring-2 focus-within:ring-dp-accent/70",
          )}
        >
          {/*
            The chips are a list of their own, "Targets", each ✕ named after its chip. The list adds no box (contents):
            its chips wrap with the field, as before; the explicit roles keep it a list without its own layout.
          */}
          {chips.length > 0 && (
            <ul role="list" aria-label={t.targets} className="contents">
              {chips.map((target, i) => (
                <li
                  key={targetKey(target)}
                  role="listitem"
                  data-target-chip
                  className="flex h-6 items-center gap-1 rounded-sm bg-dp-accent-soft pl-2 pr-1 font-mono text-xs text-dp-text"
                >
                  {chipLabels[i]}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t.remove(chipLabels[i])}
                    onMouseDown={keepCaret}
                    onClick={() => removeChip(target)}
                    className="size-4 rounded-sm text-dp-text-2 hover:bg-dp-hover hover:text-dp-text"
                  >
                    <X className="size-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {/* Who the chips send to, read with the field: they empty its placeholder, and sit before it. */}
          {chips.length > 0 && (
            <span id={`${listId}-to`} hidden>
              {t.to(chipLabels)}
            </span>
          )}
          <ComposerPrimitive.Input
            ref={field}
            minRows={1}
            // A name of its own: the placeholder empties once a chip is there, and a field must keep its name (WCAG 4.1.2).
            aria-label={label}
            placeholder={chips.length > 0 ? "" : placeholder}
            // The keys are this field's (see useNativeKeyDown); the composer neither submits, cancels nor attaches by itself:
            // a send carries text only (messageText), so a pasted image goes in as its file's path instead.
            submitMode="none"
            cancelOnEscape={false}
            addAttachmentOnPaste={false}
            onPaste={(e) => takeOverPaste(e, insertPath)}
            aria-autocomplete="list"
            aria-controls={listOpen ? listId : undefined}
            aria-activedescendant={listOpen ? `${listId}-${row}` : undefined}
            aria-describedby={describedBy || undefined}
            onChange={(e) => typed(e.target.value, e.target.selectionStart)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSelect={(e) => {
              const at = e.currentTarget.selectionStart;
              if (at !== caret) setActive(0);
              setCaret(at);
            }}
            // One line is 32px tall, as Send is (28px in a foot); six lines at most, then it scrolls.
            className={cn(
              "max-h-32 min-w-32 flex-1 resize-none bg-transparent leading-5 text-dp-text caret-dp-accent outline-none placeholder:text-dp-text-2 selection:bg-dp-accent-soft",
              compact ? "px-1 py-1 text-xs" : "py-1.5 text-(length:--text-ui)",
            )}
          />
          {showKeys && (
            <span id={`${listId}-keys`} data-field-keys className="flex shrink-0 items-center gap-3 text-xs text-dp-text-3">
              <span className="flex items-center gap-1">
                <Keycap>@</Keycap>
                {t.keys.target}
              </span>
              <span className="flex items-center gap-1">
                <Keycap>/</Keycap>
                {t.keys.command}
              </span>
              <span className="flex items-center gap-1">
                <Keycap>↑</Keycap>
                {t.keys.history}
              </span>
            </span>
          )}
        </div>
      </div>
      <ComposerPrimitive.Send asChild disabled={!canSend}>
        <Button
          size={compact ? "icon-sm" : "default"}
          aria-label={t.send}
          title={canSend ? (namedFallback ? t.sendTo(namedFallback) : t.send) : nothingTargeted ? emptyHint : noAgents ? t.noAgents : t.writeInstruction}
          onMouseDown={keepCaret}
          className={cn(
            // The one primary action, at the control radius the field shares. Grey but legible while there is nothing to send: the hint beside it says why.
            "rounded-md font-medium disabled:bg-dp-field disabled:text-dp-text-3 disabled:opacity-100",
            !compact && "px-3 text-(length:--text-ui)",
          )}
        >
          <ArrowUp className="size-4" />
          {!compact && t.send}
        </Button>
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}
