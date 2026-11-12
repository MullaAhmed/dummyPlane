import { useId, type ReactElement, type ReactNode } from "react";
import { Bell, BellRing, Bot, CircleArrowDown, Download, FileText, Gauge, ImageDown, Info, LayoutDashboard, LayoutGrid, LifeBuoy, LocateFixed, RefreshCw, Route, SlidersHorizontal, SquareTerminal, Upload } from "lucide-react";
import { arrangeWorkspace } from "@/agents/arrangeCanvas";
import { ARRANGE_LAYOUTS, readArrangeLayout } from "@/agents/arrangeLayout";
import { showAbout } from "@/app/about";
import { setArrangeLayout, useArrangeLayout } from "@/app/arrangeLayoutSetting";
import { autoArrangeStore, setAutoArrange, useAutoArrange } from "@/app/autoArrangeSetting";
import { setFollowWaiting, useFollowWaiting } from "@/app/followWaitingSetting";
import { setFinishAlerts, useFinishAlerts } from "@/app/finishAlertsSetting";
import { AGENTS } from "@/agents/catalog";
import { chooseFleetAgent, fleetAgent, useFleetAgent } from "@/fleet/fleetAgent";
import { fleetMessages } from "@/fleet/messages";
import { openLogDir } from "@/app/logs";
import { setNativeNotifications, useNativeNotifications } from "@/app/nativeNotifications";
import { MAX_SPAWNED_CHOICES, setMaxSpawned, setSubagentTerminalsSetting, useSubagentSettings } from "@/app/subagentSettings";
import { setModelRouterOn, useModelRouter } from "@/app/modelRouterSetting";
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
import { workspacesStore } from "@/store/workspaces";
import { cn } from "@/lib/utils";
import { shellMessages } from "./messages";
import { showModelLevels } from "./modelLevels";
import { showTroubleshooting } from "./troubleshoot";
import { exportCurrentScene, exportCurrentPng, importIntoScene } from "./sceneActions";

/**
 * One 32 px row everywhere, a 16 px icon column and a 10 px gap, so every label
 * starts on the same line and every tick sits in the same column; the highlight eases.
 */
const ROW = "h-8 gap-2.5 text-(length:--text-ui) transition-[background-color,color] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none";
/** An action, or a submenu's trigger. */
const ITEM = cn(ROW, "px-2");
/** A setting: its tick sits at the right, so the row keeps room for it. */
const CHOICE = cn(ROW, "pl-2 pr-8");
/** The leading icons stay a step quieter than the labels; a highlighted row lights them up. */
const ICON = "text-dp-text-2";
/** A group's name: the menu label already wears `.dp-label`; this sets it closer to its rows than to the group above. */
const LABEL = "px-2 pb-1 pt-1";
/** A hairline with room on both sides: the groups read apart. */
const SEPARATOR = "-mx-1 my-2";

/** Auto-arrange turned on: the canvas on screen is arranged at once, one step an undo takes back. */
function arrangeShown() {
  const workspaceId = workspacesStore.getState().activeId;
  if (workspaceId) arrangeWorkspace(workspaceId, { undoable: true });
}

/** Another layout while Auto-arrange keeps the canvas tidy: the canvas on screen takes it at once, one undoable step. Off, nothing moves until the next Arrange. */
function arrangeShownIfAuto() {
  if (autoArrangeStore.getState().enabled) arrangeShown();
}

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
 * Gear menu: what Excalidraw's hidden main menu used to offer, opened from `trigger`. Settings come first, grouped by what they
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
  const followWaiting = useFollowWaiting();
  const finishAlerts = useFinishAlerts();
  const autoArrange = useAutoArrange();
  const arrangeLayout = useArrangeLayout();
  const fleetT = useMessages(fleetMessages).agent;
  // The CLI the Fleet runs on: the choice, Claude until one can carry it.
  const fleetCli = useFleetAgent(() => fleetAgent());
  const subagentTerminals = useSubagentSettings((s) => s.terminals);
  const maxSpawned = useSubagentSettings((s) => s.maxSpawned);
  const modelRouter = useModelRouter((s) => s.on);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} sideOffset={12} collisionPadding={12} className="w-64 p-1">
        <Section label={t.theme}>
          <DropdownMenuRadioGroup value={choice} onValueChange={(value) => void setThemeChoice(readThemeChoice(value))}>
            {(Object.keys(PALETTES) as ThemeChoice[]).map((palette) => (
              <DropdownMenuRadioItem key={palette} className={CHOICE} value={palette} onSelect={stayOpen}>
                <Swatch palette={palette} />
                {t.palettes[palette]}
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
          <DropdownMenuItem className={ITEM} onSelect={() => void chooseFleetAgent()}>
            <Bot className={ICON} /> {fleetT.menu(AGENTS[fleetCli].label)}
          </DropdownMenuItem>
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
          {/* On, every agent routes by level unless a terminal's or a Fleet's switch is set off; its levels' models one row down. */}
          <DropdownMenuCheckboxItem className={CHOICE} checked={modelRouter} onCheckedChange={(on) => void setModelRouterOn(on === true)} onSelect={stayOpen}>
            <Route className={ICON} /> {t.modelRouter}
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem className={ITEM} onSelect={showModelLevels}>
            <SlidersHorizontal className={ICON} /> {t.modelLevels}
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem
            className={CHOICE}
            checked={nativeNotifications}
            onCheckedChange={(on) => void setNativeNotifications(on === true)}
            onSelect={stayOpen}
          >
            <Bell className={ICON} /> {t.nativeNotifications}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            className={CHOICE}
            checked={followWaiting}
            onCheckedChange={(on) => void setFollowWaiting(on === true)}
            onSelect={stayOpen}
          >
            <LocateFixed className={ICON} /> {t.followWaiting}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            className={CHOICE}
            checked={finishAlerts}
            onCheckedChange={(on) => void setFinishAlerts(on === true)}
            onSelect={stayOpen}
          >
            <BellRing className={ICON} /> {t.finishAlerts}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            className={CHOICE}
            checked={autoArrange}
            onCheckedChange={(on) => void setAutoArrange(on === true, arrangeShown)}
            onSelect={stayOpen}
          >
            <LayoutGrid className={ICON} /> {t.autoArrange}
          </DropdownMenuCheckboxItem>
          {/* The shape Arrange, a group's Arrange and Auto-arrange give the canvas. */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={ITEM}>
              <LayoutDashboard className={ICON} />
              {/* The label takes the free space: the layout's name sits against the chevron. */}
              <span className="flex-1">{t.arrangeLayout}</span>
              <span data-arrange-layout className="text-xs text-dp-text-2">
                {t.arrangeLayouts[arrangeLayout]}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent sideOffset={8} alignOffset={-5} className="w-40 p-1">
              <DropdownMenuRadioGroup value={arrangeLayout} onValueChange={(value) => void setArrangeLayout(readArrangeLayout(value), arrangeShownIfAuto)}>
                {ARRANGE_LAYOUTS.map((layout) => (
                  <DropdownMenuRadioItem key={layout} className={CHOICE} value={layout} onSelect={stayOpen}>
                    {t.arrangeLayouts[layout]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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
