import type { ReactNode } from "react";

/** A key, drawn as a small keycap: how the field's shortcuts are shown instead of being spelled out. */
export function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd
      data-slot="kbd"
      className="inline-grid h-5 min-w-5 place-items-center rounded-sm border border-dp-line bg-dp-field px-1 font-mono text-xs leading-none text-dp-text-2"
    >
      {children}
    </kbd>
  );
}
