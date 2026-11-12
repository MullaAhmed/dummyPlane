/**
 * The names a menu shows for fleets in canvas order: a name that two fleets or more share gets its rank
 * ("Fleet #1", "Fleet #2"), or the list would offer the same word several times, each a different fleet.
 */
export function labelFleets(names: readonly string[], numbered: (name: string, rank: number) => string): string[] {
  const total = new Map<string, number>();
  for (const name of names) total.set(name, (total.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((name) => {
    if ((total.get(name) ?? 0) < 2) return name;
    const rank = (seen.get(name) ?? 0) + 1;
    seen.set(name, rank);
    return numbered(name, rank);
  });
}
