import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, Code2, Eye, File, Folder, FolderTree, PanelTopOpen, PencilLine, RotateCw, Save, X } from "lucide-react";
import { useStore } from "zustand";
import { useMessages } from "@/i18n";
import { studioTree, type TreeEntry } from "@/ipc/studio";
import { logError } from "@/lib/errorToast";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/EmptyState";
import { InlineProblem } from "@/components/InlineProblem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccentButton, Hint, HintedButton, IconButton, QuietButton, ToolButton } from "@/shell/buttons";
import { LANE_TOP } from "@/shell/layout";
import { useWorkWindowPlace } from "@/shell/lane";
import { CutHint } from "@/review/PathTail";
import { useProjects } from "@/store/projects";
import { CodeEditor } from "./CodeEditor";
import { insertFileNode } from "./insert";
import { isDirty as sessionIsDirty } from "./fileSession";
import { isMarkdown, renderMarkdown } from "./markdown";
import { studioMessages } from "./messages";
import { BAR_FIELD, DecisionBar, DiskBanner, errorText, OVER_THE_FILE } from "./parts";
import { useDiskWatch, useSaveKey } from "./sessionEffects";
import { closeStudio, closeTab, editFile, isDirty, openFile, openStudio, saveFile, useStudio, type StudioTab } from "./studioStore";
import { ancestors, baseName, buildTree, toggle, visibleRows, type TreeNode, type TreeRow } from "./tree";

/** The tree shows this many lines at most, and says so; the filter finds the others. */
const MAX_ROWS = 2000;

/**
 * The code workspace (issue #49): a workspace tab whose page is an IDE instead
 * of a canvas. The files of the active project, browsed and edited; its open
 * files stay when another tab is shown.
 */
export function CodeWorkspace() {
  const project = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.id ?? null);
  useEffect(() => {
    if (!project) return;
    openStudio(project);
    return closeStudio;
  }, [project]);
  const open = useStudio((s) => s.project);
  return open && open === project ? <StudioContent project={open} /> : null;
}

function StudioContent({ project }: { project: string }) {
  const t = useMessages(studioMessages);
  const place = useWorkWindowPlace();
  const name = useProjects((s) => s.projects.find((p) => p.id === project)?.name) ?? "";
  const tabs = useStudio((s) => s.tabs);
  const active = useStudio((s) => s.active);
  const tab = tabs.find((x) => x.path === active) ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [treeOpen, setTreeOpen] = useState(true);
  // The tab whose close asks about its unsaved changes, in the decision bar; the file's own question waits meanwhile.
  const [confirming, setConfirming] = useState<string | null>(null);

  // Stable: the tree's memoised rows take it.
  const open = useCallback((path: string) => {
    setExpanded((current) => new Set([...current, ...ancestors(path)]));
    void openFile(path);
  }, []);

  // A dialog over the workspace has its own Ctrl+S (the notes), or none.
  useSaveKey(() => {
    if (active && !document.querySelector('[role="dialog"]')) void saveFile(active);
  });
  useDiskWatch(tab?.session ?? null);

  // The rail on the right (activities) keeps its column; the page ends where the git and review windows do.
  return (
    <div
      data-code-workspace
      role="region"
      aria-label={t.title(name)}
      // Under the bars, left of the activity rail, or of an occupied lane where it fits (shell/layout.ts).
      className="absolute inset-0 flex gap-3 pb-3 pl-3 text-dp-text"
      style={{ paddingTop: LANE_TOP, paddingRight: place.right }}
    >
      <nav className="dp-glass z-30 flex shrink-0 flex-col items-center gap-0.5 self-center rounded-lg p-1">
        {/* One name, its state in aria-pressed: "Files, pressed", not "Hide the files, pressed". */}
        <ToolButton toggle label={t.files} active={treeOpen} onClick={() => setTreeOpen(!treeOpen)}>
          <FolderTree />
        </ToolButton>
      </nav>
      {treeOpen && <FileTree project={project} active={active} expanded={expanded} setExpanded={setExpanded} onOpen={open} />}
      <section className="dp-glass-strong flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
        <Tabs tabs={tabs} active={active} confirming={confirming} setConfirming={setConfirming} />
        {tab ? <FilePane key={tab.path} tab={tab} onOpen={open} asking={tabs.some((x) => x.path === confirming)} /> : <EmptyState>{t.pickFile}</EmptyState>}
      </section>
    </div>
  );
}

interface FileTreeProps {
  project: string;
  active: string | null;
  expanded: Set<string>;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  onOpen: (path: string) => void;
}

function FileTree({ project, active, expanded, setExpanded, onOpen }: FileTreeProps) {
  const t = useMessages(studioMessages);
  const [entries, setEntries] = useState<TreeEntry[] | null>(null);
  // The project has more entries than the list holds: said under the tree.
  const [listCut, setListCut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    studioTree(project).then(
      (found) => {
        if (!alive) return;
        setListCut(found.truncated);
        setEntries(found.entries);
      },
      (failure: unknown) => {
        if (!alive) return;
        logError(t.treeFailed, failure);
        setError(errorText(failure));
      },
    );
    return () => {
      alive = false;
    };
  }, [project, refresh]);

  const tree = useMemo(() => buildTree(entries ?? []), [entries]);
  const rows = useMemo(() => visibleRows(tree, expanded, query), [tree, expanded, query]);
  const shown = useMemo(() => rows.slice(0, MAX_ROWS), [rows]);
  const filtering = query.trim() !== "";

  // The tree is one tab stop (APG tree view, P2-15): the row last focused, else the open file's, else the first.
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const treeBox = useRef<HTMLDivElement>(null);
  const has = (path: string | null) => path !== null && shown.some((row) => row.node.path === path);
  const stopPath = has(focusPath) ? focusPath : has(active) ? active : (shown[0]?.node.path ?? null);

  const activate = useCallback(
    (node: TreeNode) => (node.kind === "dir" ? setExpanded((current) => toggle(current, node.path)) : onOpen(node.path)),
    [setExpanded, onOpen],
  );

  const moveTo = (index: number) => {
    const target = Math.max(0, Math.min(index, shown.length - 1));
    setFocusPath(shown[target].node.path);
    treeBox.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')[target]?.focus();
  };

  /** The tree's keys: Up, Down, Home and End move; Right opens a folder or enters it; Left closes it or goes to its parent. Enter is the row's click. */
  const onTreeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = shown.findIndex((row) => row.node.path === (e.target as HTMLElement).dataset.path);
    if (at < 0) return;
    const { node, depth, expanded: isOpen } = shown[at];
    const folder = node.kind === "dir";
    let to: number | undefined;
    if (e.key === "ArrowDown") to = at + 1;
    else if (e.key === "ArrowUp") to = at - 1;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = shown.length - 1;
    else if (e.key === "ArrowRight") {
      // While filtering, every folder is open: Right only goes in.
      if (folder && !isOpen) setExpanded((current) => toggle(current, node.path));
      else if (folder && shown[at + 1]?.depth === depth + 1) to = at + 1;
    } else if (e.key === "ArrowLeft") {
      if (folder && isOpen && !filtering) setExpanded((current) => toggle(current, node.path));
      else for (let k = at - 1; k >= 0 && to === undefined; k--) if (shown[k].depth < depth) to = k;
    } else return;
    e.preventDefault();
    if (to !== undefined) moveTo(to);
  };

  return (
    <aside data-files className="dp-glass-strong flex w-70 shrink-0 flex-col overflow-hidden rounded-xl">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-dp-line px-3">
        <Input
          aria-label={t.filterLabel}
          placeholder={t.filterPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={cn(BAR_FIELD, "flex-1")}
        />
        <IconButton label={t.refresh} onClick={() => setRefresh((n) => n + 1)}>
          <RotateCw />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {error !== null ? (
          <InlineProblem place="list" title={t.treeFailed} next={t.treeNext} error={error} />
        ) : entries === null ? (
          <EmptyState place="list" grace>{t.readingTree}</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState place="list">{filtering ? t.noMatch : t.empty}</EmptyState>
        ) : (
          <>
            <div
              ref={treeBox}
              role="tree"
              aria-label={t.files}
              onKeyDown={onTreeKey}
              onFocus={(e) => e.target.dataset.path !== undefined && setFocusPath(e.target.dataset.path)}
            >
              {shown.map((row) => (
                <TreeItem key={row.node.path} row={row} active={active} tabbable={row.node.path === stopPath} onActivate={activate} />
              ))}
            </div>
            {/* The cut is said: a file past it is not missing, the filter finds it (P2-52). */}
            {rows.length > MAX_ROWS && <EmptyState place="list">{t.treeCut(MAX_ROWS)}</EmptyState>}
            {/* The project's own cut: the filter only searches what was listed, so it says so. */}
            {listCut && <EmptyState place="list">{t.treeListCut(entries.length)}</EmptyState>}
          </>
        )}
      </div>
    </aside>
  );
}

/**
 * Whether a row's name may not fit the panel (w-70, 280 px): its indent, chevron and icon, then a
 * width over what a 14 px name takes, 9 px a Latin character and 15 px any other (a CJK glyph is
 * a full em), scrollbar aside. A row that surely fits needs no hint: up to 2000 rows would each
 * carry a tooltip's machinery for nothing (P2-59).
 */
const mayBeCut = (name: string, depth: number) => {
  let width = 0;
  for (const char of name) width += char.charCodeAt(0) < 0x80 ? 9 : 15;
  return 8 + depth * 12 + 44 + 8 + width > 280 - 16;
};

/**
 * A row of the tree, not a control: role="treeitem", and up to 2000 of them, kept to the bare element.
 * Memoised: moving the keyboard draws the two rows whose tab stop changes, not the whole tree
 * (`active` is the open file's path, which changes only when another file opens).
 * The path shows in the app's hint when the name is cut, never in a native title (P2-20).
 */
const TreeItem = memo(function TreeItem({ row, active, tabbable, onActivate }: { row: TreeRow; active: string | null; tabbable: boolean; onActivate: (node: TreeNode) => void }) {
  const { node, depth, expanded: isOpen, size, position } = row;
  const item = (
    <button
      type="button"
      role="treeitem"
      aria-level={depth + 1}
      aria-setsize={size}
      aria-posinset={position}
      aria-expanded={node.kind === "dir" ? isOpen : undefined}
      aria-selected={node.path === active}
      tabIndex={tabbable ? 0 : -1}
      data-path={node.path}
      onClick={() => onActivate(node)}
      className={cn(
        "flex h-7 w-full items-center gap-1 pr-2 text-left text-sm text-dp-text-2 hover:bg-dp-hover hover:text-dp-text focus-visible:ring-2 focus-visible:ring-dp-accent/70 focus-visible:outline-none focus-visible:ring-inset [&_svg]:size-4 [&_svg]:shrink-0",
        node.path === active && "bg-dp-accent-soft text-dp-text hover:bg-dp-accent-soft dp-on-soft",
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      {node.kind === "dir" ? (
        <>
          {isOpen ? <ChevronDown className="text-dp-text-3" /> : <ChevronRight className="text-dp-text-3" />}
          <Folder className="text-dp-text-3" />
        </>
      ) : (
        <>
          <span className="w-4 shrink-0" />
          <File className="text-dp-text-3" />
        </>
      )}
      <span className="ml-1 truncate">{node.name}</span>
    </button>
  );
  return mayBeCut(node.name, depth) ? <CutHint label={node.path}>{item}</CutHint> : item;
});

interface TabsProps {
  tabs: StudioTab[];
  active: string | null;
  confirming: string | null;
  setConfirming: (path: string | null) => void;
}

function Tabs({ tabs, active, confirming, setConfirming }: TabsProps) {
  const t = useMessages(studioMessages).unsaved;
  const pending = tabs.find((x) => x.path === confirming);

  const close = (tab: StudioTab) => {
    if (isDirty(tab)) setConfirming(tab.path);
    else closeTab(tab.path);
  };

  return (
    // The decision bar asking about a tab's unsaved changes lies over the editor's top edge, under the tabs
    // (`OVER_THE_FILE`): the code under the pointer never moves down to make room for it. It covers the file's
    // own question, in the same bar at the same place (`FilePane`): one question at a time.
    <div className="relative shrink-0">
      {/* Documents that open and close, not a view switcher: buttons, the one shown aria-current (P2-15). */}
      <div data-doc-strip className="flex h-10 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-dp-line px-2">
        {tabs.map((tab) => (
          <TabItem key={tab.path} tab={tab} active={tab.path === active} onClose={() => close(tab)} />
        ))}
      </div>
      {pending && (
        // The window's own question in a bar (QuitPrompt's dialog): the same words, the same order.
        <DecisionBar question={t.title(baseName(pending.path))} className={OVER_THE_FILE}>
          <QuietButton size="sm" onClick={() => setConfirming(null)}>
            {t.cancel}
          </QuietButton>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setConfirming(null);
              closeTab(pending.path);
            }}
          >
            {t.discard}
          </Button>
          <AccentButton
            size="sm"
            onClick={async () => {
              setConfirming(null);
              if (await saveFile(pending.path)) closeTab(pending.path);
              // A conflict: its file is shown, and the bar asks about its disk.
              else void openFile(pending.path);
            }}
          >
            {t.save}
          </AccentButton>
        </DecisionBar>
      )}
    </div>
  );
}

/**
 * An open file's tab stays custom, built from two Buttons side by side: the document's and its
 * close button. Radix Tabs has no place for a second control inside a trigger, and a strip of
 * documents that open, close and middle-click away is not a view switcher: no tab roles.
 */
function TabItem({ tab, active, onClose }: { tab: StudioTab; active: boolean; onClose: () => void }) {
  const t = useMessages(studioMessages);
  const name = baseName(tab.path);
  const dirty = useStore(tab.session, sessionIsDirty);
  return (
    <div
      data-tab={tab.path}
      onAuxClick={(e) => e.button === 1 && onClose()}
      className={cn(
        "flex h-8 shrink-0 items-center rounded-t-md text-dp-text-2 transition-colors duration-(--dp-dur-fast) ease-(--dp-ease-out) hover:bg-dp-hover hover:text-dp-text",
        active && "bg-dp-tab-on text-dp-text hover:bg-dp-tab-on",
      )}
    >
      {/* The path is in the document's own hint, as the close button's is in its: one kind of tooltip, on focus too. */}
      <HintedButton
        hint={tab.path}
        variant="ghost"
        aria-current={active ? "page" : undefined}
        onClick={() => void openFile(tab.path)}
        className="h-full gap-2 rounded-none rounded-tl-md bg-transparent pr-1 pl-3 text-sm font-normal text-current hover:bg-transparent hover:text-current focus-visible:ring-inset active:scale-100"
      >
        <span className="max-w-48 truncate">{name}</span>
        {/* The pencil is for the eye (no dot: the round dot is an agent's mark, and the words would not fit a tab);
            its words are read with the name, and shown over the file itself. */}
        {dirty && <PencilLine data-dirty aria-hidden className="size-3 shrink-0 text-dp-text-2" />}
        {dirty && <span className="sr-only">{t.modified}</span>}
      </HintedButton>
      {/* IconButton is 28 px: a tab is 32, so this one is the kit's `icon-xs` made from the same HintedButton. */}
      <HintedButton hint={t.closeTab(name)} variant="ghost" size="icon-xs" aria-label={t.closeTab(name)} onClick={onClose} className="mr-1 text-dp-text-3 hover:text-dp-text">
        <X />
      </HintedButton>
    </div>
  );
}

function FilePane({ tab, onOpen, asking }: { tab: StudioTab; onOpen: (path: string) => void; asking: boolean }) {
  const t = useMessages(studioMessages);
  const { draft, disk, error, failedTo, file, loading, refused, revision, saving } = useStore(tab.session);
  const markdown = isMarkdown(tab.path);
  const [preview, setPreview] = useState(false);
  const dirty = useStore(tab.session, sessionIsDirty);
  const previewing = markdown && preview;

  if (loading || !file) return <EmptyState grace>{t.readingFile}</EmptyState>;
  if (refused) return <InlineProblem title={t.readFailed(tab.path)} next={t.readNext} error={refused} />;
  return (
    <>
      {/* The disk's question stands until answered, the file edited under it: in the flow, so a bar that wraps never
          covers the code. A tab's close question takes its place meanwhile (`Tabs`): kept in its room, out of sight. */}
      {disk && <DiskBanner session={tab.session} disk={disk} onDrop={() => closeTab(tab.path)} className={cn(asking && "invisible")} />}
      {error && (
        <InlineProblem
          place="band"
          role="status"
          title={failedTo === "reload" ? t.reloadFailed(tab.path) : t.saveFailed(tab.path)}
          next={failedTo === "reload" ? t.reloadNext : t.saveNext}
          error={error}
        />
      )}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-dp-line px-3">
        <span className="min-w-0 truncate font-mono text-xs text-dp-text-3">{tab.path}</span>
        {dirty && <span className="shrink-0 text-xs text-dp-text-2">{t.modified}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {markdown && (
            <ToolbarButton label={previewing ? t.edit : t.preview} active={previewing} onClick={() => setPreview(!preview)}>
              {previewing ? <Code2 /> : <Eye />}
            </ToolbarButton>
          )}
          {/* Where it goes is not in the word: the hint says it. */}
          <Hint label={t.insertTitle} side="bottom">
            <ToolbarButton label={t.insert} onClick={() => void insertFileNode(tab.path)}>
              <PanelTopOpen />
            </ToolbarButton>
          </Hint>
          <Hint label={t.save} side="bottom">
            <AccentButton size="sm" disabled={!dirty || saving} onClick={() => void saveFile(tab.path)}>
              <Save />
              {saving ? t.saving : t.saveLabel}
            </AccentButton>
          </Hint>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {previewing && (
          <div data-preview className="h-full overflow-auto px-6 py-4 text-sm leading-relaxed">
            {renderMarkdown(draft, { from: tab.path, openFile: onOpen })}
          </div>
        )}
        {/* Hidden, not unmounted, under the preview: the editor keeps its undo history, its cursor and its scroll (P2-49). */}
        <div className={cn("h-full", previewing && "hidden")}>
          <CodeEditor
            path={tab.path}
            text={draft}
            revision={revision}
            onChange={(content) => editFile(tab.path, content)}
            onSave={() => void saveFile(tab.path)}
          />
        </div>
      </div>
    </>
  );
}

/** A tool of the file's bar: a quiet Button, the one turned on in the accent's tint. */
function ToolbarButton({ label, active, className, children, ...props }: ComponentProps<typeof Button> & { label: string; active?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={active}
      className={cn("text-dp-text-2", active && "bg-dp-accent-soft text-dp-text hover:bg-dp-accent-soft", className)}
      {...props}
    >
      {children}
      {label}
    </Button>
  );
}

