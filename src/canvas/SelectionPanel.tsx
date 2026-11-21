import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { CaptureUpdateAction, mutateElement } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Copy, Trash2 } from "lucide-react";
import { useTheme } from "@/app/theme";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { LANE_BOTTOM, LANE_RIGHT, LANE_TOP } from "@/shell/layout";
import { useLaneOccupant } from "@/shell/lane";
import { useNodes } from "@/store/nodes";
import { PEN_COLORS } from "@/theme/penColors";
import { displayColorFor } from "@/theme/sceneColors";
import { canvasStore, useCanvas } from "./canvasStore";
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
import { foldEditPanel, takeKeyboardOpen, useEditPanel } from "./editPanel";
import { canvasMessages } from "./messages";
import { keepCanvasFocus, PanelAction } from "./PanelAction";
import { selectedEditId, TerminalEdit } from "./TerminalEdit";

const TRANSPARENT = "transparent";
/** Excalidraw's roughness 0, 1 and 2: its architect, artist and cartoonist. */
const SLOPPINESS = ["clean", "sketchy", "rough"] as const;
const ROUGHNESS_LEVELS: readonly Roughness[] = [0, 1, 2];
const ARROW_TYPES: readonly ArrowType[] = ["sharp", "round", "elbow"];

/** The open Edit panel's place: in the right lane (shell/layout.ts), on its edge, under the bars, above the command band. */
const IN_LANE: CSSProperties = { right: LANE_RIGHT, top: LANE_TOP, maxHeight: `calc(100% - ${LANE_TOP + LANE_BOTTOM}px)` };

/**
 * The small panel that replaces Excalidraw's properties panel. A drawn element
 * gets its stroke and background colours, Duplicate and Delete, and a line or
 * an arrow also its sloppiness (and an arrow its type), at the canvas's left
 * edge. A terminal's or a Fleet's Edit, in its header (nodes/terminal/EditButton.tsx),
 * selects it alone and opens its edit panel (TerminalEdit) in the right lane, where
 * it covers no node: the lane's one occupant, in the Agents panel's place
 * (agents/panelFold.ts). It folds from its chevron or that Edit, and when another
 * selection comes: an open panel never stands in the lane unasked. Nothing shows
 * beside a node selected alone: its Edit is in its header. It does not show in
 * reading mode.
 */
export function SelectionPanel() {
  const drawn = useCanvas((s) => s.drawnSelection);
  const readOnly = useCanvas((s) => s.view.mode === "reading");
  const selectedIds = useCanvas((s) => s.view.selectedIds);
  // The terminal or Fleet selected alone: the one with an edit panel (the names below say terminal, as the code does).
  const terminalId = useNodes((s) => selectedEditId(selectedIds, s.nodes));
  // The node whose panel was opened from its header's Edit; selecting another, or none, folds it. So does reading mode, which
  // hides it, and the canvas's going: the lane is free again.
  const openFor = useEditPanel();
  useEffect(() => {
    if (openFor !== null && (openFor !== terminalId || readOnly)) foldEditPanel();
  }, [openFor, terminalId, readOnly]);
  useEffect(() => () => foldEditPanel(), []);
  const open = terminalId !== null && openFor === terminalId;
  // Shown, it holds the lane: the work area, the work windows and the camera keep clear of it.
  useLaneOccupant("edit", open && !readOnly);
  // The header's Edit and the panel hand the keyboard to each other (P2 #1).
  const panelRef = useRef<HTMLDivElement>(null);
  const foldingFrom = useKeyboardHandOff(open, terminalId, panelRef);
  // A node selected alone shows nothing here until its Edit opens the panel.
  if ((drawn.length === 0 && !terminalId) || readOnly || (terminalId && !open)) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        "dp-glass-strong absolute rounded-lg p-3",
        // A terminal's panel (PANEL_WIDTH, the lane's width) keeps its title and tabs in place and scrolls the page under them;
        // a drawing's is one native scroller. Either way bounded by a max-height only, which a ScrollArea's viewport cannot follow.
        // The terminal's stands in the lane, on the lane's layer; a drawing's on the canvas's, at its left edge.
        terminalId ? "z-30 flex w-84 flex-col overflow-hidden" : "z-10 w-56 overflow-y-auto",
        // Opened from its header's Edit, into the lane: it eases in (opacity and a 4 px slide from the lane's edge); folding is instant.
        terminalId && "animate-in fade-in-0 slide-in-from-right-1 duration-(--dp-dur) ease-(--dp-ease-out) motion-reduce:animate-none",
        !terminalId && "left-[70px] top-1/2 max-h-[calc(100%-120px)] -translate-y-1/2",
      )}
      style={terminalId ? IN_LANE : undefined}
    >
      {terminalId && (
        <TerminalEdit
          nodeId={terminalId}
          onFold={() => {
            foldingFrom();
            foldEditPanel();
          }}
        />
      )}
      {drawn.length > 0 && <DrawnControls drawn={drawn} />}
    </div>
  );
}

/** A node's Edit in its header (nodes/terminal/EditButton.tsx): what opens its panel, and where the keyboard goes back. */
const editButtonOf = (nodeId: string) => document.querySelector<HTMLElement>(`[data-edit-node="${nodeId}"]`);

/**
 * Where the keyboard goes when the header's Edit opens the panel or the panel folds back. Opened from the keyboard
 * (Enter or Space on that Edit), the panel gives it to its fold chevron, the control that folds it, as a
 * disclosure's button keeps it; a press leaves the keyboard where it was. Folded from its chevron with the keyboard
 * in it, the panel hands it back to the header's Edit; a panel folded by a new selection leaves it alone. Without
 * this, it fell to the page's body. Returns what the panel calls as it folds itself.
 */
function useKeyboardHandOff(open: boolean, nodeId: string | null, panelRef: RefObject<HTMLDivElement | null>) {
  const back = useRef(false);
  useLayoutEffect(() => {
    if (open && takeKeyboardOpen()) panelRef.current?.querySelector<HTMLElement>("[data-fold]")?.focus({ preventScroll: true });
    if (!open && back.current && nodeId) editButtonOf(nodeId)?.focus({ preventScroll: true });
    back.current = false;
  }, [open, nodeId, panelRef]);
  return () => {
    const active = document.activeElement;
    back.current = active !== null && (panelRef.current?.contains(active) ?? false);
  };
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
