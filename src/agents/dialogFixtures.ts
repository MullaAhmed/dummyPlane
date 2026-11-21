/**
 * Dialogs as their CLIs draw them, for the tests that read them (`./dialogScreen.test.ts`, `./parentControl.test.ts`,
 * `@/mcp/subAgentTools.test.ts`): captures of real screens, then a few drawn after them, marked so.
 */

export const RULE = "─".repeat(80);
export const DASHES = "╌".repeat(80);

/** Claude Code v2.1.322, a project's .mcp.json naming one server it has not seen (captured 12 Nov, wt-be-upload-land). */
export const MCP_ONE = [
  RULE,
  "  New MCP server found in this project: supabase",
  "",
  "  MCP servers may execute code or access system resources. All tool calls",
  "  require approval. Learn more in the MCP documentation.",
  "",
  "    Use this MCP server",
  "    Use this and all future MCP servers in this project",
  "  ❯ Continue without using this MCP server",
  "",
  "  Enter to confirm · Esc to cancel",
].join("\n");

/** The same, naming eight (captured 16 Nov, BOS-Mono backend). */
export const MCP_MANY = [
  RULE,
  " 8 new MCP servers found in this project",
  "",
  " Select any you wish to enable.",
  "",
  " MCP servers may execute code or access system resources. All tool calls require approval.",
  " Learn more in the MCP documentation.",
  "",
  " ❯ [✔] supabase",
  "   [✔] vercel",
  "   [✔] figma",
  "   [✔] sentry",
  " ↓ [✔] notion",
  "",
  " Enable selected",
  "",
  " Space to select · Esc to reject all",
].join("\n");

/** A team agent's permission request in an unattended session (captured 13 Nov, dummyindex, Cyborg 6), its turn above it. */
export const PERMISSION = [
  "  ⎿  $ rm -rf tempT11-bt tempT11-bt-red tempT11-bt2 tempT11-full && rm -f       ",
  "     D:tempT11-pytest.log && find . -maxdepth 1 -name 'D*' -o -maxdepth 1 -name ",
  "                                                                                ",
  RULE,
  " Bash command                                                                   ",
  " Stop background run and delete stray T11 artifacts in worktree                 ",
  DASHES,
  " │ rm -rf tempT11-bt tempT11-bt-red tempT11-bt2 tempT11-full && rm -f           ",
  " │ D:tempT11-pytest.log && find . -maxdepth 1 -name 'D*' -o -maxdepth 1 -name   ",
  " │ '*T11*' | head; git status --short                                           ",
  DASHES,
  " │ Dangerous rm operation on a Windows path this check cannot place:            ",
  " │ D:tempT11-pytest.log                                                         ",
  " ⚠  Claude Code will automatically block this request in 1:50, to avoid holding  ",
  " up an unattended session                                                       ",
  "",
  "                                                                                ",
  " Do you want to proceed?",
  " ❯ 1. Yes                                                                       ",
  "   2. No",
  "                                                                                ",
  " Esc to cancel · Tab to amend",
  `${"─".repeat(48)} Claude · ste100-docs-cyborg-6 ─`,
].join("\n");

export const TRUST = "Accessing workspace:\n\nQuick safety check: Is this a project you created or one you trust? If not, take a\nmoment to review what's in this folder first.\n\n❯ No, exit\n  Yes, I trust this folder\n\nEnter to confirm · Esc to cancel";
export const LOGIN = " Claude Code can be used with your Claude subscription or billed based on API usage through your Console account.\n\n Select login method:\n\n ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise\n   2. Anthropic Console account · API usage billing\n   3. 3rd-party platform · Amazon Bedrock, Microsoft Foundry, or Vertex AI";
/** Claude's prompt, up and idle. */
export const CLAUDE = " ▐▛███▜▌   Claude Code v2.1.304\n▝▜█████▛▘  Opus 5.5\n\n──────────────────────── Claude · demo ─\n❯ \n────────────────────────────────────────\n  ⏵⏵ auto mode on (shift+tab to cycle)";
/** Claude at work: its spinner names a key too, but is no dialog. */
export const WORKING = "● Reading the plan.\n\n✻ Thinking… (12s · esc to interrupt)\n\n──────────────────────── Claude · demo ─\n❯ \n────────────────────────────────────────";
/** A Manager that read a held teammate's screen: the dialog's words are in its turn, high above its own prompt. */
export const QUOTED = `● read_output(Thor)\n  ⎿  ${MCP_ONE.split("\n").join("\n     ")}\n\n● Thor waits on the MCP question.\n\n──────────────────────── Claude · boss ─\n❯ \n────────────────────────────────────────\n  ⏵⏵ auto mode on (shift+tab to cycle)`;
export const CODEX_TRUST =
  "  Folder access\n\n  D:\\temp\\spike\\repo\n\n  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings.\n\n› 1. Trust and continue\n  2. Back to Agent Command Center\n\n  enter continue · esc back";
export const CODEX = "  >_ OpenAI Codex (v0.167.0)\n\n› Ask Codex to do anything\n\n  gpt-5.6-luna medium · D:\\temp\\spike\\repo\n  ← for agents · ? for shortcuts";

/**
 * Drawn after PERMISSION, not captured: the permission request of an attended session, with Claude Code's option
 * that approves the command for good.
 */
export const PERMISSION_FOR_GOOD = [
  RULE,
  " Bash command",
  "",
  "   npm run build",
  "   Build the app",
  "",
  " Do you want to proceed?",
  " ❯ 1. Yes",
  "   2. Yes, and don't ask again for npm run build commands in D:/Projects/app",
  "   3. No, and tell Claude what to do differently (esc)",
  "",
  " Esc to cancel · Tab to amend",
].join("\n");

/** Drawn after PERMISSION, not captured: an edit's request, whose second option approves edits for the session. */
export const PERMISSION_EDITS = [
  RULE,
  " Edit file",
  " src/app.ts",
  "",
  " Do you want to make this edit to app.ts?",
  " ❯ 1. Yes",
  "   2. Yes, allow all edits during this session (shift+tab)",
  "   3. No, and tell Claude what to do differently (esc)",
  "",
  " Esc to cancel",
].join("\n");

/**
 * Drawn after PERMISSION, not captured: dummyPlane's delete guard asks (`src-tauri/src/agents/delete_guard.rs`), its
 * reason wrapped by the terminal's width in the middle of the marker.
 */
export const GUARDED = [
  RULE,
  " Bash command",
  " Remove the old build folder",
  DASHES,
  " │ rm -rf D:/temp/old-build",
  DASHES,
  " Hook PreToolUse:Bash requires confirmation for this command: [dummyPlane-",
  " guard] dummyPlane asks before a recursive delete that leaves the agent's own",
  " folder: this one removes D:/temp/old-build, which exists, outside its folder.",
  "",
  " Do you want to proceed?",
  " ❯ 1. Yes",
  "   2. No",
  "",
  " Esc to cancel · Tab to amend",
].join("\n");

/** Drawn, not captured: a question Claude Code asks before its session opens, about the user's own setup. */
export const API_KEY = [
  RULE,
  " Detected a custom API key in your environment",
  "",
  " ANTHROPIC_API_KEY: sk-ant-...xyz",
  "",
  " Do you want to use this API key?",
  "",
  " ❯ 1. Yes",
  "   2. No (recommended)",
  "",
  " Enter to confirm · Esc to cancel",
].join("\n");

/** Drawn after the labels in Claude Code v2.1's code, not captured: its plan to approve, a question that changes the permission mode. */
export const PLAN = [
  RULE,
  " Ready to code?",
  "",
  " Here is Claude's plan: add the login form.",
  "",
  " Would you like to proceed?",
  "",
  " ❯ 1. Yes, and use auto mode",
  "   2. Yes, and auto-accept edits",
  "   3. Yes, manually approve edits",
  "   4. No, keep planning",
  "",
  " Enter to select · Esc to cancel",
].join("\n");

/** Drawn, not captured: Claude's AskUserQuestion, whose last option opens a text box. */
export const QUESTION = [
  RULE,
  " ☐ Database",
  "",
  " Which database should the app use?",
  "",
  " ❯ 1. SQLite",
  "   2. Postgres",
  "   3. Type something.",
  "",
  " Enter to select · Esc to cancel",
].join("\n");

/**
 * Claude Code's status notice about a configured MCP server that needs login (captured in a dummyPlane scrollback,
 * node a43a5bab, Claude Code v2.1.x), drawn above Claude's idle prompt. A notice, not a dialog: it names no keys.
 */
export const MCP_AUTH_NOTICE = "⚠ 1 MCP server needs authentication · run /mcp";
