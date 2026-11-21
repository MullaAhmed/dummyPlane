import { useGrace } from "@/components/EmptyState";
import { useWorkWindowPlace } from "./lane";
import { LANE_TOP } from "./layout";

/** The bars' widths, a few rows of different lengths: a list, then a page. Static: nothing here moves. */
const TREE = ["w-3/5", "w-4/5", "w-2/5", "w-3/4", "w-1/2", "w-2/3"];
const PAGE = ["w-1/3", "w-full", "w-11/12", "w-4/5", "w-full", "w-3/5", "w-5/6"];

function Bars({ widths }: { widths: string[] }) {
  return widths.map((width, i) => <span key={i} className={`h-3 rounded-sm bg-dp-hover ${width}`} />);
}

/**
 * What stands where a lazy workspace (Code Studio, Notes) will be until it arrives: the workspace's own frame, a list and
 * a page, with quiet bars for their rows, instead of the bare canvas ground. It waits `GRACE_MS` before it draws, so a
 * module already loaded shows nothing, and it does not animate (the dot is the one thing that does).
 */
export function PanelSkeleton({ label }: { label: string }) {
  const late = useGrace();
  // The workspace's own frame (shell/layout.ts): under the bars, left of the activity rail or of an occupied lane.
  const place = useWorkWindowPlace();
  return (
    <div role="status" aria-label={label} aria-busy="true" className="absolute inset-0 flex gap-3 pb-3 pl-3" style={{ paddingTop: LANE_TOP, paddingRight: place.right }}>
      {late && (
        <>
          <div aria-hidden className="dp-glass-strong flex w-60 shrink-0 flex-col gap-3 rounded-xl p-4">
            <Bars widths={TREE} />
          </div>
          <div aria-hidden className="dp-glass-strong flex min-w-0 flex-1 flex-col gap-3 rounded-xl p-6">
            <Bars widths={PAGE} />
          </div>
        </>
      )}
    </div>
  );
}
