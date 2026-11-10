import { useEffect, useRef, useState, type ComponentProps, type DragEvent, type FormEvent } from "react";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import { cn } from "@/lib/utils";
import { Bot, Calendar, CircleDot, KanbanSquare, MoreHorizontal, Plus, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMessages } from "@/i18n";
import {
  addCard,
  addColumn,
  cardText,
  dueOf,
  dueState,
  removeCard,
  removeColumn,
  renameColumn,
  updateCard,
  type CardDraft,
  type DuePreset,
} from "@/kanban/board";
import { kanbanWidth } from "@/kanban/width";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { dropCardOutside, startCardDrag } from "@/kanban/dropOnTerminal";
import { createIssueForCard, detectRepo, linkBoard, moveCardWithGithub, parseProject, syncBoard } from "@/kanban/github";
import { useNativeKeyDown } from "@/lib/useNativeKeyDown";
import { AccentButton, Hint, HintedButton, IconButton, QuietButton } from "@/shell/buttons";
import { nodesStore, useNodes } from "@/store/nodes";
import { KANBAN_PRIORITIES, type KanbanBoardLink, type KanbanCard, type KanbanColumn, type KanbanPayload, type KanbanPriority } from "@/nodes/types";
import { KANBAN_CARD_MIME } from "./drag";
import { kanbanNodeMessages } from "./messages";
import { PlanMenu } from "./PlanMenu";

export { KANBAN_CARD_MIME } from "./drag";

type Messages = typeof kanbanNodeMessages;

/** The colour of a priority's dot: none shows nothing, then warmer as it grows. */
const PRIORITY_COLOR: Record<KanbanPriority, string> = {
  none: "transparent",
  low: "var(--dp-ok)",
  medium: "var(--dp-wait)",
  high: "var(--dp-danger)",
};

type Editing = { mode: "new"; columnId: string } | { mode: "edit"; cardId: string };

/** A card's meta (priority, due date, issue, agent): small quiet tags, 6px corners inside the card's 8. */
const CHIP = "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs";

/** A chip with a hint when it has one to give: the system's own title would stack with the app's hints. */
function Tag({ hint, ...props }: ComponentProps<"span"> & { hint?: string }) {
  const chip = <span {...props} />;
  return hint ? <Hint label={hint}>{chip}</Hint> : chip;
}

/** A choice of the card dialog: a hairline, filled with the soft ink once chosen. The due dates and the priorities share it. */
const CHOICE =
  "h-7 min-w-0 gap-1.5 rounded-md border border-dp-line px-2 text-xs font-normal text-dp-text-2 transition-[color,background-color,border-color,scale] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none hover:bg-dp-hover hover:text-dp-text focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97] data-[state=on]:border-dp-accent data-[state=on]:bg-dp-accent-soft data-[state=on]:text-dp-text";

/** Where a dragged card would land. */
interface DropSpot {
  columnId: string;
  index: number;
}

/** The board as it is now, read when acting rather than when rendered. */
function currentBoard(nodeId: string): KanbanPayload | null {
  const record = nodesStore.getState().nodes[nodeId];
  return record?.kind === "kanban" ? record.payload : null;
}

function commit(nodeId: string, change: (board: KanbanPayload) => KanbanPayload) {
  const board = currentBoard(nodeId);
  if (!board) return;
  const next = change(board);
  if (next !== board) nodesStore.getState().update(nodeId, { columns: next.columns, cards: next.cards });
}

/** The node grows (or shrinks) to the right so every column shows; its height stays the user's. Not an undo step. */
function fitWidth(nodeId: string, columnCount: number) {
  const api = canvasStore.getState().api;
  const element = api?.getSceneElementsIncludingDeleted().find((e) => e.id === nodeId);
  const width = kanbanWidth(columnCount);
  if (!api || !element || element.isDeleted || element.width === width) return;
  api.updateScene({
    elements: api.getSceneElementsIncludingDeleted().map((e) => (e.id === nodeId ? newElementWith(e, { width }) : e)),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

/** A Kanban board on the canvas (issue #29): columns of cards, dragged between them or onto a terminal. */
export function KanbanNode({ nodeId }: { nodeId: string }) {
  const t = useMessages(kanbanNodeMessages);
  const record = useNodes((s) => s.nodes[nodeId]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [spot, setSpot] = useState<DropSpot | null>(null);
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // The wheel scrolls the board, not the canvas (Excalidraw listens below React's root).
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const listener = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
    };
    element.addEventListener("wheel", listener);
    return () => element.removeEventListener("wheel", listener);
  }, [record?.kind]);

  const api = useCanvas((s) => s.api);
  const columnCount = record?.kind === "kanban" ? record.payload.columns.length : null;
  useEffect(() => {
    if (api && columnCount !== null) fitWidth(nodeId, columnCount);
  }, [api, nodeId, columnCount]);

  if (record?.kind !== "kanban") return null;
  const board = record.payload;

  const sync = async () => {
    setSyncing(true);
    try {
      await syncBoard(nodeId);
    } finally {
      setSyncing(false);
    }
  };

  const newColumn = () => {
    commit(nodeId, (b) => addColumn(b, t.newColumn));
    const columns = currentBoard(nodeId)?.columns;
    if (columns?.length) setRenaming(columns[columns.length - 1].id);
  };

  const onCardDragStart = (e: DragEvent, card: KanbanCard) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData(KANBAN_CARD_MIME, JSON.stringify({ nodeId, cardId: card.id }));
    e.dataTransfer.setData("text/plain", cardText(card));
    startCardDrag(nodeId, card.id);
    setDragged(card.id);
  };

  const onCardDragEnd = (e: DragEvent, cardId: string) => {
    setDragged(null);
    setSpot(null);
    if (e.dataTransfer.dropEffect === "none") dropCardOutside(nodeId, cardId, e.clientX, e.clientY);
  };

  /** The index among the column's cards, the dragged one left out, above which the pointer is. */
  const spotIn = (e: DragEvent<HTMLElement>, columnId: string): DropSpot => {
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-card-id]")].filter((el) => el.dataset.cardId !== dragged);
    const index = cards.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top + rect.height / 2 < e.clientY;
    }).length;
    return { columnId, index };
  };

  const onColumnDragOver = (e: DragEvent<HTMLElement>, columnId: string) => {
    if (!dragged || !e.dataTransfer.types.includes(KANBAN_CARD_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const next = spotIn(e, columnId);
    if (next.columnId !== spot?.columnId || next.index !== spot.index) setSpot(next);
  };

  const onColumnDrop = (e: DragEvent<HTMLElement>, columnId: string) => {
    if (!dragged) return;
    e.preventDefault();
    const { index } = spotIn(e, columnId);
    const cardId = dragged;
    // A linked card's issue follows on GitHub; the card moves locally either way.
    void moveCardWithGithub(nodeId, cardId, columnId, index);
    setSpot(null);
  };

  const editedCard = editing?.mode === "edit" ? board.cards[editing.cardId] : undefined;
  const editedColumn = editing?.mode === "new" ? board.columns.find((c) => c.id === editing.columnId) : undefined;

  return (
    <div data-kanban={nodeId} className="flex h-full flex-col overflow-hidden rounded-xl border border-dp-line bg-dp-surface text-dp-text">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-dp-line px-3">
        <KanbanSquare className="size-4 shrink-0 text-dp-text-2" />
        <span className="truncate text-(length:--text-ui) font-medium text-dp-text">{t.title}</span>
        {board.github && (
          <span className="truncate font-mono text-xs text-dp-text-2" title={t.github.linkedTo(board.github.repo)}>
            {board.github.repo}
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-xs text-dp-text-2 tabular-nums">{t.cardCount(Object.keys(board.cards).length)}</span>
        {board.github && (
          <Button size="sm" variant="ghost" className="gap-1 px-2 text-xs font-normal" disabled={syncing} onClick={() => void sync()}>
            {/* Turns while the sync is under way: it is live. */}
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin motion-reduce:animate-none")} />
            {syncing ? t.github.syncing : t.github.sync}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={t.github.boardMenu}>
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => setLinking(true)}>{board.github ? t.github.editLink : t.github.link}</DropdownMenuItem>
            {board.github && (
              <>
                <DropdownMenuItem onSelect={() => void sync()}>{t.github.sync}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => linkBoard(nodeId, null)}>
                  {t.github.unlink}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={newColumn}>{t.addColumn}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div ref={scroller} className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden p-3">
        {board.columns.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-dp-text-2">
            <p>{t.empty}</p>
            <AccentButton size="sm" onClick={newColumn}>
              <Plus />
              {t.addColumn}
            </AccentButton>
          </div>
        ) : (
          <>
            {board.columns.map((column) => (
              <ColumnView
                key={column.id}
                t={t}
                boardId={nodeId}
                column={column}
                cards={column.cardIds.map((id) => board.cards[id]).filter((c): c is KanbanCard => !!c)}
                renaming={renaming === column.id}
                onRenameStart={() => setRenaming(column.id)}
                onRenameDone={(title) => {
                  if (title !== null && title.trim()) commit(nodeId, (b) => renameColumn(b, column.id, title.trim()));
                  setRenaming(null);
                }}
                onRemove={() => commit(nodeId, (b) => removeColumn(b, column.id))}
                onNewCard={() => setEditing({ mode: "new", columnId: column.id })}
                onOpenCard={(cardId) => setEditing({ mode: "edit", cardId })}
                dragged={dragged}
                spot={spot?.columnId === column.id ? spot.index : null}
                onCardDragStart={onCardDragStart}
                onCardDragEnd={onCardDragEnd}
                onDragOver={(e) => onColumnDragOver(e, column.id)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSpot((s) => (s?.columnId === column.id ? null : s));
                }}
                onDrop={(e) => onColumnDrop(e, column.id)}
              />
            ))}
            {/* Where the next column goes: a dashed outline of one. */}
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={newColumn}
              className="w-56 justify-start gap-2 rounded-lg border-dashed bg-transparent px-3 text-(length:--text-ui) font-normal text-dp-text-2 hover:text-dp-text"
            >
              <Plus className="size-4" />
              {t.addColumn}
            </Button>
          </>
        )}
      </div>
      <CardDialog
        key={editing ? (editing.mode === "new" ? `new-${editing.columnId}` : editing.cardId) : "closed"}
        t={t}
        open={editing !== null && (editedCard !== undefined || editedColumn !== undefined)}
        title={editedCard ? t.editCard : t.addCardTo(editedColumn?.title ?? "")}
        initial={editedCard}
        onCreateIssue={editedCard && !editedCard.github && board.github ? () => createIssueForCard(nodeId, editedCard.id) : undefined}
        onClose={() => setEditing(null)}
        onSave={(draft) => {
          if (editing?.mode === "new") commit(nodeId, (b) => addCard(b, editing.columnId, draft));
          else if (editing?.mode === "edit") commit(nodeId, (b) => updateCard(b, editing.cardId, draft));
          setEditing(null);
        }}
        onDelete={
          editedCard
            ? () => {
                commit(nodeId, (b) => removeCard(b, editedCard.id));
                setEditing(null);
              }
            : undefined
        }
      />
      {linking && (
        <LinkDialog
          t={t}
          initial={board.github}
          onClose={() => setLinking(false)}
          onLink={(link) => {
            linkBoard(nodeId, link);
            setLinking(false);
            void sync();
          }}
        />
      )}
    </div>
  );
}

const REPO = /^[\w.-]+\/[\w.-]+$/;

/** "Link to GitHub": the repository, detected from the project's origin, and optionally a Project (v2). */
function LinkDialog({
  t,
  initial,
  onClose,
  onLink,
}: {
  t: Messages;
  initial?: KanbanBoardLink;
  onClose: () => void;
  onLink: (link: KanbanBoardLink) => void;
}) {
  const [repo, setRepo] = useState(initial?.repo ?? "");
  const [project, setProject] = useState(initial?.project ? `${initial.project.owner}/${initial.project.number}` : "");
  const [detecting, setDetecting] = useState(!initial);
  const [notDetected, setNotDetected] = useState(false);

  useEffect(() => {
    if (initial) return;
    let live = true;
    void detectRepo()
      .catch(() => null)
      .then((found) => {
        if (!live) return;
        setDetecting(false);
        if (found) setRepo((typed) => typed || found);
        else setNotDetected(true);
      });
    return () => {
      live = false;
    };
  }, [initial]);

  const repoValid = REPO.test(repo.trim());
  const parsedProject = project.trim() ? parseProject(project) : undefined;
  const projectValid = parsedProject !== null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!repoValid || !projectValid) return;
    const link: KanbanBoardLink = { repo: repo.trim() };
    if (parsedProject) link.project = parsedProject;
    onLink(link);
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t.github.linkTitle}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-dp-text-2">{t.github.linkHint}</p>
          <div className="grid gap-1.5">
            <Label htmlFor="kanban-github-repo">{t.github.repo}</Label>
            <Input
              id="kanban-github-repo"
              autoFocus
              value={repo}
              placeholder={detecting ? t.github.detecting : t.github.repoPlaceholder}
              onChange={(e) => setRepo(e.target.value)}
            />
            {repo.trim() && !repoValid && <p className="text-xs text-dp-danger">{t.github.repoInvalid}</p>}
            {notDetected && !repo.trim() && <p className="text-xs text-dp-text-2">{t.github.notDetected}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="kanban-github-project">{t.github.project}</Label>
            <Input
              id="kanban-github-project"
              value={project}
              placeholder={t.github.projectPlaceholder}
              onChange={(e) => setProject(e.target.value)}
            />
            {!projectValid && <p className="text-xs text-dp-danger">{t.github.projectInvalid}</p>}
          </div>
          <DialogFooter>
            <QuietButton onClick={onClose}>{t.cancel}</QuietButton>
            <AccentButton type="submit" size="lg" disabled={!repoValid || !projectValid}>
              {t.github.confirm}
            </AccentButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ColumnViewProps {
  t: Messages;
  boardId: string;
  column: KanbanColumn;
  cards: KanbanCard[];
  renaming: boolean;
  onRenameStart: () => void;
  onRenameDone: (title: string | null) => void;
  onRemove: () => void;
  onNewCard: () => void;
  onOpenCard: (cardId: string) => void;
  dragged: string | null;
  spot: number | null;
  onCardDragStart: (e: DragEvent, card: KanbanCard) => void;
  onCardDragEnd: (e: DragEvent, cardId: string) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

function ColumnView(props: ColumnViewProps) {
  const { t, column, cards, dragged, spot } = props;
  const shown = cards.filter((c) => c.id !== dragged);
  const indicator = <div className="h-0.5 shrink-0 rounded-full bg-dp-accent" />;
  return (
    <section
      data-column-id={column.id}
      className="flex w-60 shrink-0 flex-col rounded-lg bg-dp-surface"
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 px-3">
        {props.renaming ? (
          <TitleInput initial={column.title} onDone={props.onRenameDone} />
        ) : (
          <Hint label={t.doubleClickRename} side="bottom">
            <h3 className="truncate text-(length:--text-ui) font-medium text-dp-text" onDoubleClick={props.onRenameStart}>
              {column.title}
            </h3>
          </Hint>
        )}
        {/* A count is quiet text, not a pill. */}
        <span data-testid="column-count" className="font-mono text-xs text-dp-text-2 tabular-nums">
          {cards.length}
        </span>
        <span className="ml-auto flex items-center">
          <IconButton label={t.newCard} onClick={props.onNewCard}>
            <Plus />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={t.columnMenu(column.title)}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={props.onRenameStart}>{t.rename}</DropdownMenuItem>
              <PlanMenu boardId={props.boardId} columnId={column.id} />
              <DropdownMenuItem variant="destructive" onSelect={props.onRemove}>
                {t.removeColumn}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {cards.map((card) => {
          const index = shown.indexOf(card);
          return (
            <div key={card.id} className="contents">
              {spot !== null && index === spot && indicator}
              <CardView
                t={t}
                card={card}
                dragging={card.id === dragged}
                onOpen={() => props.onOpenCard(card.id)}
                onDragStart={(e) => props.onCardDragStart(e, card)}
                onDragEnd={(e) => props.onCardDragEnd(e, card.id)}
              />
            </div>
          );
        })}
        {spot !== null && spot >= shown.length && indicator}
        <Button
          type="button"
          variant="ghost"
          onClick={props.onNewCard}
          className="justify-start gap-2 px-2 text-xs font-normal text-dp-text-2 hover:text-dp-text active:scale-100"
        >
          <Plus className="size-4" />
          {t.newCard}
        </Button>
      </div>
    </section>
  );
}

function CardView({
  t,
  card,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  t: Messages;
  card: KanbanCard;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: (e: DragEvent) => void;
}) {
  const overdue = card.due !== undefined && dueState(card.due) === "overdue";
  return (
    <div
      data-card-id={card.id}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        "relative shrink-0 cursor-grab overflow-hidden rounded-md border border-dp-line bg-dp-card px-3 py-2 text-left text-dp-text shadow-dp transition-[border-color,opacity] duration-(--dp-dur-fast) ease-(--dp-ease-out) hover:border-dp-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 motion-reduce:transition-none",
        dragging && "opacity-40",
      )}
    >
      <p className="text-(length:--text-ui) leading-snug font-medium break-words text-dp-text">{card.title}</p>
      {(card.priority !== "none" || card.due || card.github || card.agent) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {/* The priority, as the dialog shows it: its dot and its word, no coloured stripe down the card. */}
          {card.priority !== "none" && (
            <span data-priority={card.priority} className={cn(CHIP, "bg-dp-surface text-dp-text-2")}>
              <span className="size-1.5 rounded-full" style={{ background: PRIORITY_COLOR[card.priority] }} />
              {t.priorities[card.priority]}
            </span>
          )}
          {card.due && (
            <Tag hint={overdue ? t.overdue : undefined} className={cn(CHIP, overdue ? "bg-dp-danger/15 text-dp-danger" : "bg-dp-surface text-dp-text-2")}>
              <Calendar className="size-3" />
              {formatDue(card.due)}
            </Tag>
          )}
          {card.github && (
            <HintedButton
              hint={t.githubIssue(card.github.repo, card.github.number)}
              variant="ghost"
              aria-label={t.githubIssue(card.github.repo, card.github.number)}
              onClick={(e) => {
                e.stopPropagation();
                if (card.github?.url) void openUrl(card.github.url).catch(() => undefined);
              }}
              className={cn(
                CHIP,
                "h-auto bg-dp-surface font-mono font-normal hover:bg-dp-hover hover:text-dp-text",
                card.github.state === "closed" ? "text-dp-text" : "text-dp-text-2",
              )}
            >
              <CircleDot className="size-3" />#{card.github.number}
            </HintedButton>
          )}
          {card.agent && (
            <Tag
              hint={card.agentStatus ? t.agentAlert[card.agentStatus](card.agent) : t.agentChip(card.agent)}
              data-agent-status={card.agentStatus}
              className={cn(CHIP, card.agentStatus ? "bg-dp-danger/15 text-dp-danger" : "bg-dp-accent-soft text-dp-text")}
            >
              <Bot className="size-3" />
              {card.agent}
            </Tag>
          )}
        </div>
      )}
      {card.notes.trim() && <p className="mt-1 line-clamp-2 text-xs leading-snug text-dp-text-2">{card.notes}</p>}
    </div>
  );
}

/** "28 Oct": the date of a YYYY-MM-DD, without its year. */
function formatDue(due: string): string {
  const [y, m, d] = due.split("-").map(Number);
  if (!y || !m || !d) return due;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(y, m - 1, d));
}

/** A column title being edited: Enter or a click elsewhere keeps it, Escape cancels. */
function TitleInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [draft, setDraft] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useNativeKeyDown(input, (e) => {
    if (e.key === "Enter") input.current?.blur();
    if (e.key === "Escape") {
      cancelled.current = true;
      onDone(null);
    }
  });
  useEffect(() => input.current?.select(), []);
  return (
    <Input
      ref={input}
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!cancelled.current) onDone(draft);
      }}
      className="h-7 min-w-0 flex-1 border-transparent bg-dp-card px-1 text-(length:--text-ui) font-medium md:text-(length:--text-ui)"
    />
  );
}

const DUE_PRESETS: readonly DuePreset[] = ["today", "tomorrow", "nextWeek"];
/** The due choice "None" in the toggle group, beside the presets. */
const NO_DUE = "none";

function CardDialog({
  t,
  open,
  title,
  initial,
  onClose,
  onSave,
  onDelete,
  onCreateIssue,
}: {
  t: Messages;
  open: boolean;
  title: string;
  initial?: KanbanCard;
  /** For a saved card not linked yet, on a linked board. */
  onCreateIssue?: () => Promise<boolean>;
  onClose: () => void;
  onSave: (draft: CardDraft) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.title ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [due, setDue] = useState<string | undefined>(initial?.due);
  const [priority, setPriority] = useState<KanbanPriority>(initial?.priority ?? "none");
  const [creating, setCreating] = useState(false);
  const presetLabel: Record<DuePreset, string> = { today: t.dueToday, tomorrow: t.dueTomorrow, nextWeek: t.dueNextWeek };
  const presets = DUE_PRESETS.map((preset) => ({ preset, date: dueOf(preset) }));
  const custom = due !== undefined && !presets.some((p) => p.date === due);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ title: name.trim(), notes, due, priority });
  };

  // "None" and the presets are one choice; a date typed in the field is the choice of none of them.
  const dueChoice = due === undefined ? NO_DUE : (presets.find((p) => p.date === due)?.preset ?? "");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="kanban-card-title">{t.cardTitle}</Label>
            <Input id="kanban-card-title" autoFocus value={name} placeholder={t.cardTitlePlaceholder} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="kanban-card-notes">{t.notes}</Label>
            {/* Four lines to start with, then it grows with the notes; the user may still resize it. */}
            <Textarea
              id="kanban-card-notes"
              value={notes}
              placeholder={t.notesPlaceholder}
              onChange={(e) => setNotes(e.target.value)}
              className="max-h-60 min-h-24 resize-y py-1.5"
            />
          </div>
          <div className="grid gap-2">
            <Label>{t.due}</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              <ToggleGroup
                type="single"
                aria-label={t.due}
                value={dueChoice}
                onValueChange={(choice) => {
                  if (choice === NO_DUE) setDue(undefined);
                  else if (choice) setDue(presets.find((p) => p.preset === choice)?.date);
                }}
                spacing={1.5}
                className="flex-wrap"
              >
                <ToggleGroupItem value={NO_DUE} className={CHOICE}>
                  {t.dueNone}
                </ToggleGroupItem>
                {presets.map(({ preset }) => (
                  <ToggleGroupItem key={preset} value={preset} className={CHOICE}>
                    {presetLabel[preset]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Input
                type="date"
                aria-label={t.dueDate}
                value={custom ? due : ""}
                onChange={(e) => setDue(e.target.value || undefined)}
                className={cn("h-7 w-auto rounded-md px-2 text-xs md:text-xs", custom ? "border-dp-accent bg-dp-accent-soft text-dp-text" : "text-dp-text-2")}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>{t.priority}</Label>
            {/* The same choices as the due dates above: one h-7 pill, filled once chosen. */}
            <ToggleGroup
              type="single"
              aria-label={t.priority}
              value={priority}
              onValueChange={(p) => p && setPriority(p as KanbanPriority)}
              spacing={1.5}
              className="flex-wrap"
            >
              {KANBAN_PRIORITIES.map((p) => (
                <ToggleGroupItem key={p} value={p} className={CHOICE}>
                  {p !== "none" && <span className="size-2 rounded-full" style={{ background: PRIORITY_COLOR[p] }} />}
                  {t.priorities[p]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <DialogFooter>
            {onDelete && (
              <Button type="button" variant="destructive" size="lg" className="sm:mr-auto" onClick={onDelete}>
                {t.remove}
              </Button>
            )}
            <QuietButton onClick={onClose}>{t.cancel}</QuietButton>
            {onCreateIssue && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={creating}
                onClick={async () => {
                  // The issue is made from what the dialog shows: typed changes are saved first.
                  if (name.trim()) onSave({ title: name.trim(), notes, due, priority });
                  setCreating(true);
                  await onCreateIssue();
                  setCreating(false);
                }}
              >
                {creating ? t.github.creatingIssue : t.github.createIssue}
              </Button>
            )}
            <AccentButton type="submit" size="lg" disabled={!name.trim()}>
              {t.save}
            </AccentButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
