import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { ChevronDown, ChevronRight, Code2, Eye, File, Folder, FolderTree, PanelTopOpen, RotateCw, Save, X } from "lucide-react";
import { useStore } from "zustand";
import { useTheme } from "@/app/theme";
import { useMessages } from "@/i18n";
import { studioTree, type TreeEntry } from "@/ipc/studio";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccentButton, Hint, HintedButton, IconButton, QuietButton, ToolButton } from "@/shell/buttons";
import { TOP_ROW_HEIGHT } from "@/shell/layout";
import { useProjects } from "@/store/projects";
import { CodeEditor } from "./CodeEditor";
import { insertFileNode } from "./insert";
import { isDirty as sessionIsDirty } from "./fileSession";
import { isMarkdown, renderMarkdown } from "./markdown";
import { studioMessages } from "./messages";
import { BAR_FIELD, DiskBanner, errorText, ListMessage, Message } from "./parts";
import { useDiskWatch, useSaveKey } from "./sessionEffects";
import { closeStudio, closeTab, editFile, isDirty, openFile, openStudio, saveFile, useStudio, type StudioTab } from "./studioStore";
import { ancestors, baseName, buildTree, toggle, visibleRows } from "./tree";

/** The tree shows this many lines at most; the filter finds the others. */
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

  const open = (path: string) => {
    setExpanded((current) => new Set([...current, ...ancestors(path)]));
    void openFile(path);
  };

  // A dialog over the workspace has its own Ctrl+S (the notes), or none.
  useSaveKey(() => {
    if (active && !document.querySelector('[role="dialog"]')) void saveFile(active);
  });
  useDiskWatch(tab?.session ?? null);

  // The rail on the right (activities) keeps its column; the page ends where the git and review windows do.
  return (
    <div
      data-code-workspace
      aria-label={t.title(name)}
      className="absolute inset-0 flex gap-3 pr-18 pb-3 pl-3 text-dp-text"
      style={{ paddingTop: TOP_ROW_HEIGHT + 12 }}
    >
      <nav className="dp-glass z-30 flex shrink-0 flex-col items-center gap-0.5 self-center rounded-lg p-1">
        <ToolButton label={treeOpen ? t.hideFiles : t.showFiles} active={treeOpen} onClick={() => setTreeOpen(!treeOpen)}>
          <FolderTree />
        </ToolButton>
      </nav>
      {treeOpen && <FileTree project={project} active={active} expanded={expanded} setExpanded={setExpanded} onOpen={open} />}
      <section className="dp-glass-strong flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
        <Tabs tabs={tabs} active={active} />
        {tab ? <FilePane key={tab.path} tab={tab} /> : <Message>{t.pickFile}</Message>}
      </section>
    </div>
  );
}

interface FileTreeProps {
  project: string;
  active: string | null;
  expanded: Set<string>;
  setExpanded: (next: Set<string>) => void;
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
      <div role="tree" aria-label={t.filterLabel} className="min-h-0 flex-1 overflow-auto py-1">
        {error !== null ? (
          <ListMessage>{t.treeFailed(error)}</ListMessage>
        ) : entries === null ? (
          <ListMessage>{t.readingTree}</ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>{query.trim() ? t.noMatch : t.empty}</ListMessage>
        ) : (
          rows.slice(0, MAX_ROWS).map(({ node, depth, expanded: isOpen }) => (
            // A tree row, not a control: role="treeitem", and up to 2000 of them, kept to the bare element.
            <button
              key={node.path}
              type="button"
              role="treeitem"
              aria-expanded={node.kind === "dir" ? isOpen : undefined}
              aria-selected={node.path === active}
              data-path={node.path}
              title={node.path}
              onClick={() => (node.kind === "dir" ? setExpanded(toggle(expanded, node.path)) : onOpen(node.path))}
              className={cn(
                "flex h-7 w-full items-center gap-1 pr-2 text-left text-sm text-dp-text-2 transition-colors duration-(--dp-dur-fast) ease-(--dp-ease-out) hover:bg-dp-hover hover:text-dp-text focus-visible:ring-2 focus-visible:ring-dp-accent/50 focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none [&_svg]:size-4 [&_svg]:shrink-0",
                node.path === active && "bg-dp-accent-soft text-dp-text hover:bg-dp-accent-soft",
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
          ))
        )}
      </div>
    </aside>
  );
}

function Tabs({ tabs, active }: { tabs: StudioTab[]; active: string | null }) {
  const t = useMessages(studioMessages);
  const [confirming, setConfirming] = useState<string | null>(null);
  const pending = tabs.find((x) => x.path === confirming);

  const close = (tab: StudioTab) => {
    if (isDirty(tab)) setConfirming(tab.path);
    else closeTab(tab.path);
  };

  return (
    <>
      <div role="tablist" className="flex h-10 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-dp-line px-2">
        {tabs.map((tab) => (
          <TabItem key={tab.path} tab={tab} active={tab.path === active} onClose={() => close(tab)} />
        ))}
      </div>
      {pending && (
        <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-dp-line bg-dp-surface px-3 py-2 text-sm">
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
    </>
  );
}

/**
 * An open file's tab stays custom, built from two Buttons side by side: the tab itself and its
 * close button. Radix Tabs has no place for a second control inside a trigger, and a tab strip of
 * documents that open, close and middle-click away is not a view switcher.
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
      {/* The path is on the name, not on the tab: a native title on the tab would stack under the close hint. */}
      <Button
        variant="ghost"
        role="tab"
        title={tab.path}
        aria-selected={active}
        onClick={() => void openFile(tab.path)}
        className="h-full gap-2 rounded-none rounded-tl-md bg-transparent pr-1 pl-3 text-sm font-normal text-current hover:bg-transparent hover:text-current focus-visible:ring-inset active:scale-100"
      >
        <span className="max-w-48 truncate">{name}</span>
        {dirty && <span data-dirty aria-label={t.modified} title={t.modified} className="size-2 shrink-0 rounded-full bg-dp-accent" />}
      </Button>
      {/* IconButton is 28 px: a tab is 32, so this one is the kit's `icon-xs` made from the same HintedButton. */}
      <HintedButton hint={t.closeTab(name)} variant="ghost" size="icon-xs" aria-label={t.closeTab(name)} onClick={onClose} className="mr-1 text-dp-text-3 hover:text-dp-text">
        <X />
      </HintedButton>
    </div>
  );
}

function FilePane({ tab }: { tab: StudioTab }) {
  const t = useMessages(studioMessages);
  const theme = useTheme();
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
        {previewing ? (
          <div data-preview className="h-full overflow-auto px-6 py-4 text-sm leading-relaxed">
            {renderMarkdown(draft)}
          </div>
        ) : (
          <CodeEditor
            path={tab.path}
            text={draft}
            revision={revision}
            theme={theme}
            onChange={(content) => editFile(tab.path, content)}
            onSave={() => void saveFile(tab.path)}
          />
        )}
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

