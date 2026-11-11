import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, Code2, Eye, File, Folder, FolderTree, PanelTopOpen, RotateCw, Save, X } from "lucide-react";
import { useStore } from "zustand";
import { useMessages } from "@/i18n";
import { studioTree, type TreeEntry } from "@/ipc/studio";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccentButton, Hint, HintedButton, IconButton, QuietButton, ToolButton } from "@/shell/buttons";
import { TOP_ROW_HEIGHT } from "@/shell/layout";
import { CutHint } from "@/review/PathTail";
import { useProjects } from "@/store/projects";
import { CodeEditor } from "./CodeEditor";
import { insertFileNode } from "./insert";
import { isDirty as sessionIsDirty } from "./fileSession";
import { isMarkdown, renderMarkdown } from "./markdown";
import { studioMessages } from "./messages";
import { BAR_FIELD, DiskBanner, errorText, ListMessage, Message } from "./parts";
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
  const name = useProjects((s) => s.projects.find((p) => p.id === project)?.name) ?? "";
  const tabs = useStudio((s) => s.tabs);
  const active = useStudio((s) => s.active);
  const tab = tabs.find((x) => x.path === active) ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [treeOpen, setTreeOpen] = useState(true);

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
      className="absolute inset-0 flex gap-3 pr-18 pb-3 pl-3 text-dp-text"
      style={{ paddingTop: TOP_ROW_HEIGHT + 12 }}
    >
      <nav className="dp-glass z-30 flex shrink-0 flex-col items-center gap-0.5 self-center rounded-lg p-1">
        {/* One name, its state in aria-pressed: "Files, pressed", not "Hide the files, pressed". */}
        <ToolButton toggle label={t.files} active={treeOpen} onClick={() => setTreeOpen(!treeOpen)}>
          <FolderTree />
        </ToolButton>
      </nav>
      {treeOpen && <FileTree project={project} active={active} expanded={expanded} setExpanded={setExpanded} onOpen={open} />}
      <section className="dp-glass-strong flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
        <Tabs tabs={tabs} active={active} />
        {tab ? <FilePane key={tab.path} tab={tab} onOpen={open} /> : <Message>{t.pickFile}</Message>}
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
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    studioTree(project).then(
      (found) => alive && setEntries(found),
      (failure: unknown) => alive && setError(errorText(failure)),
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
          <ListMessage>{t.treeFailed(error)}</ListMessage>
        ) : entries === null ? (
          <ListMessage>{t.readingTree}</ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>{filtering ? t.noMatch : t.empty}</ListMessage>
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
            {rows.length > MAX_ROWS && <ListMessage>{t.treeCut(MAX_ROWS)}</ListMessage>}
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

function Tabs({ tabs, active }: { tabs: StudioTab[]; active: string | null }) {
  const t = useMessages(studioMessages);
  const [confirming, setConfirming] = useState<string | null>(null);
  const pending = tabs.find((x) => x.path === confirming);

  const close = (tab: StudioTab) => {
    if (isDirty(tab)) setConfirming(tab.path);
    else closeTab(tab.path);
  };

  return (
    // The bar asking about unsaved changes lies over the editor's top edge, under the tabs: the code
    // under the pointer never moves down to make room for it.
    <div className="relative shrink-0">
      {/* Documents that open and close, not a view switcher: buttons, the one shown aria-current (P2-15). */}
      <div data-doc-strip className="flex h-10 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-dp-line px-2">
        {tabs.map((tab) => (
          <TabItem key={tab.path} tab={tab} active={tab.path === active} onClose={() => close(tab)} />
        ))}
      </div>
      {pending && (
        <div role="alert" className="absolute inset-x-0 top-full z-10 flex flex-wrap items-center gap-2 border-b border-dp-line bg-dp-surface px-3 py-2 text-sm">
          <span className="mr-auto">{t.discardTitle(baseName(pending.path))}</span>
          {/* The dialogs' footer in a bar: dismiss, destructive, primary; `sm` like the bar's other controls. */}
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
              // Its conflict banner is on its own page, which may not be the one shown.
              else void openFile(pending.path);
            }}
          >
            {t.saveAndClose}
          </AccentButton>
        </div>
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
        "flex h-8 shrink-0 items-center rounded-t-md text-dp-text-2 transition-colors duration-(--dp-dur-fast) ease-(--dp-ease-out) hover:bg-dp-hover hover:text-dp-text motion-reduce:transition-none",
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
        {/* The dot is for the eye; its words are read with the name. */}
        {dirty && <span data-dirty aria-hidden className="size-2 shrink-0 rounded-full bg-dp-accent" />}
        {dirty && <span className="sr-only">{t.modified}</span>}
      </HintedButton>
      {/* IconButton is 28 px: a tab is 32, so this one is the kit's `icon-xs` made from the same HintedButton. */}
      <HintedButton hint={t.closeTab(name)} variant="ghost" size="icon-xs" aria-label={t.closeTab(name)} onClick={onClose} className="mr-1 text-dp-text-3 hover:text-dp-text">
        <X />
      </HintedButton>
    </div>
  );
}

function FilePane({ tab, onOpen }: { tab: StudioTab; onOpen: (path: string) => void }) {
  const t = useMessages(studioMessages);
  const { draft, disk, error, file, loading, refused, revision, saving } = useStore(tab.session);
  const markdown = isMarkdown(tab.path);
  const [preview, setPreview] = useState(false);
  const dirty = useStore(tab.session, sessionIsDirty);
  const previewing = markdown && preview;

  if (loading || !file) return <Message>{t.readingFile}</Message>;
  if (refused) return <Message>{t.readFailed(refused)}</Message>;
  return (
    <>
      {disk && <DiskBanner session={tab.session} disk={disk} onDrop={() => closeTab(tab.path)} />}
      {error && (
        <p role="status" className="shrink-0 border-b border-dp-line px-3 py-2 text-xs text-dp-danger">
          {t.failed(error)}
        </p>
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

