/**
 * OpenVibe's mark: the pixel symbol of the logo pack (docs/assets/brand/logo-icon-*.svg),
 * drawn inline in `currentColor` so it follows the surrounding text colour on any theme.
 * The symbol is 20x28; it is padded to a square so `size` is a square box.
 */
const PIXELS: [number, number][] = [
  [16, 25], [16, 29],
  [4, 33], [8, 33], [12, 33], [16, 33],
  [0, 37], [16, 37],
  [0, 41], [16, 41],
  [0, 45], [16, 45],
  [4, 49], [8, 49], [12, 49], [16, 49],
];

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-4 25 28 28" aria-hidden className="pointer-events-none shrink-0">
      {PIXELS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" fill="currentColor" />
      ))}
    </svg>
  );
}
