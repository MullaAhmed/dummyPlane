import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { GitBranch, RotateCw, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { PanelTabs, PanelTabsContent, PanelTabsList, PanelTabsTrigger } from "@/components/PanelTabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useMessages } from "@/i18n";
import { repoCommit, repoDiscard, repoPush, repoState, type RepoState } from "@/ipc/repo";
import type { ChangedFile } from "@/ipc/review";
import { cn } from "@/lib/utils";
import { FILE_STATUS, fileSummary, statusWords } from "@/review/DiffRow";
import { reviewMessages } from "@/review/messages";
import { CutHint, PathTail } from "@/review/PathTail";
import { useReview } from "@/review/reviewStore";
import { AccentButton, Hint, IconButton, QuietButton } from "@/shell/buttons";
import { BOTTOM_BAR_HEIGHT, TOP_ROW_HEIGHT } from "@/shell/layout";
import { useActiveFolder } from "@/store/workspaceFolder";
import { GitDiff, GitMessage } from "./GitDiff";
import { gitWindowStore, useGitWindow } from "./gitWindowStore";
import { HistoryTab } from "./HistoryTab";
import { gitMessages } from "./messages";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A checkbox of the list: readable on the glass, and its hit area kept inside its own row. */
const ROW_CHECK = "border-dp-text-3 after:-inset-1";

/** Some files in, some out: a dash, not the check of "all" (the primitive draws a check for both). */
const MIXED =
  "data-[state=indeterminate]:border-dp-accent data-[state=indeterminate]:bg-dp-accent data-[state=indeterminate]:text-dp-on-accent [&[data-state=indeterminate]_svg]:hidden data-[state=indeterminate]:before:h-0.5 data-[state=indeterminate]:before:w-2 data-[state=indeterminate]:before:rounded-sm data-[state=indeterminate]:before:bg-current";

/** The project's changes, commit, history and push, opened from the branch chip. */
export function GitWindow() {
  const path = useGitWindow((s) => s.path);
  // The window follows the active workspace's folder: it closes when another one comes up.
  const folder = useActiveFolder().folder;
  const reviewing = useReview((s) => s.nodeId);

  useEffect(() => {
    if (reviewing || folder !== gitWindowStore.getState().path) gitWindowStore.getState().close();
  }, [reviewing, folder]);

  return path ? <GitDrawer key={path} path={path} /> : null;
}

function GitDrawer({ path }: { path: string }) {
  const t = useMessages(gitMessages);
  const [tab, setTab] = useState<"changes" | "history">("changes");
  const [repo, setRepo] = useState<RepoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);

  // An older answer arriving late must not overwrite a newer one.
  const reads = useRef(0);
  const read = useCallback(() => {
    const turn = ++reads.current;
    return repoState(path).then(
      (next) => {
        if (turn !== reads.current) return;
        setError(null);
        setRepo(next);
      },
      (failed: unknown) => {
        if (turn === reads.current) setError(errorText(failed));
      },
    );
  }, [path]);

  useEffect(() => {
    void read();
  }, [read]);

  useEffect(() => {
    // An Escape a menu, a dialog or a field already used is theirs, as in the review panel.
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable === true;
      if (e.key === "Escape" && !e.defaultPrevented && !typing) gitWindowStore.getState().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const again = () => {
    setRefresh((n) => n + 1);
    return read();
  };

  const push = async () => {
    const target = repo?.pushTo;
    if (!repo || !target) return;
    setPushing(true);
    setFailure(null);
    try {
      await repoPush(path, repo.branch, target, repo.head);
      toast(t.push.done(target));
    } catch (failed) {
      setFailure(errorText(failed));
    } finally {
      setPushing(false);
      await again();
    }
  };

  return (
    <aside
      data-git-window
      className="dp-glass-strong absolute right-18 z-20 flex w-[min(920px,calc(100vw-180px))] flex-col overflow-hidden rounded-xl text-dp-text"
      style={{ top: TOP_ROW_HEIGHT + 12, bottom: BOTTOM_BAR_HEIGHT + 12 }}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-dp-line px-3">
        <GitBranch className="size-4 shrink-0 text-dp-text-2" />
        <span className="shrink-0 text-sm font-medium">{t.title}</span>
        {repo && (
          <span className="min-w-0 truncate font-mono text-xs text-dp-text-2" title={repo.branch}>
            {repo.branch}
          </span>
        )}
        {repo && repo.ahead > 0 && <span className="shrink-0 font-mono text-xs text-dp-text-2 tabular-nums">{t.ahead(repo.ahead)}</span>}
        {repo && repo.behind > 0 && <span className="shrink-0 font-mono text-xs text-dp-wait tabular-nums">{t.behind(repo.behind)}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {repo && <PushButton repo={repo} pushing={pushing} onPush={() => void push()} />}
          <IconButton label={t.refresh} onClick={() => void again()}>
            <RotateCw />
          </IconButton>
          <IconButton label={t.close} onClick={() => gitWindowStore.getState().close()}>
            <X />
          </IconButton>
        </span>
      </header>
      <PanelTabs value={tab} onValueChange={(next) => setTab(next as typeof tab)} className="min-h-0 flex-1">
        <div className="flex h-9 shrink-0 items-center border-b border-dp-line px-2">
          <PanelTabsList>
            <PanelTabsTrigger value="changes">{t.tabChanges(repo?.files.length ?? 0)}</PanelTabsTrigger>
            <PanelTabsTrigger value="history">{t.tabHistory}</PanelTabsTrigger>
          </PanelTabsList>
        </div>
        {(failure ?? (repo && error)) && (
          <p role="alert" className="shrink-0 border-b border-dp-line px-3 py-2 text-xs whitespace-pre-wrap text-dp-danger">
            {failure ?? error}
          </p>
        )}
        {!repo ? (
          <GitMessage>{error ?? t.reading}</GitMessage>
        ) : (
          <>
            {/* Hidden, not unmounted: a look at the history keeps the message being written and the choices. */}
            <PanelTabsContent value="changes" forceMount className="data-[state=inactive]:hidden">
              <ChangesTab path={path} files={repo.files} stamps={repo.stamps} cut={repo.truncated} refresh={refresh} onChanged={() => void again()} onFailure={setFailure} />
            </PanelTabsContent>
            <PanelTabsContent value="history">
              <HistoryTab path={path} refresh={refresh} />
            </PanelTabsContent>
          </>
        )}
      </PanelTabs>
    </aside>
  );
}

/** Greyed, with why, when there is nothing to push or nowhere to. */
function PushButton({ repo, pushing, onPush }: { repo: RepoState; pushing: boolean; onPush: () => void }) {
  const t = useMessages(gitMessages).push;
  const target = repo.pushTo;
  const ready = target !== null && (repo.ahead > 0 || repo.upstream === null);
  const label = !target ? t.label : repo.ahead > 0 ? t.count(repo.ahead, target) : repo.upstream === null ? t.to(target) : t.label;
  const why = repo.noPush ? t[repo.noPush] : ready ? undefined : t.upToDate;
  const button = (
    <AccentButton size="sm" disabled={!ready || pushing} onClick={onPush} className="max-w-64 truncate">
      {pushing ? t.pushing : label}
    </AccentButton>
  );
  if (!why) return button;
  // A disabled button takes no pointer and no focus: the span around it tells why, on hover and on Tab.
  return (
    <Hint label={why} side="bottom">
      <span tabIndex={0} className="rounded-md focus-visible:ring-2 focus-visible:ring-dp-accent/70 focus-visible:outline-none">
        {button}
      </span>
    </Hint>
  );
}

function ChangesTab(props: {
  path: string;
  files: ChangedFile[];
  stamps: Record<string, string>;
  cut: boolean;
  refresh: number;
  onChanged: () => void;
  onFailure: (failure: string | null) => void;
}) {
  const { path, files, stamps, cut, refresh, onChanged, onFailure } = props;
  const t = useMessages(gitMessages).changes;
  const words = useMessages(reviewMessages);
  // What is left out, not what is in: a new file arrives checked.
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [asking, setAsking] = useState<ChangedFile | null>(null);
  // The list is one tab stop (P2-16): the row that has it, moved by the arrows.
  const [stop, setStop] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const keysHint = useId();
  // After a discard, the row that takes the keyboard once the list is read again: the file's own when it is
  // still there (the discard failed), else the next one, else the one before.
  const afterDiscard = useRef<{ discarded: string; next: string | null } | null>(null);

  const chosen = files.filter((file) => !left.has(file.path));
  const selected = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  const stopPath = files.some((file) => file.path === stop) ? stop : (selected?.path ?? null);

  const focusRow = (index: number) => {
    const row = list.current?.querySelectorAll<HTMLButtonElement>("button[data-git-row]")[index];
    if (!row) return;
    setStop(files[index].path);
    row.focus();
  };

  // A file gone from the list takes its question with it, or the dialog would come back with the file.
  useEffect(() => {
    setAsking((current) => (current && files.some((file) => file.path === current.path) ? current : null));
    const wanted = afterDiscard.current;
    if (!wanted) return;
    afterDiscard.current = null;
    const path = files.some((file) => file.path === wanted.discarded) ? wanted.discarded : wanted.next;
    const index = path === null ? -1 : files.findIndex((file) => file.path === path);
    // The discarded row is gone: its focus would fall to the page. An empty list leaves the tab's own name.
    if (index >= 0) focusRow(index);
    else document.querySelector<HTMLElement>('[data-git-window] [role="tab"][data-state="active"]')?.focus();
  }, [files]);

  /** The list's keys, on a row: the arrows, Home and End move; Space includes; Delete asks to discard; Enter is the row's click. */
  const onRowKey = (e: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const to = ({ ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: files.length - 1 } as Record<string, number>)[e.key];
    if (to !== undefined) {
      e.preventDefault();
      focusRow(Math.max(0, Math.min(to, files.length - 1)));
    } else if (e.key === " ") {
      // Not the button's own click, which would show the diff.
      e.preventDefault();
      toggle(files[index]);
    } else if (e.key === "Delete") {
      e.preventDefault();
      setAsking(files[index]);
    }
  };

  const toggle = (file: ChangedFile) =>
    setLeft((current) => {
      const next = new Set(current);
      if (!next.delete(file.path)) next.add(file.path);
      return next;
    });

  const commit = async () => {
    setCommitting(true);
    onFailure(null);
    try {
      const hash = await repoCommit(path, chosen, message.trim());
      toast(t.committed(hash));
      setMessage("");
      onChanged();
    } catch (failed) {
      onFailure(errorText(failed));
    } finally {
      setCommitting(false);
    }
  };

  // The only way to `repoDiscard`: the dialog's button.
  const discard = async (file: ChangedFile) => {
    const at = files.findIndex((other) => other.path === file.path);
    afterDiscard.current = { discarded: file.path, next: files[at + 1]?.path ?? files[at - 1]?.path ?? null };
    setAsking(null);
    onFailure(null);
    await repoDiscard(path, file, stamps[file.path] ?? "").catch((failed: unknown) => onFailure(errorText(failed)));
    onChanged();
  };

  if (files.length === 0) return <GitMessage>{t.clean}</GitMessage>;
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-80 shrink-0 flex-col border-r border-dp-line">
        <label className="flex h-8 shrink-0 items-center gap-2 border-b border-dp-line px-3 text-xs text-dp-text-2">
          <Checkbox
            aria-label={t.includeAll}
            checked={chosen.length === files.length ? true : chosen.length === 0 ? false : "indeterminate"}
            onCheckedChange={() => setLeft(chosen.length === 0 ? new Set() : new Set(files.map((file) => file.path)))}
            className={cn(ROW_CHECK, MIXED)}
          />
          {t.includeAll}
        </label>
        <span id={keysHint} className="sr-only">
          {t.keys}
        </span>
        <ul ref={list} className="min-h-0 flex-1 overflow-y-auto py-1">
          {cut && <li className="px-3 py-1 text-xs text-dp-text-3">{words.listCut(files.length)}</li>}
          {files.map((file, index) => {
            const status = FILE_STATUS[file.status];
            const current = selected?.path === file.path;
            // On the selection's tint, danger steps toward the ink to keep 4.5:1 (tokens.css): the − count, and a deleted file's D.
            const danger = current ? "text-dp-danger-on-soft" : "text-dp-danger";
            const tone = file.status === "deleted" ? danger : status.tone;
            return (
              <li
                key={file.path}
                data-git-file={file.path}
                className={cn(
                  "group flex h-7 items-center gap-2 px-3 text-xs text-dp-text-2 hover:bg-dp-hover",
                  current && "bg-dp-accent-soft text-dp-text hover:bg-dp-accent-soft dp-on-soft",
                )}
              >
                {/* The box and the discard stay for the pointer; the keyboard reaches both from the row (Space, Delete). */}
                <Checkbox tabIndex={-1} aria-label={t.include(file.path)} checked={!left.has(file.path)} onCheckedChange={() => toggle(file)} className={ROW_CHECK} />
                {/* A row of the list, not a control: the row itself carries hover and selection. Its hint says what its signs and a cut path hide. */}
                <CutHint label={fileSummary(words, file)} always={file.oldPath !== null || file.added === null}>
                  <button
                    type="button"
                    data-git-row
                    tabIndex={file.path === stopPath ? 0 : -1}
                    aria-current={current}
                    aria-describedby={keysHint}
                    onClick={() => setSelectedPath(file.path)}
                    onFocus={() => setStop(file.path)}
                    onKeyDown={(e) => onRowKey(e, index)}
                    onKeyUp={(e) => e.key === " " && e.preventDefault()}
                    className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-dp-accent/70 focus-visible:outline-none"
                  >
                    <span aria-hidden className={cn("w-3 shrink-0 font-mono font-medium", tone)}>
                      {status.letter}
                    </span>
                    <span className="sr-only">{statusWords(words, file)}</span>
                    <PathTail path={file.path} />
                    {left.has(file.path) && <span className="sr-only">{t.leftOut}</span>}
                    {file.added === null ? (
                      <span className="shrink-0 text-dp-text-3">
                        <span aria-hidden>—</span>
                        <span className="sr-only">{words.binaryOrBig}</span>
                      </span>
                    ) : (
                      <span className="shrink-0 font-mono tabular-nums">
                        <span className="text-dp-ok">+{file.added}</span> <span className={danger}>−{file.removed}</span>
                      </span>
                    )}
                  </button>
                </CutHint>
                <IconButton tabIndex={-1} label={t.discard(file.path)} onClick={() => setAsking(file)}>
                  <Undo2 />
                </IconButton>
              </li>
            );
          })}
        </ul>
        <div className="grid shrink-0 gap-2 border-t border-dp-line p-2">
          <Textarea
            aria-label={t.messageLabel}
            placeholder={t.messagePlaceholder}
            value={message}
            rows={3}
            onChange={(e) => setMessage(e.target.value)}
            className="min-h-0 resize-none rounded-md px-2 py-1.5 text-xs field-sizing-fixed md:text-xs"
          />
          <AccentButton disabled={committing || chosen.length === 0 || !message.trim()} onClick={() => void commit()}>
            {committing ? t.committing : t.commit(chosen.length)}
          </AccentButton>
        </div>
      </div>
      {selected && <GitDiff key={selected.path} path={path} file={selected} refresh={refresh} />}
      <DiscardDialog file={asking} onCancel={() => setAsking(null)} onConfirm={(file) => void discard(file)} />
    </div>
  );
}

function DiscardDialog({ file, onCancel, onConfirm }: { file: ChangedFile | null; onCancel: () => void; onConfirm: (file: ChangedFile) => void }) {
  const t = useMessages(gitMessages).discard;
  const description = !file ? "" : file.status === "untracked" ? t.deleted(file.path) : file.status === "added" ? t.added(file.path) : t.changed(file.path);
  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription className="break-words">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <QuietButton onClick={onCancel}>{t.cancel}</QuietButton>
          <Button variant="destructive" size="lg" onClick={() => file && onConfirm(file)}>
            {t.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
