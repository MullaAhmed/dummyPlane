import { useId, type ReactElement, type ReactNode } from "react";
import { Bell, CircleArrowDown, Download, FileText, Gauge, ImageDown, Info, LifeBuoy, RefreshCw, SquareTerminal, Upload } from "lucide-react";
import { showAbout } from "@/app/about";
import { openLogDir } from "@/app/logs";
import { setNativeNotifications, useNativeNotifications } from "@/app/nativeNotifications";
import { MAX_SPAWNED_CHOICES, setMaxSpawned, setSubagentTerminalsSetting, useSubagentSettings } from "@/app/subagentSettings";
import { checkForUpdate, setAutoUpdates, useUpdates } from "@/app/updates";
import { PALETTES, readThemeChoice, setThemeChoice, usePalette, type ThemeChoice } from "@/app/theme";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
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
import { cn } from "@/lib/utils";
import { shellMessages } from "./messages";
import { showTroubleshooting } from "./troubleshoot";
import { exportCurrentScene, exportCurrentPng, importIntoScene } from "./sceneActions";

/**
 * One 32 px row everywhere, a 16 px icon column and a 10 px gap, so every label
 * starts on the same line and every tick sits in the same column; the highlight eases.
 */
const ROW = "h-8 gap-2.5 text-(length:--text-ui) transition-[background-color,color] duration-150 ease-out motion-reduce:transition-none";
/** An action, or a submenu's trigger. */
const ITEM = cn(ROW, "px-2");
/** A setting: its tick sits at the right, so the row keeps room for it. */
const CHOICE = cn(ROW, "pl-2 pr-8");
/** The leading icons stay a step quieter than the labels; a highlighted row lights them up. */
const ICON = "text-dp-text-2";
/**
 * A group's name, as `.dp-label` draws it (12 px, 500, secondary, sentence case), set again
 * here because the menu label's own utilities outrank a component class; closer to its rows than to the group above.
 */
const LABEL = "dp-label px-2 pb-1 pt-1 text-xs font-medium text-dp-text-2";
/** A hairline with room on both sides: the groups read apart. */
const SEPARATOR = "-mx-1 my-2";

/** A setting changes in place: the menu stays open on its new state, where an action closes it. */
const stayOpen = (event: Event) => event.preventDefault();

/** A labelled group of the menu: the label names the group for a screen reader too. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <DropdownMenuGroup aria-labelledby={id}>
      <DropdownMenuLabel id={id} className={LABEL}>
        {label}
      </DropdownMenuLabel>
      {children}
    </DropdownMenuGroup>
  );
}

/** A palette in miniature: its canvas, and its accent at the centre. */
function Swatch({ palette }: { palette: ThemeChoice }) {
  const { canvas, accent } = PALETTES[palette];
  return (
    <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded-sm ring-1 ring-dp-line ring-inset" style={{ backgroundColor: canvas }}>
      <span className="size-1.5 rounded-full" style={{ backgroundColor: accent }} />
    </span>
  );
}

/**
 * Gear menu: what Excalidraw's hidden main menu used to offer (spec habillage
 * §5.2), opened from `trigger`. Settings come first, grouped by what they
 * change; the scene's files next; help last, one level down.
 */
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
  const choice = usePalette();
  const autoUpdates = useUpdates((s) => s.auto);
  const nativeNotifications = useNativeNotifications();
  const subagentTerminals = useSubagentSettings((s) => s.terminals);
  const maxSpawned = useSubagentSettings((s) => s.maxSpawned);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} sideOffset={12} collisionPadding={12} className="w-64 p-1">
        <Section label={t.theme}>
          <DropdownMenuRadioGroup value={choice} onValueChange={(value) => void setThemeChoice(readThemeChoice(value))}>
            {(Object.keys(PALETTES) as ThemeChoice[]).map((palette) => (
              <DropdownMenuRadioItem key={palette} className={CHOICE} value={palette} onSelect={stayOpen}>
                <Swatch palette={palette} />
                {PALETTES[palette].name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </Section>
        <DropdownMenuSeparator className={SEPARATOR} />
        <Section label={t.scene}>
          <DropdownMenuItem className={ITEM} onSelect={exportCurrentScene}>
            <Download className={ICON} /> {t.exportScene}
          </DropdownMenuItem>
          <DropdownMenuItem className={ITEM} onSelect={importIntoScene}>
            <Upload className={ICON} /> {t.importScene}
          </DropdownMenuItem>
          <DropdownMenuItem className={ITEM} onSelect={exportCurrentPng}>
            <ImageDown className={ICON} /> {t.exportPng}
          </DropdownMenuItem>
        </Section>
        <DropdownMenuSeparator className={SEPARATOR} />
        <Section label={t.agents}>
          <DropdownMenuCheckboxItem
            className={CHOICE}
            checked={subagentTerminals}
            onCheckedChange={(on) => void setSubagentTerminalsSetting(on === true)}
            onSelect={stayOpen}
          >
            <SquareTerminal className={ICON} /> {t.subagentTerminals}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={ITEM}>
              <Gauge className={ICON} />
              {/* The label takes the free space: the count sits against the chevron. */}
              <span className="flex-1">{t.maxSpawned}</span>
              <span data-max-spawned className="font-mono text-xs tabular-nums text-dp-text-2">
                {maxSpawned}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent sideOffset={8} alignOffset={-5} className="w-24 p-1">
              <DropdownMenuRadioGroup value={String(maxSpawned)} onValueChange={(value) => void setMaxSpawned(Number(value))}>
                {MAX_SPAWNED_CHOICES.map((n) => (
                  <DropdownMenuRadioItem key={n} className={cn(CHOICE, "font-mono tabular-nums")} value={String(n)} onSelect={stayOpen}>
                    {n}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuCheckboxItem
            className={CHOICE}
            checked={nativeNotifications}
            onCheckedChange={(on) => void setNativeNotifications(on === true)}
            onSelect={stayOpen}
          >
            <Bell className={ICON} /> {t.nativeNotifications}
          </DropdownMenuCheckboxItem>
        </Section>
        <DropdownMenuSeparator className={SEPARATOR} />
        <Section label={t.updates}>
          <DropdownMenuCheckboxItem
            className={CHOICE}
            checked={autoUpdates}
            onCheckedChange={(on) => void setAutoUpdates(on === true)}
            onSelect={stayOpen}
          >
            <RefreshCw className={ICON} /> {t.autoUpdates}
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem className={ITEM} onSelect={() => void checkForUpdate({ manual: true })}>
            <CircleArrowDown className={ICON} /> {t.checkUpdates}
          </DropdownMenuItem>
        </Section>
        <DropdownMenuSeparator className={SEPARATOR} />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={ITEM}>
            <LifeBuoy className={ICON} />
            <span className="flex-1">{t.help}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent sideOffset={8} alignOffset={-5} className="w-56 p-1">
            <DropdownMenuItem className={ITEM} onSelect={() => void showTroubleshooting()}>
              <LifeBuoy className={ICON} /> {t.troubleshoot}
            </DropdownMenuItem>
            <DropdownMenuItem className={ITEM} onSelect={() => void openLogDir()}>
              <FileText className={ICON} /> {t.openLogs}
            </DropdownMenuItem>
            <DropdownMenuSeparator className={SEPARATOR} />
            <DropdownMenuItem className={ITEM} onSelect={() => void showAbout()}>
              <Info className={ICON} /> {t.about}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
