import { useCallback, useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { studioRead } from "@/ipc/studio";
import { useMessages } from "@/i18n";
import { useNodes } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { isMarkdown, renderMarkdown } from "@/studio/markdown";
import { nodesMessages } from "../messages";

type Content = { state: "loading" } | { state: "ready"; text: string } | { state: "error"; message: string };

/** A file of the project on the canvas: read-only, Markdown rendered, code in mono (issue #49). */
export function FileNode({ nodeId }: { nodeId: string }) {
  const t = useMessages(nodesMessages);
  const record = useNodes((s) => s.nodes[nodeId]);
  const path = record?.kind === "file" ? record.payload.path : null;
  const [content, setContent] = useState<Content>({ state: "loading" });

  const load = useCallback(() => {
    const project = projectsStore.getState().activeId;
    if (!project || !path) return;
    setContent({ state: "loading" });
    studioRead(project, path).then(
      ({ text }) => setContent({ state: "ready", text }),
      (error: unknown) => setContent({ state: "error", message: String(error) }),
    );
  }, [path]);

  useEffect(load, [load]);

  if (!path) return <div className="grid h-full place-items-center rounded-xl border border-dp-line bg-dp-surface text-dp-text-2">{t.file.notFound}</div>;
  const name = path.split(/[\\/]/).pop() ?? path;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-dp-line bg-dp-surface text-dp-text">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-dp-line px-3">
        <FileText className="size-4 shrink-0 text-dp-accent" />
        <span className="shrink-0 truncate text-[13px] font-semibold text-dp-text">{name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-dp-text-2" title={path}>{path}</span>
        <Button variant="ghost" size="icon-sm" title={t.file.refresh} aria-label={t.file.refresh} onClick={load}>
          <RefreshCw className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {content.state === "loading" && <p className="text-xs text-dp-text-2">{t.file.loading}</p>}
        {content.state === "error" && <p className="text-xs text-dp-danger">{t.file.readFailed(content.message)}</p>}
        {content.state === "ready" && content.text === "" && <p className="text-xs text-dp-text-2">{t.file.empty}</p>}
        {content.state === "ready" && content.text !== "" &&
          (isMarkdown(path) ? renderMarkdown(content.text) : <pre className="font-mono text-xs whitespace-pre">{content.text}</pre>)}
      </div>
    </div>
  );
}
