const MAX_CHARS = 120;
const FORBIDDEN = /[/\\:*?"<>|[\]#^\p{Cc}]/u;
// As `studio::is_device_name`: the ports include COM¹ to COM³, and the console has its own.
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|(com|lpt)[0-9¹²³])$/i;

/** Mirrors `notes.rs`, so the field can say it before the disk refuses. */
export function isNoteName(name: string): boolean {
  if (name.trim() === "" || [...name].length > MAX_CHARS || FORBIDDEN.test(name)) return false;
  if (name.startsWith(".") || /[. ]$/.test(name)) return false;
  // Windows ignores the spaces before the first dot: `con .x` is `con`.
  return !RESERVED.test(name.split(".")[0].replace(/ +$/, ""));
}
