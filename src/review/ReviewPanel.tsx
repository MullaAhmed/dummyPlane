import { useEffect, useState, type ReactNode } from "react";
import { FileDiff, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import { PanelTabs, PanelTabsContent, PanelTabsList, PanelTabsTrigger, PanelToggleItem } from "@/components/PanelTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { sendToAgents } from "@/agents/broadcast";
import { AGENTS } from "@/agents/catalog";
import { reviewChanges, reviewDefaultBase, reviewFileDiff, reviewFiles, reviewReadFile, type ChangedFile, type FileText } from "@/ipc/review";
import { cn } from "@/lib/utils";
import { BOTTOM_BAR_HEIGHT, TOP_ROW_HEIGHT } from "@/shell/layout";
import { messages, useMessages } from "@/i18n";
import { AccentButton, IconButton } from "@/shell/buttons";
import { sessionOf, useNodes } from "@/store/nodes";
import { DiffRow, FILE_STATUS, MAX_LINES } from "./DiffRow";
import { missionBranchFor, parseDiff, remarkRow, reviewMessage, type DiffLine, type Remark } from "./review";
import { reviewMessages } from "./messages";
import { reviewStore, useReview } from "./reviewStore";

/** The files tab lists this many paths at most; the filter finds the others. */
const MAX_FILES = 400;

/** The panel's own toasts show at the top: the default corner is where "Send" is. */
const TOAST_AWAY = { position: "top-center" } as const;

/**
 * A row of a file list: the whole width, a hover step, the file being read in the accent's tint.
 * The fill snaps: a fade on rows the pointer sweeps leaves a trail of half-lit ones.
 */
const ROW =
  "flex h-7 w-full items-center gap-2 px-3 text-left text-xs text-dp-text-2 hover:bg-dp-hover hover:text-dp-text focus-visible:ring-2 focus-visible:ring-dp-accent/70 focus-visible:outline-none focus-visible:ring-inset";
const ROW_ON = "bg-dp-accent-soft text-dp-text hover:bg-dp-accent-soft";

/** A field of the panel: shadcn's Input at the panel's density. */
const FIELD = "h-7 rounded-md px-2 text-xs md:text-xs";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What an agent changed and its folder's files, with remarks sent back to it (spec maj §5). */
export function ReviewPanel() {
  const nodeId = useReview((s) => s.nodeId);
  return nodeId ? <ReviewDrawer key={nodeId} nodeId={nodeId} /> : null;
}

function ReviewDrawer({ nodeId }: { nodeId: string }) {
  const t = useMessages(reviewMessages);
  const session = useNodes((s) => sessionOf(s.nodes[nodeId]));
  const [tab, setTab] = useState<"changes" | "files">("changes");
  // undefined while it is looked for; null: none, the work is compared with HEAD only.
  const [base, setBase] = useState<string | null | undefined>(undefined);
  const [sinceBase, setSinceBase] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const cwd = session?.cwd;

  useEffect(() => {
    if (!cwd) return;
    let alive = true;
    const mission = missionBranchFor(nodeId);
    if (mission) setBase(mission);
    else reviewDefaultBase(cwd).then((found) => alive && setBase(found), () => alive && setBase(null));
    return () => {
      alive = false;
    };
  }, [nodeId, cwd]);

  useEffect(() => {
    // An Escape a menu, a dialog or a field already used is theirs (final review maj §5).
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable === true;
      if (e.key === "Escape" && !e.defaultPrevented && !typing) reviewStore.getState().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!session || !cwd) return null;
  const name = session.name || AGENTS[session.agent].label;
  const compared = sinceBase && base ? base : null;
  return (
    <aside
      data-review={nodeId}
      className="dp-glass-strong absolute right-18 z-20 flex w-[min(920px,calc(100vw-180px))] flex-col overflow-hidden rounded-xl text-dp-text"
      style={{ top: TOP_ROW_HEIGHT + 12, bottom: BOTTOM_BAR_HEIGHT + 12 }}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-dp-line px-3">
        <FileDiff className="size-4 shrink-0 text-dp-text-2" />
        <span className="shrink-0 text-sm font-medium">{t.title(name)}</span>
        <span className="min-w-0 truncate font-mono text-xs text-dp-text-3" title={cwd}>
          {cwd}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton label={t.refresh} onClick={() => setRefresh((n) => n + 1)}>
            <RotateCw />
          </IconButton>
          <IconButton label={t.close} onClick={() => reviewStore.getState().close()}>
            <X />
          </IconButton>
        </span>
      </header>
      <PanelTabs value={tab} onValueChange={(next) => setTab(next as typeof tab)} className="min-h-0 flex-1">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-dp-line px-2">
          <PanelTabsList>
            <PanelTabsTrigger value="changes">{t.tabChanges}</PanelTabsTrigger>
            <PanelTabsTrigger value="files">{t.tabFiles}</PanelTabsTrigger>
          </PanelTabsList>
          {tab === "changes" && base && (
            <ToggleGroup
              type="single"
              spacing={1}
              aria-label={t.compare}
              value={sinceBase ? "since" : "uncommitted"}
              // One of the two always stays chosen.
              onValueChange={(next) => next && setSinceBase(next === "since")}
              className="ml-auto"
            >
              <PanelToggleItem value="uncommitted">{t.uncommitted}</PanelToggleItem>
              <PanelToggleItem value="since">{t.since(base)}</PanelToggleItem>
            </ToggleGroup>
          )}
        </div>
        <PanelTabsContent value="changes" className="flex-row">
          {base === undefined ? <Message>{t.readingRepo}</Message> : <ChangesTab key={`${cwd}:${compared}`} cwd={cwd} base={compared} refresh={refresh} />}
        </PanelTabsContent>
        <PanelTabsContent value="files" className="flex-row">
          {base === undefined ? <Message>{t.readingRepo}</Message> : <FilesTab key={cwd} cwd={cwd} refresh={refresh} />}
        </PanelTabsContent>
      </PanelTabs>
      <Remarks nodeId={nodeId} name={name} />
    </aside>
  );
}

function Message({ children }: { children: ReactNode }) {
  return <p className="grid flex-1 place-items-center p-6 text-center text-xs text-dp-text-2">{children}</p>;
}

function ChangesTab({ cwd, base, refresh }: { cwd: string; base: string | null; refresh: number }) {
  const t = useMessages(reviewMessages);
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ChangedFile | null>(null);
  const [cut, setCut] = useState(false);

  useEffect(() => {
    let alive = true;
    reviewChanges(cwd, base).then(
      (changes) => {
        if (!alive) return;
        setCut(changes.truncated === true);
        setError(null);
        setFiles(changes.files);
        // A refresh stays on the file being read when it is still changed.
        setSelected((current) => changes.files.find((f) => f.path === current?.path) ?? changes.files[0] ?? null);
      },
      (failure: unknown) => alive && setError(errorText(failure)),
    );
    return () => {
      alive = false;
    };
  }, [cwd, base, refresh]);

  if (error) return <Message>{error}</Message>;
  if (!files) return <Message>{t.readingChanges}</Message>;
  if (files.length === 0) return <Message>{base ? t.noChangesSince(base) : t.noChanges}</Message>;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ul className="w-65 shrink-0 overflow-y-auto border-r border-dp-line py-1">
        {cut && <li className="px-3 py-1 text-xs text-dp-text-3">{t.listCut(files.length)}</li>}
        {files.map((file) => {
          const status = FILE_STATUS[file.status];
          const current = selected?.path === file.path;
          return (
            <li key={file.path}>
              {/* A row of the list, not a control: Button's centred box would be undone class by class. */}
              <button
                type="button"
                title={`${file.oldPath ? `${file.oldPath} → ` : ""}${file.path} · ${t.status[file.status]}`}
                aria-current={current}
                onClick={() => setSelected(file)}
                className={cn(ROW, current && ROW_ON)}
              >
                <span className={cn("w-3 shrink-0 font-mono font-medium", status.tone)}>{status.letter}</span>
                <span className="min-w-0 flex-1 truncate" style={{ direction: "rtl", textAlign: "left" }}>
                  {file.path}
                </span>
                {file.added === null ? (
                  <span className="shrink-0 text-dp-text-3" title={t.binaryOrBig}>
                    —
                  </span>
                ) : (
                  <span className="shrink-0 font-mono tabular-nums">
                    <span className="text-dp-ok">+{file.added}</span> <span className="text-dp-danger">−{file.removed}</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {selected ? <FileDiffView key={selected.path} cwd={cwd} file={selected} base={base} refresh={refresh} /> : <Message>{t.pickFile}</Message>}
    </div>
  );
}

function FileDiffView({ cwd, file, base, refresh }: { cwd: string; file: ChangedFile; base: string | null; refresh: number }) {
  const t = useMessages(reviewMessages);
  const [diff, setDiff] = useState<{ lines: DiffLine[]; binary: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commenting, setCommenting] = useState<number | null>(null);
  // The remark being typed follows the click to another line instead of being lost.
  const [draft, setDraft] = useState("");
  const remarks = useReview((s) => s.remarks);

  useEffect(() => {
    let alive = true;
    reviewFileDiff(cwd, file, base).then(
      (text) => {
        if (!alive) return;
        setError(null);
        setDiff(parseDiff(text));
      },
      (failure: unknown) => alive && setError(errorText(failure)),
    );
    return () => {
      alive = false;
    };
  }, [cwd, file, base, refresh]);

  if (error) return <Message>{error}</Message>;
  if (!diff) return <Message>{t.readingDiff}</Message>;
  if (diff.binary) return <Message>{t.binaryNoDiff}</Message>;
  if (diff.lines.length === 0) return <Message>{t.noContentDiff}</Message>;
  const shown = diff.lines.slice(0, MAX_LINES);
  const here = remarks.filter((r) => r.file === file.path && r.line !== undefined);
  const placed = here.map((r) => remarkRow(shown, r));
  const remarkFor = (row: number) => here.filter((_, k) => placed[k] === row);
  return (
    <div className="min-w-0 flex-1 overflow-auto font-mono text-xs leading-normal">
      {shown.map((line, i) => (
        <div key={i}>
          <DiffRow line={line} onClick={line.kind === "add" || line.kind === "ctx" || line.kind === "del" ? () => setCommenting(i) : undefined} />
          {/* The user's own words on the diff: the one thing here in the accent's tint. */}
          {remarkFor(i).map((remark, j) => (
            <p key={j} className="my-1 mr-3 ml-22 rounded-md bg-dp-accent-soft px-2 py-1 font-sans text-xs text-dp-text">
              {remark.text}
            </p>
          ))}
          {commenting === i && (
            <RemarkField
              value={draft}
              onChange={setDraft}
              onDone={(text) => {
                setCommenting(null);
                setDraft("");
                if (!text) return;
                const remark: Remark =
                  line.kind === "del"
                    ? { file: file.path, line: line.old, side: "old", lineText: line.text, text }
                    : { file: file.path, line: line.new, lineText: line.text, text };
                reviewStore.getState().add(remark);
              }}
            />
          )}
        </div>
      ))}
      {diff.lines.length > MAX_LINES && <p className="px-3 py-2 font-sans text-xs text-dp-text-2">{t.moreLines(diff.lines.length - MAX_LINES)}</p>}
    </div>
  );
}

function RemarkField({ value: text, onChange: setText, onDone }: { value: string; onChange: (text: string) => void; onDone: (text: string) => void }) {
  const t = useMessages(reviewMessages);
  return (
    <div className="ml-22 flex items-center gap-2 py-1 pr-3 font-sans">
      <Input
        autoFocus
        aria-label={t.remarkLabel}
        placeholder={t.remarkPlaceholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onDone(text.trim());
          if (e.key === "Escape") onDone("");
        }}
        className={cn(FIELD, "flex-1")}
      />
    </div>
  );
}

function FilesTab({ cwd, refresh }: { cwd: string; refresh: number }) {
  const t = useMessages(reviewMessages);
  const [files, setFiles] = useState<string[] | null>(null);
  const [listCut, setListCut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    reviewFiles(cwd).then(
      (list) => {
        if (!alive) return;
        setListCut(list.truncated === true);
        setFiles(list.files);
      },
      (failure: unknown) => alive && setError(errorText(failure)),
    );
    return () => {
      alive = false;
    };
  }, [cwd, refresh]);

  if (error) return <Message>{error}</Message>;
  if (!files) return <Message>{t.readingFiles}</Message>;
  const wanted = filter.trim().toLowerCase();
  const matching = wanted ? files.filter((f) => f.toLowerCase().includes(wanted)) : files;
  const found = matching.slice(0, MAX_FILES);
  // The list is cut by Rust (very large repository) or here, for display.
  const cut = listCut || matching.length > MAX_FILES;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex w-65 shrink-0 flex-col border-r border-dp-line">
        <div className="shrink-0 p-2">
          <Input aria-label={t.filterLabel} placeholder={t.filterPlaceholder(files.length)} value={filter} onChange={(e) => setFilter(e.target.value)} className={FIELD} />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto pb-1">
          {cut && <li className="px-3 py-1 text-xs text-dp-text-3">{t.filesCut(found.length)}</li>}
          {found.map((file) => (
            <li key={file}>
              <button
                type="button"
                title={file}
                aria-current={selected === file}
                onClick={() => setSelected(file)}
                className={cn(ROW, selected === file && ROW_ON)}
              >
                <span className="min-w-0 flex-1 truncate" style={{ direction: "rtl", textAlign: "left" }}>
                  {file}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {selected ? <FileView key={selected} cwd={cwd} file={selected} /> : <Message>{t.pickFile}</Message>}
    </div>
  );
}

function FileView({ cwd, file }: { cwd: string; file: string }) {
  const t = useMessages(reviewMessages);
  const [content, setContent] = useState<FileText | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    reviewReadFile(cwd, file).then(
      (read) => alive && setContent(read),
      (failure: unknown) => alive && setError(errorText(failure)),
    );
    return () => {
      alive = false;
    };
  }, [cwd, file]);

  if (error) return <Message>{error}</Message>;
  if (!content) return <Message>{t.readingFile}</Message>;
  if (content.text === null) return <Message>{t.binaryFile(content.size)}</Message>;
  const lines = content.text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return (
    <div className="min-w-0 flex-1 overflow-auto font-mono text-xs leading-normal">
      {lines.slice(0, MAX_LINES).map((line, i) => (
        <div key={i} className="flex">
          <span className="w-12 shrink-0 pr-2 text-right text-dp-text-3 tabular-nums select-none">{i + 1}</span>
          <span className="pr-3 whitespace-pre text-dp-text">{line}</span>
        </div>
      ))}
      {(content.truncated || lines.length > MAX_LINES) && <p className="px-3 py-2 font-sans text-xs text-dp-text-2">{t.longFile}</p>}
    </div>
  );
}

/** The remarks waiting to be sent, under the panel. */
function Remarks({ nodeId, name }: { nodeId: string; name: string }) {
  const t = useMessages(reviewMessages);
  const remarks = useReview((s) => s.remarks);
  if (remarks.length === 0) return null;
  const send = async () => {
    const { sent, skipped, waiting, starting } = await sendToAgents([nodeId], reviewMessage(remarks));
    if (sent > 0) {
      reviewStore.getState().clear();
      toast(messages(reviewMessages).sent(name), TOAST_AWAY);
    } else if (waiting.length > 0) toast.warning(messages(reviewMessages).waiting(name), TOAST_AWAY);
    else if (starting.length > 0) toast.warning(messages(reviewMessages).starting(name));
    else if (skipped.length > 0) toast.warning(messages(reviewMessages).stopped(name), TOAST_AWAY);
  };
  return (
    <footer className="flex max-h-[30%] shrink-0 flex-col gap-2 border-t border-dp-line px-3 py-2">
      <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto text-xs">
        {remarks.map((remark, i) => (
          <li key={i} className="flex items-center gap-2 text-dp-text-2">
            <span className="shrink-0 font-mono text-dp-text-3 tabular-nums">
              {remark.file}
              {remark.line !== undefined ? `:${remark.line}` : ""}
            </span>
            <span className="min-w-0 flex-1 truncate text-dp-text">{remark.text}</span>
            <IconButton label={t.removeRemark} onClick={() => reviewStore.getState().remove(i)}>
              <X />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-dp-text-3 tabular-nums">{t.remarkCount(remarks.length)}</span>
        <Button variant="ghost" size="sm" className="ml-auto text-dp-text-2 hover:text-dp-text" onClick={() => reviewStore.getState().clear()}>
          {t.clear}
        </Button>
        <AccentButton size="sm" onClick={() => void send()}>
          {t.sendTo(name)}
        </AccentButton>
      </div>
    </footer>
  );
}
