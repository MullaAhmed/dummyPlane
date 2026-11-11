import { useEffect, useRef, useState, type ComponentProps, type DragEvent, type FormEvent } from "react";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import { cn } from "@/lib/utils";
import { Bot, Calendar, CircleDot, KanbanSquare, MoreHorizontal, Plus, RefreshCw, SignalHigh, SignalLow, SignalMedium, type LucideIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMessages } from "@/i18n";
import { AGENTS } from "@/agents/catalog";
import {
  addCard,
  addColumn,
  cardText,
  columnOf,
  dueOf,
  dueState,
  removeCard,
  removeColumn,
  renameColumn,
  restoreCard,
  restoreColumn,
  updateCard,
  type CardDraft,
  type DuePreset,
} from "@/kanban/board";
import { kanbanWidth } from "@/kanban/width";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { nodeKindOf } from "@/canvas/nodeElement";
import { endCardDrag, sendCardToTerminal, startCardDrag } from "@/kanban/dropOnTerminal";
import { createIssueForCard, detectRepo, linkBoard, moveCardWithGithub, parseProject, syncBoard } from "@/kanban/github";
import { useNativeKeyDown } from "@/lib/useNativeKeyDown";
import { AccentButton, Hint, IconButton, QuietButton } from "@/shell/buttons";
import { nodesStore, terminalOf, useNodes } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { KANBAN_PRIORITIES, type KanbanBoardLink, type KanbanCard, type KanbanColumn, type KanbanPayload, type KanbanPriority } from "@/nodes/types";
import { KANBAN_CARD_MIME } from "./drag";
import { kanbanNodeMessages } from "./messages";
import { PlanMenu } from "./PlanMenu";

export { KANBAN_CARD_MIME } from "./drag";

type Messages = typeof kanbanNodeMessages;

/**
 * A priority's mark: bars that fill as it grows, in the chip's own ink. Not a dot, which is an agent's status,
 * and not the status colours (ok, wait, danger), which would read as one.
 */
const PRIORITY_MARK: Record<Exclude<KanbanPriority, "none">, LucideIcon> = {
  low: SignalLow,
  medium: SignalMedium,
  high: SignalHigh,
};

function PriorityMark({ priority }: { priority: KanbanPriority }) {
  if (priority === "none") return null;
  const Mark = PRIORITY_MARK[priority];
  return <Mark aria-hidden data-priority-mark className="size-3 shrink-0" />;
}

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
  "gap-1.5 border-dp-line px-2";

/** Where a dragged card would land; where a card moved from the keyboard lands. */
interface DropSpot {
  columnId: string;
  index: number;
}

/** The keyboard's alternative to a drag (WCAG 2.5.7): Alt and an arrow move the card a column or a place. */
export type CardStep = "left" | "right" | "up" | "down";

const STEP_KEYS: Record<string, CardStep> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

/** The terminals of the canvas the board is on: where a drop could send a card. */
function sceneTerminals(): { id: string; name: string }[] {
  const elements = canvasStore.getState().api?.getSceneElements() ?? [];
  const nodes = nodesStore.getState().nodes;
  return elements
    .filter((e) => !e.isDeleted && nodeKindOf(e) === "terminal")
    .flatMap((e) => {
      const payload = terminalOf(nodes[e.id]);
      return payload ? [{ id: e.id, name: payload.name || payload.title || AGENTS[payload.agent].label }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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

/**
 * Deletes a column and its cards, or a card, at once, and offers to take it back: a node's payload is outside
 * the canvas's undo history. The undo puts back what was removed, where it was, without undoing what changed since.
 */
function removeColumnUndoable(nodeId: string, columnId: string, t: Messages) {
  const board = currentBoard(nodeId);
  const index = board?.columns.findIndex((c) => c.id === columnId) ?? -1;
  if (!board || index < 0) return;
  const column = board.columns[index];
  const cards = Object.fromEntries(column.cardIds.flatMap((id) => (board.cards[id] ? [[id, board.cards[id]] as const] : [])));
  commit(nodeId, (b) => removeColumn(b, columnId));
  toast(t.columnRemoved(column.title, Object.keys(cards).length), {
    action: { label: t.undo, onClick: () => commit(nodeId, (b) => restoreColumn(b, column, cards, index)) },
  });
}

function removeCardUndoable(nodeId: string, cardId: string, t: Messages) {
  const board = currentBoard(nodeId);
  const card = board?.cards[cardId];
  const column = board && columnOf(board, cardId);
  if (!card || !column) return;
  const index = column.cardIds.indexOf(cardId);
  commit(nodeId, (b) => removeCard(b, cardId));
  toast(t.cardRemoved(card.title), {
    action: { label: t.undo, onClick: () => commit(nodeId, (b) => restoreCard(b, card, column.id, index)) },
  });
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
  // A card moved from the keyboard keeps it: it is focused again where it lands (a GitHub-linked one lands later).
  const [landing, setLanding] = useState<(DropSpot & { cardId: string }) | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const landedColumn = record?.kind === "kanban" && landing ? record.payload.columns.find((c) => c.id === landing.columnId) : undefined;
  const landed = landing !== null && landedColumn?.cardIds[landing.index] === landing.cardId;
  useEffect(() => {
    if (!landing || !landed) return;
    const column = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-column-id]") ?? [])].find((c) => c.dataset.columnId === landing.columnId);
    const card = [...(column?.querySelectorAll<HTMLElement>("[data-card-id]") ?? [])].find((c) => c.dataset.cardId === landing.cardId);
    card?.querySelector<HTMLElement>("[data-card-open]")?.focus();
    setLanding(null);
  }, [landing, landed]);

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

  // Every drag ends here, dropped, moved or cancelled: only a drop on a terminal sends the card.
  const onCardDragEnd = () => {
    setDragged(null);
    setSpot(null);
    endCardDrag();
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

  /** A move from the card's menu or its keys (no index: the column's end): it keeps the keyboard and says where it went. */
  const moveCardTo = (cardId: string, columnId: string, index?: number) => {
    const column = currentBoard(nodeId)?.columns.find((c) => c.id === columnId);
    if (!column) return;
    const others = column.cardIds.filter((id) => id !== cardId).length;
    const at = index === undefined ? others : Math.max(0, Math.min(index, others));
    setLanding({ cardId, columnId, index: at });
    setAnnouncement(t.card.moved(column.title, at + 1, others + 1));
    void moveCardWithGithub(nodeId, cardId, columnId, at);
  };

  const stepCard = (cardId: string, step: CardStep) => {
    const columns = currentBoard(nodeId)?.columns ?? [];
    const from = columns.findIndex((c) => c.cardIds.includes(cardId));
    if (from < 0) return;
    const index = columns[from].cardIds.indexOf(cardId);
    if (step === "left" && from > 0) moveCardTo(cardId, columns[from - 1].id);
    if (step === "right" && from < columns.length - 1) moveCardTo(cardId, columns[from + 1].id);
    if (step === "up" && index > 0) moveCardTo(cardId, columns[from].id, index - 1);
    if (step === "down" && index < columns[from].cardIds.length - 1) moveCardTo(cardId, columns[from].id, index + 1);
  };

  const editedCard = editing?.mode === "edit" ? board.cards[editing.cardId] : undefined;
  const editedColumn = editing?.mode === "new" ? board.columns.find((c) => c.id === editing.columnId) : undefined;

  return (
    <div ref={rootRef} data-kanban={nodeId} className="flex h-full flex-col overflow-hidden rounded-xl border border-dp-line bg-dp-surface text-dp-text">
      {/* Mounted from the start: a live region that appears with its text is not announced. */}
      <span role="status" className="sr-only">
        {announcement}
      </span>
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
            <RefreshCw className={cn("size-3.5", syncing && "motion-safe:animate-spin")} />
            {syncing ? t.github.syncing : t.github.sync}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={t.github.boardMenu}>
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          {/* The menu does not hand the keyboard back to its button while the link mode runs: the mode's list has it. */}
          <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={(e) => uiStore.getState().linking === nodeId && e.preventDefault()}>
            {/* The link mode (agents/LinkMode.tsx), started from the board: a click on an agent or a Fleet wires it here. */}
            <DropdownMenuItem onSelect={() => uiStore.getState().setLinking(nodeId)}>{t.linkAgent}</DropdownMenuItem>
            <DropdownMenuSeparator />
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
                onRemove={() => removeColumnUndoable(nodeId, column.id, t)}
                onNewCard={() => setEditing({ mode: "new", columnId: column.id })}
                onOpenCard={(cardId) => setEditing({ mode: "edit", cardId })}
                columns={board.columns}
                onMoveCard={moveCardTo}
                onStepCard={stepCard}
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
                removeCardUndoable(nodeId, editedCard.id, t);
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
  // A field's error shows once the user leaves it wrong, or tries to link: not at the first keystroke.
  const [checked, setChecked] = useState({ repo: false, project: false });
  const repoField = useRef<HTMLInputElement>(null);
  const projectField = useRef<HTMLInputElement>(null);

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
  const repoError = checked.repo && !repoValid;
  const projectError = checked.project && !projectValid;
  const hintNotDetected = notDetected && !repo.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!repoValid || !projectValid) {
      setChecked({ repo: true, project: true });
      (repoValid ? projectField : repoField).current?.focus();
      return;
    }
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
              ref={repoField}
              id="kanban-github-repo"
              autoFocus
              value={repo}
              placeholder={detecting ? t.github.detecting : t.github.repoPlaceholder}
              onChange={(e) => {
                setRepo(e.target.value);
                // Right again, the error goes at once; wrong again, it waits for the next blur.
                if (REPO.test(e.target.value.trim())) setChecked((c) => ({ ...c, repo: false }));
              }}
              // Left empty, it waits for a submit to say so.
              onBlur={() => setChecked((c) => ({ ...c, repo: !repoValid && (c.repo || repo.trim() !== "") }))}
              aria-invalid={repoError || undefined}
              aria-describedby={repoError ? "kanban-github-repo-error" : hintNotDetected ? "kanban-github-repo-hint" : undefined}
            />
            {repoError && (
              <p id="kanban-github-repo-error" className="text-xs text-dp-danger">
                {t.github.repoInvalid}
              </p>
            )}
            {hintNotDetected && (
              <p id="kanban-github-repo-hint" className="text-xs text-dp-text-2">
                {t.github.notDetected}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="kanban-github-project">{t.github.project}</Label>
            <Input
              ref={projectField}
              id="kanban-github-project"
              value={project}
              placeholder={t.github.projectPlaceholder}
              onChange={(e) => {
                setProject(e.target.value);
                if (!e.target.value.trim() || parseProject(e.target.value) !== null) setChecked((c) => ({ ...c, project: false }));
              }}
              onBlur={() => setChecked((c) => ({ ...c, project: !projectValid }))}
              aria-invalid={projectError || undefined}
              aria-describedby={projectError ? "kanban-github-project-error" : undefined}
            />
            {projectError && (
              <p id="kanban-github-project-error" className="text-xs text-dp-danger">
                {t.github.projectInvalid}
              </p>
            )}
          </div>
          <DialogFooter>
            <QuietButton onClick={onClose}>{t.cancel}</QuietButton>
            {/* Enabled: a submit says what is wrong and focuses that field, where a greyed button would not. */}
            <AccentButton type="submit" size="lg">
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
  /** Every column of the board, for a card's "Move to". */
  columns: KanbanColumn[];
  onMoveCard: (cardId: string, columnId: string, index?: number) => void;
  onStepCard: (cardId: string, step: CardStep) => void;
  dragged: string | null;
  spot: number | null;
  onCardDragStart: (e: DragEvent, card: KanbanCard) => void;
  onCardDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

function ColumnView(props: ColumnViewProps) {
  const { t, column, cards, dragged, spot } = props;
  const shown = cards.filter((c) => c.id !== dragged);
  const indicator = <div className="h-0.5 shrink-0 rounded-full bg-dp-accent" />;
  return (
    // The column a card would land in is tinted, with no fade: it follows the pointer.
    <section
      data-column-id={column.id}
      data-drop-target={spot !== null || undefined}
      className="flex w-60 shrink-0 flex-col rounded-lg bg-dp-surface data-drop-target:bg-dp-hover"
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
        {cards.map((card, place) => {
          const index = shown.indexOf(card);
          return (
            <div key={card.id} className="contents">
              {spot !== null && index === spot && indicator}
              <CardView
                t={t}
                boardId={props.boardId}
                card={card}
                columnId={column.id}
                columns={props.columns}
                first={place === 0}
                last={place === cards.length - 1}
                dragging={card.id === dragged}
                onOpen={() => props.onOpenCard(card.id)}
                onMove={(columnId, at) => props.onMoveCard(card.id, columnId, at)}
                onStep={(step) => props.onStepCard(card.id, step)}
                onDragStart={(e) => props.onCardDragStart(e, card)}
                onDragEnd={props.onCardDragEnd}
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

/** The keys a card's button answers, besides Enter and Space that open it. */
const CARD_KEYS = "Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown";

function CardView({
  t,
  boardId,
  card,
  columnId,
  columns,
  first,
  last,
  dragging,
  onOpen,
  onMove,
  onStep,
  onDragStart,
  onDragEnd,
}: {
  t: Messages;
  boardId: string;
  card: KanbanCard;
  columnId: string;
  columns: KanbanColumn[];
  first: boolean;
  last: boolean;
  dragging: boolean;
  onOpen: () => void;
  onMove: (columnId: string, index?: number) => void;
  onStep: (step: CardStep) => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const overdue = card.due !== undefined && dueState(card.due) === "overdue";
  const button = useRef<HTMLButtonElement>(null);
  // Its keys stop at the button (useNativeKeyDown): Excalidraw would nudge the node on an arrow, delete it on Backspace.
  useNativeKeyDown(button, (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
      return;
    }
    const step = STEP_KEYS[e.key];
    if (!step || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    // Alt+Left is the webview's Back as well.
    e.preventDefault();
    onStep(step);
  });
  return (
    // The pointer opens and drags the whole card; the keyboard reaches its button, whose focus rings the card.
    <div
      data-card-id={card.id}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        "group/card relative shrink-0 cursor-grab overflow-hidden active:cursor-grabbing rounded-md border border-dp-line bg-dp-card px-3 py-2 text-left text-dp-text shadow-dp transition-[border-color,opacity] duration-(--dp-dur-fast) ease-(--dp-ease-out) hover:border-dp-text-3 has-[[data-card-open]:focus-visible]:ring-2 has-[[data-card-open]:focus-visible]:ring-dp-accent/70 motion-reduce:transition-none",
        dragging && "opacity-40",
      )}
    >
      <button
        ref={button}
        type="button"
        data-card-open
        aria-keyshortcuts={CARD_KEYS}
        // Under the pointer it is the card: a drag still starts on the card, a click still opens it.
        className="pointer-events-none block w-full pr-6 text-left text-(length:--text-ui) leading-snug font-medium break-words text-dp-text focus-visible:outline-none"
      >
        {card.title}
      </button>
      <CardMenu
        t={t}
        boardId={boardId}
        cardId={card.id}
        issueUrl={card.github?.url}
        columnId={columnId}
        columns={columns}
        first={first}
        last={last}
        focusCard={() => button.current?.focus()}
        onMove={onMove}
        onStep={onStep}
      />
      {(card.priority !== "none" || card.due || card.github || card.agent) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {/* The priority, as the dialog shows it: its bars and its word, no coloured stripe down the card. */}
          {card.priority !== "none" && (
            <span data-priority={card.priority} className={cn(CHIP, "bg-dp-surface text-dp-text-2")}>
              <PriorityMark priority={card.priority} />
              {t.priorities[card.priority]}
            </span>
          )}
          {/* A warning's words stay in the text ink (danger at 12px misses 4.5:1 on its tint); its icon carries the danger. */}
          {card.due && (
            <Tag
              hint={overdue ? t.overdue : undefined}
              data-overdue={overdue || undefined}
              className={cn(CHIP, overdue ? "bg-dp-danger/15 text-dp-text" : "bg-dp-surface text-dp-text-2")}
            >
              <Calendar className={cn("size-3", overdue && "text-dp-danger")} />
              {formatDue(card.due)}
            </Tag>
          )}
          {/* A tag, not a small button inside the card's own target: the card's menu opens the issue. */}
          {card.github && (
            <Tag
              hint={t.githubIssue(card.github.repo, card.github.number)}
              data-issue={card.github.number}
              className={cn(CHIP, "bg-dp-surface font-mono", card.github.state === "closed" ? "text-dp-text" : "text-dp-text-2")}
            >
              <CircleDot className="size-3" />#{card.github.number}
            </Tag>
          )}
          {card.agent && (
            <Tag
              hint={card.agentStatus ? t.agentAlert[card.agentStatus](card.agent) : t.agentChip(card.agent)}
              data-agent-status={card.agentStatus}
              className={cn(CHIP, card.agentStatus ? "bg-dp-danger/15 text-dp-text" : "bg-dp-accent-soft text-dp-text")}
            >
              <Bot className={cn("size-3", card.agentStatus && "text-dp-danger")} />
              {card.agent}
            </Tag>
          )}
        </div>
      )}
      {card.notes.trim() && <p className="mt-1 line-clamp-2 text-xs leading-snug text-dp-text-2">{card.notes}</p>}
    </div>
  );
}

/**
 * A card's "⋯": what a drag does, without one (WCAG 2.5.7). It moves the card to another column or a place
 * up or down, or sends it to a terminal of the canvas, as a drop on that terminal does.
 */
function CardMenu({
  t,
  boardId,
  cardId,
  issueUrl,
  columnId,
  columns,
  first,
  last,
  focusCard,
  onMove,
  onStep,
}: {
  t: Messages;
  boardId: string;
  cardId: string;
  /** A linked card's issue, opened from here rather than from a small target inside the card's own. */
  issueUrl?: string;
  columnId: string;
  columns: KanbanColumn[];
  first: boolean;
  last: boolean;
  focusCard: () => void;
  onMove: (columnId: string) => void;
  onStep: (step: CardStep) => void;
}) {
  // After a move the keyboard goes back to the card, not to this button: the board focuses it where it lands.
  const moved = useRef(false);
  const move = (run: () => void) => () => {
    moved.current = true;
    run();
  };
  const here = columns.findIndex((c) => c.id === columnId);
  const keyOf = (index: number) => (index === here - 1 ? "Alt+←" : index === here + 1 ? "Alt+→" : null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={t.card.menu}
          onClick={(e) => e.stopPropagation()}
          // Shown with the pointer on the card or the keyboard in it, at once.
          className="absolute top-1.5 right-1.5 size-6 opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100 aria-expanded:opacity-100"
        >
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      {/* Portalled, but its clicks still bubble through React to the card, which would open its dialog. */}
      <DropdownMenuContent
        align="end"
        className="w-48"
        onClick={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => {
          if (!moved.current) return;
          moved.current = false;
          e.preventDefault();
          focusCard();
        }}
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={columns.length < 2}>{t.card.moveTo}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            {columns.map((column, index) =>
              column.id === columnId ? null : (
                <DropdownMenuItem key={column.id} onSelect={move(() => onMove(column.id))}>
                  <span className="min-w-0 truncate">{column.title}</span>
                  {keyOf(index) && <DropdownMenuShortcut>{keyOf(index)}</DropdownMenuShortcut>}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem disabled={first} onSelect={move(() => onStep("up"))}>
          {t.card.moveUp}
          <DropdownMenuShortcut>Alt+↑</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={move(() => onStep("down"))}>
          {t.card.moveDown}
          <DropdownMenuShortcut>Alt+↓</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t.card.sendTo}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
            <SendToItems t={t} boardId={boardId} cardId={cardId} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {issueUrl && <DropdownMenuItem onSelect={() => void openUrl(issueUrl).catch(() => undefined)}>{t.card.openIssue}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The canvas's terminals, read when the submenu opens: sending types the card into one, as a drop on it does. */
function SendToItems({ t, boardId, cardId }: { t: Messages; boardId: string; cardId: string }) {
  const terminals = sceneTerminals();
  if (terminals.length === 0) return <DropdownMenuItem disabled>{t.card.noTerminal}</DropdownMenuItem>;
  return terminals.map((terminal) => (
    <DropdownMenuItem key={terminal.id} onSelect={() => void sendCardToTerminal(boardId, cardId, terminal.id)}>
      <span className="min-w-0 truncate">{terminal.name}</span>
    </DropdownMenuItem>
  ));
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
                <ToggleGroupItem value={NO_DUE} variant="choice" size="sm" className={CHOICE}>
                  {t.dueNone}
                </ToggleGroupItem>
                {presets.map(({ preset }) => (
                  <ToggleGroupItem key={preset} value={preset} variant="choice" size="sm" className={CHOICE}>
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
                <ToggleGroupItem key={p} value={p} variant="choice" size="sm" className={CHOICE}>
                  <PriorityMark priority={p} />
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
