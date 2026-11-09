import type { MouseEvent, ReactNode } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Copy, Trash2 } from "lucide-react";
import { useTheme } from "@/app/theme";
import { cn } from "@/lib/utils";
import { PEN_COLORS } from "@/theme/penColors";
import { displayColorFor } from "@/theme/sceneColors";
import { canvasStore, useCanvas } from "./canvasStore";
import { deleteSelection, duplicateSelection, restyleSelection, type Restyle } from "./drawnSelection";

// Short English labels: the panel is a local, English-only control (no shared message keys).
const LABEL = {
  stroke: "Stroke",
  background: "Background",
  transparent: "Transparent",
  duplicate: "Duplicate",
  delete: "Delete",
};

const TRANSPARENT = "transparent";
const COLOR_NAMES = ["Ink", "Terracotta", "Olive", "Ochre", "Red", "Sky", "Lavender", "Slate"];
const SWATCHES = PEN_COLORS.map(({ scene }, i) => ({ scene, name: COLOR_NAMES[i] }));
const BACKGROUNDS = [{ scene: TRANSPARENT, name: LABEL.transparent }, ...SWATCHES];

/** A click must not take the keyboard off the canvas: Delete and Escape keep working after it. */
const keepCanvasFocus = (event: MouseEvent) => event.preventDefault();

/**
 * The small panel that replaces Excalidraw's properties panel for drawn
 * elements: stroke colour, background colour, Duplicate and Delete. It shows
 * when the selection holds a drawn element, not in reading mode.
 */
export function SelectionPanel() {
  const drawn = useCanvas((s) => s.drawnSelection);
  const readOnly = useCanvas((s) => s.view.mode === "reading");
  const theme = useTheme();
  if (drawn.length === 0 || readOnly) return null;

  // The first element shows the colours in force; a change applies to all of them.
  const { strokeColor, backgroundColor } = drawn[0];
  const apply = (patch: Restyle) =>
    withApi((api) =>
      api.updateScene({
        elements: restyleSelection(api.getSceneElementsIncludingDeleted(), api.getAppState().selectedElementIds, patch),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      }),
    );

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
    <div className="dp-glass-strong absolute left-[70px] top-1/2 z-10 w-56 -translate-y-1/2 rounded-lg p-3">
      <Row label={LABEL.stroke}>
        {SWATCHES.map(({ scene, name }) => (
          <Swatch
            key={scene}
            name={`${LABEL.stroke}: ${name}`}
            color={displayColorFor(scene, theme)}
            active={scene === strokeColor}
            onPick={() => apply({ strokeColor: scene })}
          />
        ))}
      </Row>
      <Row label={LABEL.background}>
        {BACKGROUNDS.map(({ scene, name }) => (
          <Swatch
            key={scene}
            name={`${LABEL.background}: ${name}`}
            color={scene === TRANSPARENT ? null : displayColorFor(scene, theme)}
            active={scene === backgroundColor}
            onPick={() => apply({ backgroundColor: scene })}
          />
        ))}
      </Row>
      <div className="flex gap-1.5">
        <ActionButton icon={<Copy className="size-3.5" />} label={LABEL.duplicate} onClick={duplicate} />
        <ActionButton icon={<Trash2 className="size-3.5" />} label={LABEL.delete} onClick={remove} />
      </div>
    </div>
  );
}

function withApi(run: (api: ExcalidrawImperativeAPI) => void) {
  const api = canvasStore.getState().api;
  if (api) run(api);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
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
