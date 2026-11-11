import { useState } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/errorToast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUiRequest } from "@/commands/uiRequests";
import { messages, useMessages } from "@/i18n";
import { AccentButton, QuietButton } from "@/shell/buttons";
import { captureCurrentTeam } from "./live";
import { presetNameOf } from "./model";
import { presetsMessages } from "./messages";
import { presetsStore, usePresets } from "./store";

/** The name of a preset to save, opened by “Save the team as a preset…”. */
export function SavePresetDialog() {
  const t = useMessages(presetsMessages).dialog;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const presets = usePresets((s) => s.presets);
  useUiRequest("savePreset", () => {
    setName("");
    setOpen(true);
    void presetsStore.getState().load();
    return true;
  });
  const kept = presetNameOf(name);
  const replaced = kept ? presets.find((p) => p.name.toLocaleLowerCase() === kept.toLocaleLowerCase()) : undefined;

  const save = async () => {
    if (!kept) return;
    const text = messages(presetsMessages).toast;
    const preset = captureCurrentTeam(kept);
    setOpen(false);
    if (preset === "noCanvas" || !preset) {
      toastError(preset === "noCanvas" ? text.noCanvas : text.nothing);
      return;
    }
    try {
      if (await presetsStore.getState().save(preset)) toast(text.saved(kept));
      else toastError(text.full);
    } catch (error) {
      toastError(text.failed, { error });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          aria-label={t.nameLabel}
          placeholder={t.placeholder}
          maxLength={120}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            // The Enter that ends an IME composition picks a candidate: it saves nothing.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
        />
        {replaced && <p className="text-xs text-dp-wait">{t.replaces(replaced.name)}</p>}
        <DialogFooter>
          <QuietButton onClick={() => setOpen(false)}>{t.cancel}</QuietButton>
          <AccentButton size="lg" disabled={!kept} onClick={() => void save()}>
            {t.save}
          </AccentButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
