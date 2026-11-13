import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The IPC contract between Rust and the interface: every command registered in src-tauri/src/lib.rs has a TS call of
// its name, every TS call names a registered command, and the arguments sent are the command's own, by their camelCase
// names, a required one never missing. What cannot be read fails, naming it: a contract that cannot be checked is no pass.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Tauri passes these itself: the interface never sends them. A `Channel` is sent, by its name, like any argument. */
const INJECTED = /^&?(?:tauri::)?(?:State|AppHandle|Window|WebviewWindow|Webview)\b/;
/** The raw request: its body is bytes, not named arguments (`save_pasted_image`). */
const RAW_REQUEST = /^(?:tauri::ipc::)?Request\b/;
/** The wrapper itself forwards a command it is given. */
const WRAPPER = "src/ipc/invoke.ts";

const camel = (name) => name.replace(/^_+/, "").replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** `text` split at commas outside brackets and strings; `<>` count as brackets in Rust only (TS has `=>` and `>`). */
function splitTop(text, angles = false) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let part = "";
  for (const ch of text) {
    if (quote) quote = ch === quote ? null : quote;
    else if (ch === '"' || ch === "`") quote = ch;
    else if ("([{".includes(ch) || (angles && ch === "<")) depth++;
    else if (")]}".includes(ch) || (angles && ch === ">")) depth--;
    if (ch === "," && depth === 0 && !quote) {
      parts.push(part.trim());
      part = "";
    } else part += ch;
  }
  if (part.trim()) parts.push(part.trim());
  return parts;
}

/** The text from the bracket at `start` to the one that closes it, both included. */
function balanced(text, start) {
  const open = text[start];
  const close = { "(": ")", "{": "}", "<": ">" }[open];
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** The registered commands, each with the arguments its Rust signature takes; what cannot be read is a problem. */
function rustCommands({ lib, rust }, problems) {
  const at = lib.indexOf("generate_handler![");
  if (at < 0) return problems.push("src-tauri/src/lib.rs: no generate_handler![…] to read"), new Map();
  const list = lib.slice(at + "generate_handler![".length, lib.indexOf("]", at));
  const commands = new Map();
  for (const path of list.split(",").map((p) => p.trim()).filter(Boolean)) {
    const segments = path.split("::");
    const name = segments.at(-1);
    const module = segments.slice(0, -1).join("/");
    const files = module ? [`src-tauri/src/${module}.rs`, `src-tauri/src/${module}/mod.rs`] : ["src-tauri/src/lib.rs"];
    const file = files.find((f) => rust[f]?.includes(`fn ${name}`));
    const src = file ? rust[file] : null;
    const m = src ? new RegExp(`#\\[tauri::command(\\([^\\]]*\\))?\\]\\s*(?:#\\[[^\\]]*\\]\\s*)*pub\\s+(?:async\\s+)?fn\\s+${name}\\s*(?:<[^>]*>)?\\s*\\(`).exec(src) : null;
    if (!m) {
      problems.push(`${path}: registered, but no #[tauri::command] fn ${name} in ${files.join(" or ")}`);
      continue;
    }
    const params = balanced(src, m.index + m[0].length - 1)?.slice(1, -1) ?? "";
    const keepSnake = /rename_all\s*=\s*"snake_case"/.test(m[1] ?? "");
    const args = [];
    let raw = false;
    for (const param of splitTop(params, true)) {
      const p = /^(?:mut\s+)?(\w+)\s*:\s*([\s\S]+)$/.exec(param);
      if (!p) {
        problems.push(`${path}: cannot read its parameter "${param}" (${file})`);
        continue;
      }
      if (INJECTED.test(p[2])) continue;
      if (RAW_REQUEST.test(p[2])) raw = true;
      else args.push({ key: keepSnake ? p[1] : camel(p[1]), optional: /^Option\s*</.test(p[2]) });
    }
    commands.set(name, { path, file, args, raw });
  }
  return commands;
}

/** Each TS call of a command: its name, where, and the keys of each argument object it may send (null: unreadable). */
function tsCalls({ ts }, problems) {
  const calls = [];
  for (const [file, src] of Object.entries(ts)) {
    if (file === WRAPPER) continue;
    // The names `call` (from the wrapper) and `invoke` (from Tauri) are bound to in this file, aliases included.
    const names = [];
    for (const im of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(@\/ipc\/invoke|\.\/invoke|@tauri-apps\/api\/core)"/g)) {
      for (const item of im[1].split(",")) {
        const [orig, alias] = item.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
        if ((orig === "call" && !im[2].startsWith("@tauri")) || (orig === "invoke" && im[2].startsWith("@tauri"))) names.push(alias ?? orig);
      }
    }
    if (!names.length) continue;
    const re = new RegExp(`(?<![\\w.$])(${names.join("|")})\\s*(?=[<(])`, "g");
    for (const m of src.matchAll(re)) {
      let i = m.index + m[0].length;
      if (src[i] === "<") i += balanced(src, i)?.length ?? 0;
      while (/\s/.test(src[i])) i++;
      const line = src.slice(0, m.index).split("\n").length;
      const where = `${file}:${line}`;
      const inner = src[i] === "(" ? balanced(src, i)?.slice(1, -1) : null;
      if (inner === null || inner === undefined) continue; // a mention, not a call
      const [first, second] = splitTop(inner);
      const name = /^"([^"]+)"$/.exec(first ?? "")?.[1];
      if (!name) {
        problems.push(`${where}: cannot read the command name ${first ?? "(none)"}: name it with a string literal`);
        continue;
      }
      if (name.startsWith("plugin:")) continue; // a Tauri plugin's, not lib.rs's
      calls.push({ name, where, shapes: argumentShapes(second) });
    }
  }
  return calls;
}

/** The two objects of `cond ? { … } : { … }`, or null. */
function ternaryObjects(expr) {
  const t = /^[^?{]+\?\s*(\{[\s\S]*\})\s*:\s*(\{[\s\S]*\})$/.exec(expr.trim());
  return t ? [t[1].trim(), t[2].trim()] : null;
}

/**
 * The key sets an object literal may send, one per way its conditional spreads (`...(cond ? { a } : {})`) can go;
 * null when it is no object literal or holds anything else it cannot read.
 */
function keySets(obj) {
  if (!obj.startsWith("{") || balanced(obj, 0)?.length !== obj.length) return null;
  let sets = [[]];
  for (const entry of splitTop(obj.slice(1, -1))) {
    if (entry.startsWith("...")) {
      const branches = ternaryObjects(entry.slice(3).trim().replace(/^\(([\s\S]*)\)$/, "$1"))?.map(keySets);
      if (!branches || branches.some((b) => b === null)) return null;
      sets = sets.flatMap((set) => branches.flat().map((branch) => [...set, ...branch]));
      continue;
    }
    const k = /^["']?([A-Za-z_$][\w$]*)["']?\s*(?::|$)/.exec(entry);
    if (!k) return null;
    sets = sets.map((set) => [...set, k[1]]);
  }
  return sets;
}

/** The key sets an argument expression may send: none, an object literal, or the objects of a ternary; null when unreadable. */
function argumentShapes(expr) {
  if (expr === undefined) return [[]];
  const whole = keySets(expr.trim());
  if (whole) return whole;
  const branches = ternaryObjects(expr)?.map(keySets);
  return branches && branches.every((b) => b !== null) ? branches.flat() : null;
}

/** Every way `sources` breaks the contract, as plain sentences; empty when it holds. */
export function checkIpcContract(sources) {
  return readContract(sources).problems;
}

/** The commands and calls read, and the problems found. */
function readContract(sources) {
  const problems = [];
  const commands = rustCommands(sources, problems);
  const calls = tsCalls(sources, problems);
  for (const call of calls) {
    const command = commands.get(call.name);
    if (!command) {
      problems.push(`${call.where}: calls "${call.name}", which lib.rs does not register`);
      continue;
    }
    if (command.raw) continue;
    if (!call.shapes) {
      problems.push(`${call.where}: cannot read the arguments of "${call.name}": pass an object literal (or a ternary of two)`);
      continue;
    }
    for (const keys of call.shapes) {
      for (const arg of command.args) {
        if (!arg.optional && !keys.includes(arg.key)) problems.push(`${call.where}: "${call.name}" needs "${arg.key}", not sent (sends ${JSON.stringify(keys)})`);
      }
      for (const key of keys) {
        if (!command.args.some((arg) => arg.key === key)) problems.push(`${call.where}: "${call.name}" takes no "${key}" (takes ${JSON.stringify(command.args.map((a) => a.key))})`);
      }
    }
  }
  for (const [name, command] of commands) {
    if (!calls.some((call) => call.name === name)) problems.push(`${command.path}: registered, but no TS call of "${name}"`);
  }
  return { problems, commands, calls };
}

function readTree(dir, keep, out = {}) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) readTree(rel, keep, out);
    else if (keep(entry.name)) out[rel] = readFileSync(join(ROOT, rel), "utf8");
  }
  return out;
}

describe("the IPC contract", () => {
  it("holds between the commands lib.rs registers and the interface's calls", () => {
    const rust = readTree("src-tauri/src", (n) => n.endsWith(".rs"));
    const ts = readTree("src", (n) => /\.tsx?$/.test(n) && !/\.test\.|testkit/.test(n));
    const { problems, commands, calls } = readContract({ lib: rust["src-tauri/src/lib.rs"], rust, ts });
    expect(problems).toEqual([]);
    // It read the registry and the calls at all: an empty pass would prove nothing.
    expect(commands.size).toBeGreaterThan(50);
    expect(calls.length).toBeGreaterThanOrEqual(commands.size);
  });

  const lib = "tauri::generate_handler![commands::pty::pty_write, commands::pty::pty_kill]";
  const rust = {
    "src-tauri/src/commands/pty.rs": `
#[tauri::command]
pub async fn pty_write(pty: State<'_, PtyManager>, node_id: String, data: String, extra: Option<u32>) -> AppResult<()> { Ok(()) }
#[tauri::command]
pub async fn pty_kill(pty: State<'_, PtyManager>, node_id: String) -> AppResult<()> { Ok(()) }`,
  };
  const ts = (body) => ({ "src/ipc/pty.ts": `import { call } from "./invoke";\n${body}` });
  const write = 'export const w = (nodeId: string, data: string) => call<void>("pty_write", { nodeId, data });';
  const kill = 'export const k = (nodeId: string) => call<void>("pty_kill", { nodeId });';

  it("takes the fixture whole, an Option left out", () => {
    expect(checkIpcContract({ lib, rust, ts: ts(`${write}\n${kill}`) })).toEqual([]);
  });

  it("fails a wrong argument key, saying which", () => {
    const wrong = 'export const w = (nodeID: string, data: string) => call<void>("pty_write", { nodeID, data });';
    expect(checkIpcContract({ lib, rust, ts: ts(`${wrong}\n${kill}`) })).toEqual([
      'src/ipc/pty.ts:2: "pty_write" needs "nodeId", not sent (sends ["nodeID","data"])',
      'src/ipc/pty.ts:2: "pty_write" takes no "nodeID" (takes ["nodeId","data","extra"])',
    ]);
  });

  it("fails a registered command the interface never calls, and one whose fn is gone", () => {
    expect(checkIpcContract({ lib, rust, ts: ts(write) })).toEqual(['commands::pty::pty_kill: registered, but no TS call of "pty_kill"']);
    const gone = { "src-tauri/src/commands/pty.rs": rust["src-tauri/src/commands/pty.rs"].replace("fn pty_kill", "fn pty_end") };
    expect(checkIpcContract({ lib, rust: gone, ts: ts(`${write}\n${kill}`) })).toContain(
      "commands::pty::pty_kill: registered, but no #[tauri::command] fn pty_kill in src-tauri/src/commands/pty.rs or src-tauri/src/commands/pty/mod.rs",
    );
  });

  it("fails a call of a command lib.rs does not register", () => {
    expect(checkIpcContract({ lib, rust, ts: ts(`${write}\n${kill}\nexport const g = () => call<void>("pty_ghost", {});`) })).toEqual([
      'src/ipc/pty.ts:4: calls "pty_ghost", which lib.rs does not register',
    ]);
  });

  it("fails what it cannot read rather than pass it: a spread, an argument variable, a computed name", () => {
    const opaque = [
      'export const a = (o: object) => call<void>("pty_write", { ...o });',
      'export const b = (o: object) => call<void>("pty_kill", o);',
      'export const c = (name: string) => call<void>(name, {});',
    ].join("\n");
    expect(checkIpcContract({ lib, rust, ts: ts(opaque) })).toEqual([
      "src/ipc/pty.ts:4: cannot read the command name name: name it with a string literal",
      'src/ipc/pty.ts:2: cannot read the arguments of "pty_write": pass an object literal (or a ternary of two)',
      'src/ipc/pty.ts:3: cannot read the arguments of "pty_kill": pass an object literal (or a ternary of two)',
    ]);
  });

  it("reads both objects of a ternary, and leaves a member .call() and a plugin's command alone", () => {
    const both = [
      'export const w = (nodeId: string, data: string, x?: number) => call<void>("pty_write", x ? { nodeId, data, extra: x } : { nodeId, data });',
      kill,
      "export const s = (v: unknown) => Object.prototype.toString.call(v);",
    ].join("\n");
    expect(checkIpcContract({ lib, rust, ts: ts(both) })).toEqual([]);
    const broken = both.replace("{ nodeId, data }", "{ nodeId }");
    expect(checkIpcContract({ lib, rust, ts: ts(broken) })).toEqual(['src/ipc/pty.ts:2: "pty_write" needs "data", not sent (sends ["nodeId"])']);
    // A conditional spread is read both ways; a key in either way is checked.
    const spread = 'export const w = (nodeId: string, data: string, x?: number) => call<void>("pty_write", { nodeId, data, ...(x ? { extra: x } : {}) });';
    expect(checkIpcContract({ lib, rust, ts: ts(`${spread}\n${kill}`) })).toEqual([]);
    expect(checkIpcContract({ lib, rust, ts: ts(`${spread.replace("{ extra: x }", "{ extras: x }")}\n${kill}`) })).toEqual([
      'src/ipc/pty.ts:2: "pty_write" takes no "extras" (takes ["nodeId","data","extra"])',
    ]);
    const plugin = { "src/app/log.ts": 'import { invoke } from "@tauri-apps/api/core";\nconst send = () => invoke<void>("plugin:log|log", { level: 1 });' };
    expect(checkIpcContract({ lib, rust, ts: { ...ts(`${write}\n${kill}`), ...plugin } })).toEqual([]);
  });
});
