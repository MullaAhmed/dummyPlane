import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMessages } from "@/i18n";
import { AccentButton, QuietButton } from "@/shell/buttons";
import { ListMessage } from "@/studio/parts";
import { useProjects } from "@/store/projects";
import { groupNotesOf, setGroupNotes } from "./groupNotes";
import { notesAll } from "./ipc";
import { noteNamed } from "./links";
import { notesMessages } from "./messages";
import { closeGroupNotes, useNotesUi } from "./notesStore";

/** Which of the project's notes a group carries. */
export function GroupNotesDialog() {
  const groupId = useNotesUi((s) => s.attaching);
  return groupId ? <Chooser key={groupId} groupId={groupId} /> : null;
}

function Chooser({ groupId }: { groupId: string }) {
  const t = useMessages(notesMessages).group;
  const projectId = useProjects((s) => s.activeId);
  const [names, setNames] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState(() => groupNotesOf(groupId));
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    notesAll(projectId).then(
      (list) => alive && setNames(list.notes.map((note) => note.name)),
      (error: unknown) => alive && setFailure(String(error)),
    );
    return () => {
      alive = false;
    };
  }, [projectId]);

  const known = names ?? [];
  const gone = chosen.filter((name) => noteNamed(known.map((n) => ({ name: n })), name) === null);
  const toggle = (name: string) => setChosen((list) => (list.includes(name) ? list.filter((n) => n !== name) : [...list, name]));
  const rows = [...known, ...gone];

  return (
    <Dialog open onOpenChange={(open) => !open && closeGroupNotes()}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        {failure ? (
          <ListMessage danger>{failure}</ListMessage>
        ) : names === null ? (
          <ListMessage>{t.reading}</ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>{t.empty}</ListMessage>
        ) : (
          <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
            {rows.map((name) => (
              <li key={name}>
                <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-dp-text transition-colors duration-(--dp-dur-fast) ease-(--dp-ease-out) hover:bg-dp-hover motion-reduce:transition-none">
                  <Checkbox
                    data-attach={name}
                    checked={chosen.some((n) => n.toLowerCase() === name.toLowerCase())}
                    onCheckedChange={() => toggle(chosen.find((n) => n.toLowerCase() === name.toLowerCase()) ?? name)}
                    className="border-dp-text-3 after:-inset-1"
                  />
                  <span className="min-w-0 truncate">{name}</span>
                  {gone.includes(name) && <span className="shrink-0 text-xs text-dp-text-3">{t.missing}</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <QuietButton onClick={closeGroupNotes}>{t.cancel}</QuietButton>
          <AccentButton
            size="lg"
            disabled={names === null}
            onClick={() => {
              setGroupNotes(groupId, chosen);
              closeGroupNotes();
            }}
          >
            {t.save}
          </AccentButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
