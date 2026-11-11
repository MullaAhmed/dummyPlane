import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Plus, RotateCw } from "lucide-react";
import { useStore } from "zustand";
import { PanelTabs, PanelTabsContent, PanelTabsList, PanelTabsTrigger } from "@/components/PanelTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { AccentButton, IconButton } from "@/shell/buttons";
import { TOP_ROW_HEIGHT } from "@/shell/layout";
import { CodeEditor } from "@/studio/CodeEditor";
import { isDirty } from "@/studio/fileSession";
import { BAR_FIELD, DiskBanner, errorText, ListMessage, Message } from "@/studio/parts";
import { useDiskWatch, useSaveKey } from "@/studio/sessionEffects";
import { UnsavedDialog } from "@/studio/UnsavedDialog";
import { notesAll, notesWrite, type NoteList } from "./ipc";
import { backlinks, noteNamed } from "./links";
import { notesMessages } from "./messages";
import { isNoteName } from "./names";
import { NoteGraph } from "./NoteGraph";
import { NoteReader } from "./NoteReader";
import { notesSession } from "./notesSession";
import { searchNotes } from "./search";

type Tab = "edit" | "read" | "graph";

/**
 * The project's notes (spec notes), in a workspace tab of their own, the way
 * the code workspace is: one note open at a time, under the code studio's
 * guards. The note and its draft are the project's session (notesSession):
 * they stay when another tab is shown.
 */
export default function NotesWorkspace({ projectId }: { projectId: string }) {
  const t = useMessages(notesMessages);
  const session = useMemo(() => notesSession(projectId), [projectId]);
  const state = useStore(session);
  const nameField = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<NoteList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // Back on a note left modified: where it was being written.
  const [tab, setTab] = useState<Tab>(() => (isDirty(session.getState()) ? "edit" : "read"));
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const [badName, setBadName] = useState(false);

  const refresh = useCallback(async () => {
    setListError(null);
    try {
      const next = await notesAll(projectId);
      setList(next);
      return next;
    } catch (failure) {
      setListError(errorText(failure));
      return null;
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useDiskWatch(session);
  useSaveKey(() => void session.getState().save());

  const { file, version, draft, loading, refused, pending, saving, error, disk } = state;
  const dirty = isDirty(state);

  // What the session wrote or reloaded: backlinks and the graph read the list. On `version` alone:
  // a modified note may differ from the disk for long, and the list must not be asked for again meanwhile.
  useEffect(() => {
    if (version && list?.notes.find((note) => note.name === file)?.version !== version) void refresh();
  }, [version]);

  /** The list, the open note as it stands in the editor. */
  const notes = useMemo(() => (list?.notes ?? []).map((note) => (note.name === file ? { ...note, text: draft } : note)), [list, file, draft]);
  const hits = useMemo(() => searchNotes(notes, query), [notes, query]);
  const linking = useMemo(() => (file ? backlinks(notes, file) : []), [notes, file]);

  const open = (name: string) => {
    void state.open(name);
    if (tab === "graph") setTab("read");
  };

  const askName = (name: string) => {
    setCreating(name);
    setBadName(false);
    nameField.current?.focus();
  };

  const create = async () => {
    const name = (creating ?? "").trim();
    if (!isNoteName(name)) return setBadName(true);
    const existing = noteNamed(list?.notes ?? [], name);
    setCreating(null);
    if (existing) return open(existing.name);
    try {
      const outcome = await notesWrite(projectId, name, `# ${name}\n`, null);
      await refresh();
      await state.open(name);
      if (outcome.status === "saved") setTab("edit");
    } catch (failure) {
      setListError(errorText(failure));
    }
  };

  // What the reading and editing views show while no note is ready.
  const waiting = !file ? <Message>{t.pickNote}</Message> : loading ? <Message>{t.readingNote}</Message> : refused ? <Message>{refused}</Message> : null;

  // The rail on the right (activities) keeps its column, as in the code workspace.
  return (
    <div data-notes aria-label={t.title} className="absolute inset-0 flex pr-18 pb-3 pl-3 text-dp-text" style={{ paddingTop: TOP_ROW_HEIGHT + 12 }}>
      <section className="dp-glass-strong flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
        <PanelTabs value={tab} onValueChange={(next) => setTab(next as Tab)} className="min-h-0 flex-1">
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-dp-line px-3">
            <BookOpen aria-hidden className="size-4 shrink-0 text-dp-text-2" />
            <h2 className="shrink-0 text-sm font-medium">{t.title}</h2>
            {file && (
              <span className="min-w-0 truncate font-mono text-xs text-dp-text-3" title={file}>
                {file}
              </span>
            )}
            {dirty && <span data-dirty title={t.modified} aria-label={t.modified} className="size-2 shrink-0 rounded-full bg-dp-accent" />}
            <PanelTabsList className="ml-auto">
              <PanelTabsTrigger value="edit">{t.tabEdit}</PanelTabsTrigger>
              <PanelTabsTrigger value="read">{t.tabRead}</PanelTabsTrigger>
              <PanelTabsTrigger value="graph">{t.tabGraph}</PanelTabsTrigger>
            </PanelTabsList>
            <span className="flex shrink-0 items-center gap-1">
              <AccentButton size="sm" disabled={!dirty || saving} onClick={() => void state.save()}>
                {saving ? t.saving : t.save}
              </AccentButton>
              <IconButton label={t.refresh} onClick={() => void refresh()}>
                <RotateCw />
              </IconButton>
            </span>
          </header>
          <div className="flex min-h-0 flex-1">
            <div className="flex w-65 shrink-0 flex-col border-r border-dp-line">
              <div className="flex shrink-0 items-center gap-1 p-2">
                <Input
                  aria-label={t.searchLabel}
                  placeholder={t.searchPlaceholder(notes.length)}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className={cn(BAR_FIELD, "flex-1")}
                />
                <IconButton label={t.newNote} onClick={() => askName("")}>
                  <Plus />
                </IconButton>
              </div>
              {creating !== null && (
                <div className="shrink-0 px-2 pb-2">
                  <Input
                    ref={nameField}
                    autoFocus
                    aria-label={t.nameLabel}
                    aria-invalid={badName}
                    placeholder={t.namePlaceholder}
                    value={creating}
                    onChange={(e) => {
                      setCreating(e.target.value);
                      setBadName(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void create();
                    }}
                    className={BAR_FIELD}
                  />
                  {badName && <p className="pt-1 text-xs text-dp-danger">{t.badName}</p>}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto pb-1">
                {listError ? (
                  <ListMessage danger>{listError}</ListMessage>
                ) : !list ? (
                  <ListMessage>{t.reading}</ListMessage>
                ) : list.notes.length === 0 ? (
                  <ListMessage>{t.empty}</ListMessage>
                ) : hits.length === 0 ? (
                  <ListMessage>{t.noResult}</ListMessage>
                ) : (
                  hits.map((hit) => (
                    // A row of the list, not a control: Button's centred box would be undone class by class.
                    <button
                      key={hit.name}
                      type="button"
                      data-note={hit.name}
                      title={hit.name}
                      aria-current={hit.name === file}
                      onClick={() => open(hit.name)}
                      className={cn(
                        "block w-full px-3 py-1.5 text-left hover:bg-dp-hover focus-visible:ring-2 focus-visible:ring-dp-accent/70 focus-visible:outline-none focus-visible:ring-inset",
                        hit.name === file && "bg-dp-accent-soft hover:bg-dp-accent-soft dp-on-soft",
                      )}
                    >
                      <span className="block truncate text-sm text-dp-text">{hit.name}</span>
                      {hit.excerpt && <span className="block truncate text-xs text-dp-text-3">{hit.excerpt}</span>}
                    </button>
                  ))
                )}
              </div>
              {list !== null && list.skipped > 0 && <p className="shrink-0 border-t border-dp-line px-3 py-2 text-xs text-dp-text-3">{t.skipped(list.skipped)}</p>}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              {disk && <DiskBanner session={session} disk={disk} />}
              {error && (
                <p role="status" className="shrink-0 border-b border-dp-line px-3 py-2 text-xs text-dp-danger">
                  {error}
                </p>
              )}
              <PanelTabsContent value="graph">
                <NoteGraph notes={notes} current={file} onOpen={open} />
              </PanelTabsContent>
              <PanelTabsContent value="read">{waiting ?? <NoteReader text={draft} notes={notes} onOpen={open} onCreate={askName} />}</PanelTabsContent>
              {/* Mounted while hidden: the views come and go, the editor's undo history stays. */}
              <PanelTabsContent value="edit" forceMount className="data-[state=inactive]:hidden">
                {waiting ?? (
                  <CodeEditor path={`${file}.md`} text={draft} revision={state.revision} onChange={state.edit} onSave={() => void state.save()} />
                )}
              </PanelTabsContent>
              {file && !loading && !refused && tab !== "graph" && (
                <section data-backlinks aria-label={t.backlinks} className="max-h-[30%] shrink-0 overflow-y-auto border-t border-dp-line px-3 py-2">
                  <h3 className="dp-label pb-1">{t.backlinks}</h3>
                  {linking.length === 0 ? (
                    <p className="text-xs text-dp-text-3">{t.noBacklinks}</p>
                  ) : (
                    <ul className="flex flex-wrap gap-x-3 gap-y-1">
                      {linking.map((note) => (
                        <li key={note.name}>
                          <Button
                            variant="link"
                            onClick={() => open(note.name)}
                            className="h-auto rounded-sm p-0 text-xs font-normal text-dp-accent-ink underline underline-offset-2 hover:decoration-2"
                          >
                            {note.name}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          </div>
        </PanelTabs>
      </section>
      <UnsavedDialog file={pending ? file : null} saving={saving} onAnswer={(answer) => void state.resolve(answer)} />
    </div>
  );
}
