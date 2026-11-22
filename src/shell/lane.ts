import { useEffect, useLayoutEffect, useState } from "react";
import { createStore, useStore } from "zustand";
import { gitWindowStore } from "@/git/gitWindowStore";
import { reviewStore } from "@/review/reviewStore";
import { coversCorner, workArea, workWindowPlace, type Insets, type WorkWindowPlace } from "./layout";

/*
 * Who stands in the right lane now (shell/layout.ts): the Agents panel, its one occupant. It says so while it is
 * mounted, so the lane is reserved only while it is on screen; the work area then ends at its left edge.
 */

export const laneStore = createStore<{ occupants: readonly string[] }>()(() => ({ occupants: [] }));

/** `name` stands in the lane while this is mounted. */
export function useLaneOccupant(name: string) {
  useLayoutEffect(() => {
    laneStore.setState((s) => ({ occupants: [...s.occupants, name] }));
    return () => {
      laneStore.setState((s) => {
        const at = s.occupants.indexOf(name);
        return { occupants: at < 0 ? s.occupants : [...s.occupants.slice(0, at), ...s.occupants.slice(at + 1)] };
      });
    };
  }, [name]);
}

/** Whether the lane has an occupant, read outside React (the camera, placement). */
export function laneOccupied(): boolean {
  return laneStore.getState().occupants.length > 0;
}

/** Whether the lane has an occupant. */
export function useLaneOccupied(): boolean {
  return useStore(laneStore, (s) => s.occupants.length > 0);
}

/** The work area as it is now: the lane counts while it has an occupant. */
export function currentWorkArea(): Insets {
  return workArea(laneOccupied());
}

/** The window's width, followed as it changes. */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const read = () => setWidth(window.innerWidth);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return width;
}

/** Where a work window (review, git) and the Code and Notes workspaces stand: beside an occupied lane where they fit. */
export function useWorkWindowPlace(): WorkWindowPlace {
  return workWindowPlace(useWindowWidth(), useLaneOccupied());
}

/**
 * Whether an open work window (review, git) covers the corner's column, where the loops pill and the waiting notice
 * stand under it: they are then inert, so the keyboard never reaches a button nobody can see.
 */
export function useCornerCovered(): boolean {
  const width = useWindowWidth();
  const occupied = useLaneOccupied();
  const review = useStore(reviewStore, (s) => s.nodeId !== null);
  const git = useStore(gitWindowStore, (s) => s.path !== null);
  return (review || git) && coversCorner(width, workWindowPlace(width, occupied));
}
