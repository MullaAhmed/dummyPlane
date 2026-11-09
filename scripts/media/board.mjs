// node board.mjs <out.png> [light|dark] — the README's board screenshot: fits the view on
// everything but orchestrators, Agents panel closed, the theme switched for the shot only.
import fs from "node:fs";
import { connect, sleep } from "./lib.mjs";
import * as s from "./scenes.mjs";
const [out, theme = "dark"] = process.argv.slice(2);
const d = await connect();
const before = await d.eval(`(async () => {
  const { themeStore } = await import("/src/app/theme.ts");
  const { canvasStore } = await import("/src/canvas/canvasStore.ts");
  canvasStore.getState().api.updateScene({ appState: { selectedElementIds: {}, selectedLinearElement: null } });
  const choice = themeStore.getState().choice;
  themeStore.setState({ choice: ${JSON.stringify(theme)} });
  return choice;
})()`);
await s.panel(d, sleep, false);
await s.fit(d, sleep, 0.9, 1, -10, `!["orchestrator", "wire"].includes(e.customData?.dummyplane?.kind ?? e.customData?.kind)`, 14);
await sleep(1500);
const shot = await d.send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
await d.eval(`(async () => { const { themeStore } = await import("/src/app/theme.ts"); themeStore.setState({ choice: ${JSON.stringify(before)} }); })()`);
console.log("theme was", before);
d.close();
