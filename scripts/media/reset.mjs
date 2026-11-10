// Empties the active workspace's canvas: every element goes, terminals stop.
import { connect, sleep } from "./lib.mjs";
const d = await connect();
console.log(await d.eval(`(async () => {
  const { canvasStore } = await import("/src/canvas/canvasStore.ts");
  const { removeNodes } = await import("/src/agents/terminals.ts");
  const api = canvasStore.getState().api;
  const ids = api.getSceneElements().map((e) => e.id);
  removeNodes(ids);
  api.history?.clear?.();
  return ids.length;
})()`));
await sleep(500);
d.close();
