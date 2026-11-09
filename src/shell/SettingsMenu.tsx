import type { ReactElement } from "react";
import { ArrowDownCircle, Download, FileText, ImageDown, Info, LifeBuoy, Upload } from "lucide-react";
import { showAbout } from "@/app/about";
import { openLogDir } from "@/app/logs";
import { setNativeNotifications, useNativeNotifications } from "@/app/nativeNotifications";
import { MAX_SPAWNED_CHOICES, setMaxSpawned, setSubagentTerminalsSetting, useSubagentSettings } from "@/app/subagentSettings";
import { checkForUpdate, setAutoUpdates, useUpdates } from "@/app/updates";
import { PALETTES, readThemeChoice, setThemeChoice, setTransparency, useThemeSettings, type ThemeChoice } from "@/app/theme";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMessages } from "@/i18n";
import { shellMessages } from "./messages";
import { showTroubleshooting } from "./troubleshoot";
import { exportCurrentPng, exportCurrentScene, importIntoScene } from "./sceneActions";

/** Every row of the gear menu eases its highlight; the rows share one icon gap. */
const ROW = "gap-2 transition-[background-color,color] duration-150 ease-out motion-reduce:transition-none";

/** Gear menu: what Excalidraw's hidden main menu used to offer (spec habillage §5.2), opened from `trigger`. */
export function SettingsMenu({
  trigger,
  side = "bottom",
  align = "end",
}: {
  trigger: ReactElement;
  side?: "bottom" | "left";
  align?: "start" | "end";
}) {
  const t = useMessages(shellMessages).settings;
  const { choice, transparency } = useThemeSettings();
  const autoUpdates = useUpdates((s) => s.auto);
  const nativeNotifications = useNativeNotifications();
  const subagentTerminals = useSubagentSettings((s) => s.terminals);
  const maxSpawned = useSubagentSettings((s) => s.maxSpawned);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="w-56 shadow-dp ring-dp-line">
        <DropdownMenuLabel className="dp-label">{t.theme}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={choice} onValueChange={(value) => void setThemeChoice(readThemeChoice(value))}>
          {(Object.keys(PALETTES) as ThemeChoice[]).map((palette) => (
            <DropdownMenuRadioItem key={palette} className={ROW} value={palette}>
              {PALETTES[palette].name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuCheckboxItem className={ROW} checked={transparency} onCheckedChange={(on) => void setTransparency(on === true)}>
          {t.transparency}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className={ROW} onSelect={exportCurrentScene}>
          <Download /> {t.exportScene}
        </DropdownMenuItem>
        <DropdownMenuItem className={ROW} onSelect={importIntoScene}>
          <Upload /> {t.importScene}
        </DropdownMenuItem>
        <DropdownMenuItem className={ROW} onSelect={exportCurrentPng}>
          <ImageDown /> {t.exportPng}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          className={ROW}
          checked={nativeNotifications}
          onCheckedChange={(on) => void setNativeNotifications(on === true)}
        >
          {t.nativeNotifications}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          className={ROW}
          checked={subagentTerminals}
          onCheckedChange={(on) => void setSubagentTerminalsSetting(on === true)}
        >
          {t.subagentTerminals}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={ROW}>{t.maxSpawned(maxSpawned)}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="shadow-dp ring-dp-line">
            <DropdownMenuRadioGroup value={String(maxSpawned)} onValueChange={(value) => void setMaxSpawned(Number(value))}>
              {MAX_SPAWNED_CHOICES.map((n) => (
                <DropdownMenuRadioItem key={n} className={ROW} value={String(n)}>
                  {n}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuCheckboxItem className={ROW} checked={autoUpdates} onCheckedChange={(on) => void setAutoUpdates(on === true)}>
          {t.autoUpdates}
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem className={ROW} onSelect={() => void checkForUpdate({ manual: true })}>
          <ArrowDownCircle /> {t.checkUpdates}
        </DropdownMenuItem>
        <DropdownMenuItem className={ROW} onSelect={() => void showAbout()}>
          <Info /> {t.about}
        </DropdownMenuItem>
        <DropdownMenuItem className={ROW} onSelect={() => void openLogDir()}>
          <FileText /> {t.openLogs}
        </DropdownMenuItem>
        <DropdownMenuItem className={ROW} onSelect={() => void showTroubleshooting()}>
          <LifeBuoy /> {t.troubleshoot}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
