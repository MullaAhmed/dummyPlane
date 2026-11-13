/** Windows path compare key: case-insensitive, either separator, no trailing one. */
function pathKey(path: string): string {
  return normalizePath(path).replace(/\//g, "\\").toLowerCase();
}

/** Trims spaces and trailing separators, keeping a drive root ("D:\") intact. */
function normalizePath(path: string): string {
  const trimmed = path.trim();
  const bare = trimmed.replace(/[\\/]+$/, "");
  return bare === "" || bare.endsWith(":") ? trimmed : bare;
}

/**
 * `path` moved from the folder `from` to `to` ("C:\api\web" from "C:\api" to
 * "D:\api" gives "D:\api\web"); null when `path` is not inside `from`. Mirrors
 * Rust's `projects::rebase_path`, which rewrites the saved terminals.
 */
export function rebasePath(path: string, from: string, to: string): string | null {
  // A drive root keeps its separator (`d:\`): the folder is what comes before it.
  const key = pathKey(path).replace(/\\+$/, "");
  const fromKey = pathKey(from).replace(/\\+$/, "");
  const target = normalizePath(to);
  if (key === fromKey) return target;
  if (!key.startsWith(`${fromKey}\\`)) return null;
  // The rest of the path keeps its own case: it starts after the folder's separators, never at a length, which
  // lowercasing may change ("İ" lowercases to two characters).
  const depth = fromKey.split("\\").length;
  const rest = normalizePath(path).replace(/\//g, "\\").split("\\").slice(depth).join("\\");
  return `${target.replace(/[\\/]+$/, "")}\\${rest}`;
}
