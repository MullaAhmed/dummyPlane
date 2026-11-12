import { useId, useState } from "react";
import { AGENTS } from "@/agents/catalog";
import { setCliLevel, useModelRouter } from "@/app/modelRouterSetting";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n";
import { LEVELS, MAPPED_CLIS, type Level, type MappedCli } from "@/mission/router";
import { AccentButton } from "./buttons";
import { shellMessages } from "./messages";
import { closeModelLevels, useModelLevelsOpen } from "./modelLevels";

const LEVEL_KEYS = Object.keys(LEVELS) as Level[];

/**
 * "Models by level": the model each level of the router picks, a row per level. Claude's column is dummyPlane's
 * own table (`@/mission/router` LEVELS); each other CLI dummyPlane passes a model to has a field per level, saved
 * when it loses focus or on Enter. An empty field leaves that level unrouted on that CLI; a model its command line
 * would refuse is not kept, and its field says so.
 */
export function ModelLevelsDialog() {
  const open = useModelLevelsOpen();
  return open ? <Levels /> : null;
}

function Levels() {
  const t = useMessages(shellMessages).modelLevels;
  const on = useModelRouter((s) => s.on);
  const format = useId();
  return (
    <Dialog open onOpenChange={(next) => !next && closeModelLevels()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        {!on && <p className="text-xs text-dp-text-2">{t.off}</p>}
        <table className="w-full table-fixed border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left text-xs text-dp-text-2">
              <th scope="col" className="w-20 font-normal">
                {t.level}
              </th>
              <th scope="col" className="font-normal">
                {AGENTS.claude.label}
              </th>
              {MAPPED_CLIS.map((cli) => (
                <th key={cli} scope="col" className="font-normal">
                  {AGENTS[cli].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LEVEL_KEYS.map((level) => (
              <tr key={level} data-level={level}>
                <th scope="row" className="text-left font-normal text-dp-text">
                  {t.levels[level]}
                </th>
                <td className="text-dp-text-2">{LEVELS[level].modelLabel}</td>
                {MAPPED_CLIS.map((cli) => (
                  <td key={cli} className="pr-1">
                    <ModelField cli={cli} level={level} describedBy={format} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p id={format} className="text-xs text-dp-text-3">
          {t.format}
        </p>
        <DialogFooter>
          <AccentButton size="lg" onClick={closeModelLevels}>
            {t.done}
          </AccentButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One CLI's model for one level: what Settings holds, edited in place. */
function ModelField({ cli, level, describedBy }: { cli: MappedCli; level: Level; describedBy: string }) {
  const t = useMessages(shellMessages).modelLevels;
  const stored = useModelRouter((s) => s.levels[cli]?.[level] ?? "");
  const [draft, setDraft] = useState(stored);
  const [invalid, setInvalid] = useState(false);
  const save = () => {
    if (draft.trim() === stored) {
      setInvalid(false);
      return;
    }
    void setCliLevel(cli, level, draft).then((kept) => {
      setInvalid(!kept);
      if (kept) setDraft(draft.trim());
    });
  };
  return (
    <Input
      value={draft}
      placeholder={t.empty}
      spellCheck={false}
      autoComplete="off"
      aria-label={t.modelFor(AGENTS[cli].label, t.levels[level].toLowerCase())}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      data-cli={cli}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") save();
      }}
      className="h-7 font-mono text-xs"
    />
  );
}
