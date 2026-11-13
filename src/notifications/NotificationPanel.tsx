import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Bell, CircleCheck, Info, MessageSquareText, OctagonX, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TOAST_TONES } from "@/components/ui/sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMessages } from "@/i18n";
import { formatAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/useNow";
import { IconButton, ToolButton } from "@/shell/buttons";
import { useProjects } from "@/store/projects";
import { useWorkspaces } from "@/store/workspaces";
import type { ToastKind } from "./capture";
import { openNotification } from "./go";
import { notificationsMessages } from "./messages";
import { planeLabel, planeText } from "./plane";
import { notificationsStore, unreadCount, useNotifications, type NotificationEntry } from "./store";
import { filterCounts, filterNotifications, NOTIFICATION_FILTERS, type NotificationFilter } from "./view";

/** Each kind's own icon shape in its status colour, the popups' own (`TOAST_TONES`): never the colour alone. */
const KIND_ICONS: Record<ToastKind, { Icon: LucideIcon; tone: string }> = {
  success: { Icon: CircleCheck, tone: TOAST_TONES.success },
  error: { Icon: OctagonX, tone: TOAST_TONES.error },
  warning: { Icon: TriangleAlert, tone: TOAST_TONES.warning },
  info: { Icon: Info, tone: TOAST_TONES.info },
  plain: { Icon: MessageSquareText, tone: "text-dp-text-2" },
};

/** One notification: its tone, what it told, its type, where it was about and when. A click goes there. */
function Row(props: {
  entry: NotificationEntry;
  index: number;
  focusable: boolean;
  now: number;
  where: string;
  onGo: (entry: NotificationEntry) => void;
}) {
  const { entry, index, focusable, now, where, onGo } = props;
  const t = useMessages(notificationsMessages);
  const { Icon, tone } = KIND_ICONS[entry.kind];
  return (
    <li>
      <Button
        type="button"
        variant="ghost"
        data-row={index}
        data-unread={!entry.read}
        tabIndex={focusable ? 0 : -1}
        onClick={() => onGo(entry)}
        className="h-auto w-full items-start justify-start gap-2.5 rounded-md px-2 py-2 text-left font-normal whitespace-normal active:scale-100"
      >
        <Icon aria-hidden className={cn("mt-0.5 size-4", tone)} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 text-(length:--text-ui) break-words", entry.read ? "text-dp-text-2" : "font-medium text-dp-text")}>
              {!entry.read && <span className="sr-only">{`${t.unread}. `}</span>}
              {entry.title}
            </span>
            <time dateTime={new Date(entry.at).toISOString()} className="shrink-0 font-mono text-xs text-dp-text-3 tabular-nums">
              {formatAgo(entry.at, now)}
            </time>
          </span>
          {entry.description && <span className="mt-0.5 line-clamp-2 block text-xs break-words text-dp-text-2">{entry.description}</span>}
          <span className="mt-0.5 block truncate text-xs text-dp-text-3">
            <span data-type={entry.type} className="text-dp-text-2">
              {t.types[entry.type]}
            </span>
            {` · ${where}`}
          </span>
        </span>
        {!entry.read && <span aria-hidden data-unread-dot className="mt-1.5 size-2 shrink-0 rounded-full bg-dp-accent" />}
      </Button>
    </li>
  );
}

/** The panel's content: the filters, the list, the two actions. Mounted only while the panel is open. */
function Panel({ onGo, onClose }: { onGo: (entry: NotificationEntry) => void; onClose: () => void }) {
  const t = useMessages(notificationsMessages);
  const entries = useNotifications((s) => s.entries);
  const activeId = useWorkspaces((s) => s.activeId);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const openProjectId = useWorkspaces((s) => s.projectId);
  const projects = useProjects((s) => s.projects);
  const now = useNow(30_000);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [current, setCurrent] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => filterNotifications(entries, filter, activeId), [entries, filter, activeId]);
  const counts = useMemo(() => filterCounts(entries, activeId), [entries, activeId]);
  const unread = unreadCount(entries);
  // One row is in the tab order; the arrows move it. A shorter list keeps it on the last row.
  const focusable = Math.min(current, Math.max(0, shown.length - 1));
  const sources = { workspaces, projectId: openProjectId, projects };

  const focusRow = (index: number) => {
    const row = Math.max(0, Math.min(shown.length - 1, index));
    setCurrent(row);
    root.current?.querySelector<HTMLElement>(`[data-row="${row}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const from = Number((event.target as HTMLElement).closest<HTMLElement>("[data-row]")?.dataset.row ?? focusable);
    const to = { ArrowDown: from + 1, ArrowUp: from - 1, Home: 0, End: shown.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    focusRow(to);
  };
  /** The button that did it goes disabled: the keyboard stays in the panel. */
  const keepFocus = () => root.current?.querySelector<HTMLElement>("[data-close]")?.focus();

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-dp-line px-3">
        <Bell aria-hidden className="size-4 shrink-0 text-dp-text-2" />
        <span className="shrink-0 text-sm font-medium">{t.title}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={unread === 0}
            onClick={() => {
              notificationsStore.getState().markAllRead();
              keepFocus();
            }}
            className="text-dp-text-2 hover:text-dp-text"
          >
            {t.markAllRead}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={entries.length === 0}
            onClick={() => {
              notificationsStore.getState().clear();
              keepFocus();
            }}
            className="text-dp-text-2 hover:text-dp-text"
          >
            {t.clear}
          </Button>
          <IconButton label={t.close} data-close onClick={onClose}>
            <X />
          </IconButton>
        </div>
      </header>
      <ToggleGroup
        type="single"
        aria-label={t.filters}
        value={filter}
        // One filter is always on: pressing it again keeps it.
        onValueChange={(next) => {
          if (!next) return;
          setFilter(next as NotificationFilter);
          setCurrent(0);
        }}
        spacing={0.5}
        className="w-full shrink-0 flex-wrap px-2 pt-2 pb-2"
      >
        {NOTIFICATION_FILTERS.map((id) => (
          <ToggleGroupItem key={id} value={id} data-filter={id} variant="choice" size="sm" className="gap-1 px-2 data-[state=on]:dp-on-soft">
            {t.filter[id]}
            <span className="font-mono text-xs text-dp-text-3 tabular-nums">{counts[id]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {/* A native scroller, like the agents panel's: the panel has only a max-height. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {shown.length === 0 ? (
          <p className="py-4 text-center text-xs text-dp-text-2">{entries.length === 0 ? t.empty : t.noneInFilter}</p>
        ) : (
          <ul aria-label={t.list} onKeyDown={onKeyDown} className="flex flex-col gap-0.5">
            {shown.map((entry, index) => (
              <Row
                key={entry.id}
                entry={entry}
                index={index}
                focusable={index === focusable}
                now={now}
                where={planeText(planeLabel(entry.plane, sources, t.closed), t.noProject)}
                onGo={onGo}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The bell of the right rail and the panel it opens: three kinds of news, newest first, with the project and
 * workspace each was about: an agent that finished, a board whose cards are all done, a question an agent asks
 * (`./capture`). Popups are not kept. A click on one goes there and reads it. The bell's pip counts the unread ones.
 */
export function NotificationsButton() {
  const t = useMessages(notificationsMessages);
  const unread = useNotifications((s) => unreadCount(s.entries));
  const [open, setOpen] = useState(false);
  // Closed by a choice: the view goes to the plane, and the keyboard with it, not back to the bell.
  const leaving = useRef(false);
  const content = useRef<HTMLDivElement>(null);

  const go = (entry: NotificationEntry) => {
    leaving.current = true;
    setOpen(false);
    void openNotification(entry);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        leaving.current = false;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        {/* Its name carries the pip's number: "Notifications, 2 unread" (WCAG 2.5.3 label in name). */}
        <ToolButton hintSide="left" label={unread > 0 ? t.bellUnread(unread) : t.bell}>
          <Bell />
          {unread > 0 && (
            <span
              data-pip
              className="absolute right-0.5 top-0.5 min-w-3.5 rounded-full bg-dp-accent px-1 font-mono text-xs font-medium leading-3.5 tabular-nums text-dp-on-accent"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </ToolButton>
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        side="left"
        align="start"
        sideOffset={12}
        aria-label={t.title}
        className="flex w-96 max-h-[min(36rem,var(--radix-popover-content-available-height))] flex-col overflow-hidden p-0"
        // The keyboard starts on the first notification, so the arrows and Enter work at once.
        onOpenAutoFocus={(event) => {
          const first = content.current?.querySelector<HTMLElement>("[data-row][tabindex='0']");
          if (!first) return;
          event.preventDefault();
          first.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (leaving.current) event.preventDefault();
        }}
      >
        <Panel onGo={go} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
