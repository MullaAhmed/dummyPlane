// node rec.mjs <scene> [port] — plays a scene of scenes.mjs while recording it,
// frames to %TEMP%/dummyplane-media/frames/<scene>/ (then: python gif.py <that dir> out.gif).
import os from "node:os";
import path from "node:path";
import { connect, sleep } from "./lib.mjs";
import * as scenes from "./scenes.mjs";

const [name, port = "9223"] = process.argv.slice(2);
const scene = scenes[name];
if (!scene?.play) throw new Error(`no scene "${name}"; scenes: ${Object.keys(scenes).filter((k) => scenes[k].play)}`);
const dir = path.join(os.tmpdir(), "dummyplane-media", "frames", name);
const d = await connect(Number(port));
await d.cursor(true);
if (scene.setup) await scene.setup(d, sleep);
await d.startRecording(dir, scene.record ?? { format: "png" });
try {
  await scene.play(d, sleep);
} finally {
  const n = await d.stopRecording();
  console.log(`${name}: ${n} frames in ${dir}`);
  if (scene.teardown) await scene.teardown(d, sleep);
  await d.cursor(false);
  d.close();
}
