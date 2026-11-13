import type { Plugin } from "vite";

/** Whether `importer` is a file of the shim's folder, the only place that reads the real sonner. */
export function importsRealSonner(importer: string): boolean;

/** Sends every import of "sonner" to the notification shim, except the shim's own. */
export function routeSonner(): Plugin;
