import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { excalidrawThinSelection } from "./scripts/excalidraw-thin-selection.mjs";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), excalidrawThinSelection()],
  // In dev, Excalidraw is pre-bundled apart from the app's plugins: the same rewrite runs there.
  optimizeDeps: { rolldownOptions: { plugins: [excalidrawThinSelection()] } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Tauri expects a fixed port and its own Rust errors left visible.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Agents' worktrees live under .claude/: their copies of the tests are not ours.
  test: { exclude: [...configDefaults.exclude, ".claude/**"] },
}));
