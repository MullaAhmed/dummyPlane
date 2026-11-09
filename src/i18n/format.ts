/** "67.8" */
export function formatDecimal(value: number, digits: number): string {
  return value.toFixed(digits);
}

/** A shortcut as the interface shows it: "Ctrl+Shift+P". */
export function keyLabel(keys: string): string {
  return keys;
}

/** "03:50" today, "Mon 08:00" another day within a week, "9 Nov 08:00" beyond, in 24-hour time. */
export function formatClock(ms: number, now: number): string {
  const locale = "en-GB";
  const date = new Date(ms);
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === new Date(now).toDateString()) return time;
  // Past six days the weekday would be taken for the coming one: the date says which.
  const far = Math.abs(ms - now) > 6 * 24 * 3_600_000;
  return `${date.toLocaleDateString(locale, far ? { day: "numeric", month: "short" } : { weekday: "short" })} ${time}`;
}
