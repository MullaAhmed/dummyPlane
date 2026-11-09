import type { MouseEvent, ReactNode } from "react";
import { CaptureUpdateAction, mutateElement } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Copy, Trash2 } from "lucide-react";
import { useTheme } from "@/app/theme";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
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
import { canvasMessages } from "./messages";
import { selectedTerminalId, TerminalEdit } from "./TerminalEdit";

const TRANSPARENT = "transparent";
/** Excalidraw's roughness 0, 1 and 2: its architect, artist and cartoonist. */
const SLOPPINESS = ["clean", "sketchy", "rough"] as const;
const ROUGHNESS_LEVELS: readonly Roughness[] = [0, 1, 2];
const ARROW_TYPES: readonly ArrowType[] = ["sharp", "round", "elbow"];

/** A click must not take the keyboard off the canvas: Delete and Escape keep working after it. */
const keepCanvasFocus = (event: MouseEvent) => event.preventDefault();

/**
 * The small panel that replaces Excalidraw's properties panel. A drawn element
 * gets its stroke and background colours, Duplicate and Delete, and a line or
 * an arrow also its sloppiness (and an arrow its type). A terminal selected
 * alone gets a short Edit section. It does not show in reading mode.
 */
export function SelectionPanel() {
  const drawn = useCanvas((s) => s.drawnSelection);
  const readOnly = useCanvas((s) => s.view.mode === "reading");
  const selectedIds = useCanvas((s) => s.view.selectedIds);
  const terminalId = useNodes((s) => selectedTerminalId(selectedIds, s.nodes));
  if ((drawn.length === 0 && !terminalId) || readOnly) return null;

  return (
    <div className="dp-glass-strong absolute left-[70px] top-1/2 z-10 max-h-[calc(100%-120px)] w-56 -translate-y-1/2 overflow-y-auto rounded-lg p-3">
      {terminalId && <TerminalEdit nodeId={terminalId} />}
      {drawn.length > 0 && <DrawnControls drawn={drawn} />}
    </div>
  );
}

function DrawnControls({ drawn }: { drawn: ExcalidrawElement[] }) {
  const t = useMessages(canvasMessages).selection;
  const theme = useTheme();
  const swatches = PEN_COLORS.map(({ scene }, i) => ({ scene, name: t.colorNames[i] }));
  const backgrounds = [{ scene: TRANSPARENT, name: t.transparent }, ...swatches];

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
        {swatches.map(({ scene, name }) => (
          <Swatch
            key={scene}
            name={`${t.stroke}: ${name}`}
            color={displayColorFor(scene, theme)}
            active={scene === strokeColor}
            onPick={() => apply({ strokeColor: scene })}
          />
        ))}
      </Row>
      <Row label={t.background}>
        {backgrounds.map(({ scene, name }) => (
          <Swatch
            key={scene}
            name={`${t.background}: ${name}`}
            color={scene === TRANSPARENT ? null : displayColorFor(scene, theme)}
            active={scene === backgroundColor}
            onPick={() => apply({ backgroundColor: scene })}
          />
        ))}
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
        <ActionButton icon={<Copy className="size-3.5" />} label={t.duplicate} onClick={duplicate} />
        <ActionButton icon={<Trash2 className="size-3.5" />} label={t.delete} onClick={remove} />
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
    <div>
      <p className="dp-label mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Swatch({ name, color, active, onPick }: { name: string; color: string | null; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={active}
      onMouseDown={keepCanvasFocus}
      onClick={onPick}
      className={cn(
        "size-6 rounded-full ring-offset-2 ring-offset-dp-surface outline-none transition-[transform,box-shadow] duration-150 ease-out motion-reduce:transition-none active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-dp-accent/50",
        color === null ? "border border-dashed border-dp-line" : "border border-dp-line/60",
        active ? "ring-2 ring-dp-accent" : "hover:ring-1 hover:ring-dp-text-3",
      )}
      style={color === null ? undefined : { backgroundColor: color }}
    />
  );
}

/** One choice out of a few, side by side: the chosen one is filled. */
function Segmented<V extends string | number>(props: {
  label: string;
  options: readonly { value: V; text: string }[];
  value: V;
  onPick: (value: V) => void;
}) {
  return (
    <div role="group" aria-label={props.label} className="flex w-full gap-1 rounded-md bg-dp-field p-0.5">
      {props.options.map(({ value, text }) => (
        <button
          key={value}
          type="button"
          aria-pressed={value === props.value}
          onMouseDown={keepCanvasFocus}
          onClick={() => props.onPick(value)}
          className={cn(
            "flex-1 rounded-md px-1.5 py-1 text-xs transition-[background-color,color,transform] duration-150 ease-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97]",
            value === props.value ? "bg-dp-accent-soft text-dp-text" : "text-dp-text-2 hover:bg-dp-hover hover:text-dp-text",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function ActionButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onMouseDown={keepCanvasFocus}
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent bg-dp-card py-1.5 text-xs text-dp-text-2 transition-[color,background-color,transform] duration-150 ease-out motion-reduce:transition-none hover:bg-dp-hover hover:text-dp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97]"
    >
      {icon}
      {label}
    </button>
  );
}
