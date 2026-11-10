import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { FileText } from "lucide-react";
import { useMessages } from "@/i18n";
import { TITLE_BAR_HEIGHT } from "@/shell/layout";
import { useProjects } from "@/store/projects";
import { useFileIndex } from "@/studio/fileIndex";
import { parseFileQuery, rankFiles } from "@/studio/fileSearch";
import { openInCodeStudio } from "@/studio/navigate";
import { runCommand } from "./command";
import { functionSections, recentSection } from "./functions";
import { goToSections } from "./goTo";
import { GoToRow } from "./GoToRow";
import { goTo } from "./goToRun";
import { commandsMessages } from "./messages";
import { closePalette, modeOf, setPaletteQuery, stripPrefix, usePalette } from "./paletteState";
import { agentsStore, useAgents } from "@/fleet/agentsStore";
import { loopCommands } from "@/loops/commands";
import { presetCommands } from "@/presets/commands";
import { presetsStore, usePresets } from "@/presets/store";
import { rememberFunction, useRecentFunctions } from "./recent";
import { COMMANDS } from "./registry";
import { useGoToData } from "./useGoToData";

// Section titles like `.dp-label`, sentence case (a component class takes no variant in Tailwind 4):
// closer to their own rows than to the section above.
const HEADING =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-dp-text-2 [&_[cmdk-group:first-child]_[cmdk-group-heading]]:pt-1";
const ITEM =
  "flex h-8 cursor-default items-center gap-2 rounded-md px-2.5 text-(length:--text-ui) text-dp-text-2 transition-[background-color] duration-150 ease-out hover:bg-dp-hover data-[selected=true]:bg-dp-accent-soft motion-reduce:transition-none";

/** The palette (spec window §7.1), under the title bar, centered; rendered only while open. */
export function Palette() {
  const open = usePalette((s) => s.open);
  const openings = usePalette((s) => s.openings);
  return open ? <PaletteBody key={openings} /> : null;
}

function PaletteBody() {
  const t = useMessages(commandsMessages).palette;
  const query = usePalette((s) => s.query);
  const context = usePalette((s) => s.context);
  const mode = modeOf(query);
  const search = stripPrefix(query);
  const goToData = useGoToData();
  // "Launch …" greys the agents not found: look again when the functions open, and follow the answer.
  useAgents((s) => s.agents);
  useEffect(() => {
    if (mode !== "functions") return;
    void agentsStore.getState().load().catch(() => undefined);
    void presetsStore.getState().load().catch(() => undefined);
  }, [mode]);
  const recent = useRecentFunctions();
  const goToList = mode === "goTo" ? goToSections(goToData.items, search) : [];
  // The saved team presets add their lines to the registry's (spec presets §3).
  const presets = usePresets((s) => s.presets);
  const loops = useMemo(() => loopCommands(), []);
  const commands = useMemo(() => [...COMMANDS, ...presetCommands(presets), ...loops], [presets, loops]);
  const projectId = useProjects((s) => (s.view === "project" ? s.activeId : null));
  const fileIndex = useFileIndex(mode === "goTo" ? projectId : null);
  const fileQuery = parseFileQuery(search);
  // Files only while searching: the project's whole tree would bury the nodes.
  const files = mode === "goTo" && fileQuery.text ? rankFiles(fileIndex.files, fileQuery.text, FILE_LIMIT) : [];
  // `App.tsx:42`, a dot or a slash: a file is sought, its section comes first.
  const filesFirst = fileQuery.line !== undefined || /[./]/.test(fileQuery.text);
  const goToBusy = mode === "goTo" && (goToData.loading || (fileIndex.loading && fileQuery.text !== ""));
  const functionList = mode === "functions" && context ? functionSections(commands, context, search, recent) : [];
  const keys =
    mode === "goTo"
      ? (filesFirst ? [...files.map(fileKey), ...goToList.flatMap((s) => s.items.map((i) => i.key))] : [...goToList.flatMap((s) => s.items.map((i) => i.key)), ...files.map(fileKey)])
      : functionList.flatMap((s) => s.items.filter((l) => l.disabled === null).map((l) => l.command.id));
  const [chosen, setChosen] = useState("");
  // The first line is chosen when it opens and after each keystroke (spec window §7.1).
  useEffect(() => setChosen(""), [query]);
  const value = keys.includes(chosen) ? chosen : (keys[0] ?? "");

  return (
    <div data-palette-backdrop className="fixed inset-0 z-50" onPointerDown={(e) => e.target === e.currentTarget && closePalette()}>
      {/* dp-glass-strong carries the opaque surface, hairline and floating shadow, as for every menu. */}
      <div
        className="dp-glass-strong absolute left-1/2 -translate-x-1/2 overflow-hidden rounded-lg"
        style={{ top: TITLE_BAR_HEIGHT + 8, width: "min(560px, calc(100vw - 32px))" }}
      >
        <Command
          label={t.label}
          shouldFilter={false}
          loop
          value={value}
          onValueChange={setChosen}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              // Placement and link modes end on Escape at the window: not this one.
              e.stopPropagation();
              closePalette();
            }
            // The keyboard never leaves an open palette.
            if (e.key === "Tab") e.preventDefault();
          }}
        >
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setPaletteQuery}
            placeholder={mode === "goTo" ? t.placeholderGoTo : t.placeholderFunctions}
            className="h-11 w-full border-b border-dp-line bg-transparent px-3.5 text-(length:--text-ui) text-dp-text outline-none placeholder:text-dp-text-3 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dp-accent/50"
          />
          {/* 4 px in, rows 10 px in: every row's text starts 14 px in, on the field's own line. */}
          <Command.List className={`max-h-[420px] overflow-y-auto p-1 ${HEADING}`}>
            {filesFirst && <FileSection files={files} line={fileQuery.line} column={fileQuery.column} />}
            {mode === "goTo" &&
              goToList.map((section) => (
                <Command.Group key={section.kind} heading={section.label}>
                  {section.items.map((item) => (
                    <Command.Item
                      key={item.key}
                      value={item.key}
                      className={ITEM}
                      onSelect={() => {
                        closePalette();
                        goTo(item);
                      }}
                    >
                      <GoToRow item={item} />
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            {!filesFirst && <FileSection files={files} line={fileQuery.line} column={fileQuery.column} />}
            {mode === "functions" &&
              context &&
              functionList.map((section) => (
                <Command.Group key={section.label} heading={section.label}>
                  {section.items.map((line) => (
                    <Command.Item
                      key={line.command.id}
                      value={line.command.id}
                      disabled={line.disabled !== null}
                      className={`${ITEM} data-[disabled=true]:opacity-50`}
                      onSelect={() => {
                        rememberFunction(line.command.id);
                        closePalette();
                        runCommand(line.command, context);
                      }}
                    >
                      <span className="truncate text-dp-text">{line.label}</span>
                      {/* A recent line tells where it comes from: "Rename" of which terminal. */}
                      {section.label === recentSection() && <span className="shrink-0 text-xs text-dp-text-3">{line.section}</span>}
                      {line.disabled !== null ? (
                        <span className="ml-auto shrink-0 text-xs text-dp-text-3">{line.disabled}</span>
                      ) : (
                        line.hint && <span className="ml-auto shrink-0 font-mono text-xs text-dp-text-3">{line.hint}</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            {goToBusy && <div className="px-2.5 py-1.5 text-xs text-dp-text-3">{t.loading}</div>}
            {!goToBusy && <Command.Empty className="px-2.5 py-3 text-(length:--text-ui) text-dp-text-3">{t.empty}</Command.Empty>}
          </Command.List>
          <footer className="border-t border-dp-line px-3.5 py-1.5 text-xs text-dp-text-3">{t.footer}</footer>
        </Command>
      </div>
    </div>
  );
}

const FILE_LIMIT = 30;
const fileKey = (path: string) => `file:${path}`;

/** The project's files matching the search (Ctrl+P `file:line`): one opens in the Code Studio, at its line. */
function FileSection({ files, line, column }: { files: readonly string[]; line?: number; column?: number }) {
  const t = useMessages(commandsMessages).goTo;
  if (files.length === 0) return null;
  return (
    <Command.Group heading={t.sections.file}>
      {files.map((path) => {
        const cut = path.lastIndexOf("/");
        return (
          <Command.Item
            key={path}
            value={fileKey(path)}
            className={ITEM}
            onSelect={() => {
              closePalette();
              void openInCodeStudio(path, line, column);
            }}
          >
            <FileText className="size-3.5 shrink-0 text-dp-text-3" />
            <span className="truncate font-medium text-dp-text">{path.slice(cut + 1)}</span>
            {cut > 0 && <span className="truncate text-dp-text-3">{path.slice(0, cut)}</span>}
            {line !== undefined && <span className="ml-auto shrink-0 font-mono text-xs text-dp-text-3">{t.atLine(line)}</span>}
          </Command.Item>
        );
      })}
    </Command.Group>
  );
}
