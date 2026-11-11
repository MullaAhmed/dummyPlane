import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { launchLogin } from "@/agents/quickActions";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { AccentButton, Hint } from "@/shell/buttons";
import { accountsStore, addProfile, removeProfile, useAccounts, activateProfile } from "./store";
import { accountsMessages } from "./messages";

/** A profile's actions: one size, quiet until hovered. */
const ROW_BUTTON = "rounded-md font-normal text-dp-text-2 hover:text-dp-text";

// dp-label sits in the components layer: Label's own text-sm would win over its 12 px, so the size is said again.
const LABEL = "dp-label text-xs";

/** "Claude accounts" (spec comptes §6): profiles are a name and a folder; the login happens in Claude. */
export function AccountsDialog() {
  const t = useMessages(accountsMessages);
  const { open, profiles, active } = useAccounts((s) => s);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const id = useId();

  const guarded = (run: () => Promise<unknown>) => () =>
    run().catch((error: unknown) => toast.error(t.failed(error instanceof Error ? error.message : String(error))));
  const add = guarded(async () => {
    await addProfile(name, folder);
    setName("");
    setFolder("");
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && accountsStore.setState({ open: false })}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 text-(length:--text-ui)">
          <Row name={t.defaultName} folder={t.defaultHint} active={active === null} activeLabel={t.active}>
            {active !== null && (
              <Button size="sm" variant="ghost" className={ROW_BUTTON} onClick={guarded(() => activateProfile(null))}>
                {t.use}
              </Button>
            )}
          </Row>
          {profiles.map((p) => (
            <Row key={p.id} name={p.name} folder={p.configDir} active={active === p.id} activeLabel={t.active}>
              {active !== p.id && (
                <Button size="sm" variant="ghost" className={ROW_BUTTON} onClick={guarded(() => activateProfile(p.id))}>
                  {t.use}
                </Button>
              )}
              {/* What these two do is not in their one word: a hint says it. */}
              <Hint label={t.loginHint}>
                <Button size="sm" variant="ghost" className={ROW_BUTTON} onClick={guarded(() => launchLogin(p.id).then((placed) => !placed && toast(t.noProject)))}>
                  {t.login}
                </Button>
              </Hint>
              <Hint label={t.removeHint}>
                <Button size="sm" variant="ghost" className={cn(ROW_BUTTON, "text-dp-danger hover:bg-dp-danger/10 hover:text-dp-danger")} onClick={guarded(() => removeProfile(p.id))}>
                  {t.remove}
                </Button>
              </Hint>
            </Row>
          ))}
        </ul>
        <Separator className="bg-dp-line" />
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <p className="dp-label mb-1">{t.addTitle}</p>
          {/* A visible label over each field: the placeholder is only an example, gone once the user types. */}
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-name`} className={LABEL}>
              {t.nameLabel}
            </Label>
            <Input id={`${id}-name`} placeholder={t.namePlaceholder} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-folder`} className={LABEL}>
              {t.folderLabel}
            </Label>
            <Input id={`${id}-folder`} placeholder={t.folderPlaceholder} value={folder} onChange={(e) => setFolder(e.target.value)} className="font-mono text-xs md:text-xs" />
          </div>
          <div className="flex justify-end">
            <AccentButton type="submit" size="sm" disabled={!name.trim() || !folder.trim()}>
              {t.add}
            </AccentButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Row(props: { name: string; folder: string; active: boolean; activeLabel: string; children?: React.ReactNode }) {
  return (
    <li data-profile={props.name} className="flex items-center gap-2 rounded-md bg-dp-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-dp-text">
          {props.name}
          {/* The profile in use: quiet accent text, no pill. */}
          {props.active && <span className="ml-2 text-xs text-dp-accent-ink">{props.activeLabel}</span>}
        </p>
        <p className="truncate font-mono text-xs text-dp-text-2">{props.folder}</p>
      </div>
      {props.children}
    </li>
  );
}
