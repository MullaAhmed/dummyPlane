import { useEffect, useState, type ReactNode } from "react";
import { CaptureUpdateAction, mutateElement } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { useTheme } from "@/app/theme";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { nodeNameOf, useNodes } from "@/store/nodes";
import { PEN_COLORS } from "@/theme/penColors";
import { displayColorFor } from "@/theme/sceneColors";
import { canvasStore, useCanvas } from "./canvasStore";
import { screenRectOf } from "@/agents/placement";
import {
  arrowTypeOf,
  deleteSelection,
  duplicateSelection,
  isConnector,
  restyleSelection,
  roughnessOf,
  type ArrowType,
  type Restyle,
  type Roughness,
} from "./drawnSelection";
import { canvasMessages } from "./messages";
import { keepCanvasFocus, PanelAction } from "./PanelAction";
import { besideRect, PANEL_WIDTH, TAB_WIDTH, type PanelPlace } from "./panelPlace";
import { selectedEditId, TerminalEdit } from "./TerminalEdit";

const TRANSPARENT = "transparent";
/** Excalidraw's roughness 0, 1 and 2: its architect, artist and cartoonist. */
const SLOPPINESS = ["clean", "sketchy", "rough"] as const;
const ROUGHNESS_LEVELS: readonly Roughness[] = [0, 1, 2];
const ARROW_TYPES: readonly ArrowType[] = ["sharp", "round", "elbow"];

/**
 * The small panel that replaces Excalidraw's properties panel. A drawn element
 * gets its stroke and background colours, Duplicate and Delete, and a line or
 * an arrow also its sloppiness (and an arrow its type), at the canvas's left
 * edge. A terminal, or the Fleet, selected alone gets a small Edit tab beside
 * it, which opens its edit panel there (TerminalEdit); both follow it as the
 * view moves. The panel folds back to the tab, and every terminal or Fleet
 * selected starts on its tab: an open panel never stands beside a node unasked.
 * It does not show in reading mode.
 */
export function SelectionPanel() {
  const drawn = useCanvas((s) => s.drawnSelection);
  const readOnly = useCanvas((s) => s.view.mode === "reading");
  const selectedIds = useCanvas((s) => s.view.selectedIds);
  // The terminal or Fleet selected alone: the one with an edit panel (the names below say terminal, as the code does).
  const terminalId = useNodes((s) => selectedEditId(selectedIds, s.nodes));
  // The node whose panel was opened from its tab; selecting another, or none, folds it.
  const [openFor, setOpenFor] = useState<string | null>(null);
  useEffect(() => {
    if (openFor !== null && openFor !== terminalId) setOpenFor(null);
  }, [openFor, terminalId]);
  const open = terminalId !== null && openFor === terminalId;
  const beside = useTerminalPlace(terminalId, open ? PANEL_WIDTH : TAB_WIDTH);
  if ((drawn.length === 0 && !terminalId) || readOnly) return null;
  if (terminalId && !open) return <EditTab nodeId={terminalId} place={beside} onOpen={() => setOpenFor(terminalId)} />;

  return (
    <div
      className={cn(
        "dp-glass-strong absolute z-10 rounded-lg p-3",
        // A terminal's panel (PANEL_WIDTH) keeps its title and tabs in place and scrolls the page under them;
        // a drawing's is one native scroller. Either way bounded by a max-height only, which a ScrollArea's viewport cannot follow.
        terminalId ? "flex w-84 flex-col overflow-hidden" : "w-56 overflow-y-auto",
        // Opened from its tab, in the tab's place: it eases in (opacity and a 4 px slide); folding is instant.
        terminalId && "animate-in fade-in-0 slide-in-from-left-1 duration-(--dp-dur) ease-(--dp-ease-out) motion-reduce:animate-none",
        !beside && "left-[70px] top-1/2 max-h-[calc(100%-120px)] -translate-y-1/2",
      )}
      style={beside}
    >
      {terminalId && <TerminalEdit nodeId={terminalId} onFold={() => setOpenFor(null)} />}
      {drawn.length > 0 && <DrawnControls drawn={drawn} />}
    </div>
  );
}

/**
 * A selected terminal's panel, folded: a small tab beside the terminal, at
 * its top, filled with the ink so it stands out next to the selection's own
 * outline. A press keeps the keyboard where it was; a click opens the panel
 * in its place.
 */
function EditTab({ nodeId, place, onOpen }: { nodeId: string; place: PanelPlace | undefined; onOpen: () => void }) {
  const t = useMessages(canvasMessages).selection;
  const name = useNodes((s) => nodeNameOf(s.nodes[nodeId]));
  const fleet = useNodes((s) => s.nodes[nodeId]?.kind === "fleet");
  const label = t.editTerminal(name || (fleet ? t.thisFleet : t.thisTerminal));
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={false}
      title={label}
      onMouseDown={keepCanvasFocus}
      onClick={onOpen}
      className={cn(
        "absolute z-10 flex h-7 w-18 items-center justify-center gap-1.5 rounded-lg bg-dp-accent text-xs font-medium text-dp-on-accent shadow-dp",
        "transition-[background-color,scale] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none hover:bg-dp-accent/85 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dp-accent",
        "animate-in fade-in-0 duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:animate-none",
        !place && "left-[70px] top-1/2 -translate-y-1/2",
      )}
      style={place && { left: place.left, top: place.top }}
    >
      <Pencil className="size-3.5" aria-hidden />
      {t.edit}
    </button>
  );
}

/** Where the selected terminal's tab or panel (`width` wide) sits, beside it on screen; none when no terminal is selected or its place is not known yet. */
function useTerminalPlace(terminalId: string | null, width: number): PanelPlace | undefined {
  const rect = useCanvas((s) => (terminalId ? s.nodeRects[terminalId] : undefined));
  const scrollX = useCanvas((s) => s.view.scrollX);
  const scrollY = useCanvas((s) => s.view.scrollY);
  const zoom = useCanvas((s) => s.view.zoom);
  const canvasWidth = useCanvas((s) => s.view.width);
  const height = useCanvas((s) => s.view.height);
  if (!rect || canvasWidth === 0 || height === 0) return undefined;
  const screen = screenRectOf(rect, { scrollX, scrollY, zoom, offsetLeft: 0, offsetTop: 0 });
  return besideRect(screen, { width: canvasWidth, height }, width);
}

function DrawnControls({ drawn }: { drawn: ExcalidrawElement[] }) {
  const t = useMessages(canvasMessages).selection;
  const theme = useTheme();
  const swatches: SwatchOption[] = PEN_COLORS.map(({ scene }, i) => ({ scene, name: t.colorNames[i], color: displayColorFor(scene, theme) }));
  const backgrounds: SwatchOption[] = [{ scene: TRANSPARENT, name: t.transparent, color: null }, ...swatches];

  // The first element shows the values in force; a change applies to all of them.
  const { strokeColor, backgroundColor } = drawn[0];
  const connector = drawn.find(isConnector);
  const arrow = drawn.find((element) => element.type === "arrow");

  const apply = (patch: Restyle) =>
    withApi((api) => {
      const selected = api.getAppState().selectedElementIds;
      api.updateScene({
        elements: restyleSelection(api.getSceneElementsIncludingDeleted(), selected, patch),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      if ("arrowType" in patch && patch.arrowType === "elbow") routeElbows(api, selected);
    });

  const duplicate = () =>
    withApi((api) => {
      const { elements, copies } = duplicateSelection(api.getSceneElementsIncludingDeleted(), api.getAppState().selectedElementIds, {
        offset: 20,
        newId: () => crypto.randomUUID(),
      });
      if (copies.length === 0) return;
      api.updateScene({
        elements,
        appState: { selectedElementIds: Object.fromEntries(copies.map((id) => [id, true as const])) },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });

  const remove = () =>
    withApi((api) =>
      api.updateScene({
        elements: deleteSelection(api.getSceneElementsIncludingDeleted(), api.getAppState().selectedElementIds),
        appState: { selectedElementIds: {}, selectedGroupIds: {} },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      }),
    );

  return (
    <div className="grid gap-3">
      <Row label={t.stroke}>
        <Swatches label={t.stroke} swatches={swatches} value={strokeColor} onPick={(scene) => apply({ strokeColor: scene })} />
      </Row>
      <Row label={t.background}>
        <Swatches label={t.background} swatches={backgrounds} value={backgroundColor} onPick={(scene) => apply({ backgroundColor: scene })} />
      </Row>
      {connector && (
        <Row label={t.sloppiness}>
          <Segmented
            label={t.sloppiness}
            options={ROUGHNESS_LEVELS.map((level) => ({ value: level, text: t.sloppinessLevels[SLOPPINESS[level]] }))}
            value={roughnessOf(connector)}
            onPick={(roughness) => apply({ roughness })}
          />
        </Row>
      )}
      {arrow && (
        <Row label={t.arrowType}>
          <Segmented
            label={t.arrowType}
            options={ARROW_TYPES.map((value) => ({ value, text: t.arrowTypes[value] }))}
            value={arrowTypeOf(arrow)}
            onPick={(arrowType) => apply({ arrowType })}
          />
        </Row>
      )}
      <div className="flex gap-1.5">
        <PanelAction icon={<Copy className="size-3.5" />} label={t.duplicate} onClick={duplicate} />
        <PanelAction icon={<Trash2 className="size-3.5" />} label={t.delete} onClick={remove} danger />
      </div>
    </div>
  );
}

function withApi(run: (api: ExcalidrawImperativeAPI) => void) {
  const api = canvasStore.getState().api;
  if (api) run(api);
}

/**
 * An arrow just made elbowed holds only its two ends; Excalidraw routes the
 * elbow from them when the arrow is touched, which a no-op change does.
 */
function routeElbows(api: ExcalidrawImperativeAPI, selected: Readonly<Record<string, true>>) {
  for (const element of api.getSceneElementsIncludingDeleted()) {
    if (selected[element.id] !== true || element.type !== "arrow" || element.isDeleted) continue;
    try {
      mutateElement(element, {});
    } catch (error) {
      console.warn(`arrow ${element.id}: could not route the elbow`, error);
    }
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <p className="dp-label">{label}</p>
      {children}
    </div>
  );
}

type SwatchOption = { scene: string; name: string; color: string | null };

/**
 * A row of colours, one of them in force. Each colour is a tab stop of its
 * own (no roving focus): on the canvas, the arrows belong to Excalidraw, which
 * nudges the selection with them. A press keeps the keyboard on the canvas.
 */
function Swatches({ label, swatches, value, onPick }: { label: string; swatches: readonly SwatchOption[]; value: string; onPick: (scene: string) => void }) {
  return (
    <ToggleGroup
      type="single"
      rovingFocus={false}
      aria-label={label}
      value={value}
      // Pressing the colour shown again clears the group's value: it applies that colour instead, to a mixed selection too.
      onValueChange={(scene) => onPick(scene || value)}
      className="flex-wrap"
    >
      {swatches.map(({ scene, name, color }) => (
        <Tooltip key={scene}>
          <TooltipTrigger asChild>
            <ToggleGroupItem
              value={scene}
              aria-label={`${label}: ${name}`}
              onMouseDown={keepCanvasFocus}
              // Styled on aria-checked: the tooltip's trigger takes over data-state.
              variant="swatch"
              className={cn(
                "border",
                color === null ? "border-dashed border-dp-line focus-visible:border-dp-line" : "border-dp-line/60 focus-visible:border-dp-line/60",
              )}
              style={color === null ? undefined : { backgroundColor: color }}
            />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {name}
          </TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}

/** One choice out of a few, side by side: the chosen one is filled. Like the colours, no roving focus on the canvas. */
function Segmented<V extends string | number>(props: {
  label: string;
  options: readonly { value: V; text: string }[];
  value: V;
  onPick: (value: V) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      rovingFocus={false}
      aria-label={props.label}
      value={String(props.value)}
      // As for the colours: the choice shown, pressed again, applies to the whole selection.
      onValueChange={(picked) => {
        const option = props.options.find(({ value }) => String(value) === (picked || String(props.value)));
        if (option) props.onPick(option.value);
      }}
      spacing={1}
      className="w-full rounded-md bg-dp-field p-0.5"
    >
      {props.options.map(({ value, text }) => (
        <ToggleGroupItem
          key={value}
          value={String(value)}
          onMouseDown={keepCanvasFocus}
          variant="choice"
          size="xs"
          className="flex-1"
        >
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
