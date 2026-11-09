// Drives the probe dummyPlane page through WebView2's DevTools port (page input
// only, never the OS) and records it with Page.startScreencast.
import fs from "node:fs";
import path from "node:path";

export async function connect(port = 9223) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.includes("localhost:1420"));
  if (!page) throw new Error("no page: " + JSON.stringify(targets.map((t) => t.url)));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let next = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method && listeners.has(message.method)) {
      for (const fn of listeners.get(message.method)) fn(message.params);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  return new Driver(send, on, ws);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const KEYS = {
  Enter: ["Enter", "Enter", 13], Escape: ["Escape", "Escape", 27], Tab: ["Tab", "Tab", 9],
  Backspace: ["Backspace", "Backspace", 8], Space: [" ", "Space", 32],
  ArrowUp: ["ArrowUp", "ArrowUp", 38], ArrowDown: ["ArrowDown", "ArrowDown", 40],
  ArrowLeft: ["ArrowLeft", "ArrowLeft", 37], ArrowRight: ["ArrowRight", "ArrowRight", 39],
  "/": ["/", "Slash", 191], "@": ["@", "Digit0", 48],
};

class Driver {
  constructor(send, on, ws) {
    this.send = send;
    this.on = on;
    this.ws = ws;
    this.x = 700;
    this.y = 450;
    this.frames = [];
    this.recording = false;
  }

  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }

  /** Center of the first element matching `selector` (and `text`, if given). */
  async at(selector, text = null, { dx = 0, dy = 0, fx = 0.5, fy = 0.5 } = {}) {
    const r = await this.eval(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const t = ${JSON.stringify(text)};
      const el = els.find((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && (t === null || (e.textContent || e.getAttribute("aria-label") || "").trim().includes(t));
      });
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.left + b.width * ${fx}, y: b.top + b.height * ${fy}, w: b.width, h: b.height };
    })()`);
    if (!r) throw new Error(`not found: ${selector} ${text ?? ""}`);
    return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
  }

  async mouse(type, x, y, button = "none", buttons = 0, clickCount = 0, modifiers = 0) {
    await this.send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount, modifiers });
  }

  /** Glides the cursor to (x, y) over `ms`, eased. */
  async move(x, y, ms = 600, held = null) {
    const [x0, y0] = [this.x, this.y];
    const steps = Math.max(1, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps);
      this.x = x0 + (x - x0) * t;
      this.y = y0 + (y - y0) * t;
      await this.mouse("mouseMoved", this.x, this.y, held ?? "none", held === "left" ? 1 : held === "right" ? 2 : 0);
      await sleep(16);
    }
  }

  async moveTo(target, ms) {
    await this.move(target.x, target.y, ms);
  }

  async click(target = null, { button = "left", ms = 550, count = 1, modifiers = 0 } = {}) {
    if (target) await this.move(target.x, target.y, ms);
    const b = button === "left" ? 1 : 2;
    for (let c = 1; c <= count; c++) {
      await this.mouse("mousePressed", this.x, this.y, button, b, c, modifiers);
      await sleep(60);
      await this.mouse("mouseReleased", this.x, this.y, button, 0, c, modifiers);
      await sleep(40);
    }
  }

  async drag(from, to, ms = 900) {
    await this.move(from.x, from.y, 500);
    await this.mouse("mousePressed", this.x, this.y, "left", 1, 1);
    await sleep(80);
    await this.move(to.x, to.y, ms, "left");
    await sleep(60);
    await this.mouse("mouseReleased", this.x, this.y, "left", 0, 1);
  }

  async wheel(deltaY, { ctrl = false, steps = 6, deltaX = 0 } = {}) {
    for (let i = 0; i < steps; i++) {
      await this.send("Input.dispatchMouseEvent", {
        type: "mouseWheel", x: this.x, y: this.y, deltaX: deltaX / steps, deltaY: deltaY / steps, modifiers: ctrl ? 2 : 0,
      });
      await sleep(30);
    }
  }

  async key(combo) {
    const parts = combo.split("+");
    const name = parts.pop();
    const mods = (parts.includes("Alt") ? 1 : 0) | (parts.includes("Ctrl") ? 2 : 0) | (parts.includes("Shift") ? 8 : 0);
    let key, code, keyCode;
    if (KEYS[name]) [key, code, keyCode] = KEYS[name];
    else if (/^F\d+$/.test(name)) [key, code, keyCode] = [name, name, 111 + Number(name.slice(1))];
    else if (/^\d$/.test(name)) [key, code, keyCode] = [name, `Digit${name}`, name.charCodeAt(0)];
    else [key, code, keyCode] = [parts.includes("Shift") ? name.toUpperCase() : name.toLowerCase(), `Key${name.toUpperCase()}`, name.toUpperCase().charCodeAt(0)];
    const base = { modifiers: mods, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    if (!mods && key.length === 1) await this.send("Input.dispatchKeyEvent", { type: "char", text: key, ...base });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  /** Types like a person: one character at a time. */
  async type(text, cps = 16) {
    for (const ch of text) {
      await this.send("Input.insertText", { text: ch });
      await sleep(1000 / cps + (Math.random() * 30 - 15));
    }
  }

  async cursor(show = true) {
    await this.eval(`(() => {
      let c = document.getElementById("__demo_cursor");
      if (!${show}) { c?.remove(); document.getElementById("__demo_ripple")?.remove(); return; }
      if (c) return;
      c = document.createElement("div");
      c.id = "__demo_cursor";
      c.style.cssText = "position:fixed;left:0;top:0;width:22px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(${this.x}px,${this.y}px);filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))";
      c.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M1.5 1.5 L1.5 21.5 L6.6 16.9 L10.2 25.2 L13.6 23.7 L10.1 15.6 L17 15.4 Z" fill="#fff" stroke="#1A1918" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(c);
      const r = document.createElement("div");
      r.id = "__demo_ripple";
      r.style.cssText = "position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid #D97757;z-index:2147483646;pointer-events:none;opacity:0";
      document.documentElement.appendChild(r);
      const move = (e) => { c.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)"; };
      addEventListener("pointermove", move, true);
      addEventListener("pointerdown", (e) => {
        move(e);
        r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
        r.animate([{ opacity: .9, transform: "scale(.4)" }, { opacity: 0, transform: "scale(1.3)" }], { duration: 450, easing: "ease-out" });
      }, true);
    })()`);
  }

  async startRecording(dir, { format = "png", quality = 92, maxWidth, maxHeight } = {}) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.frames = [];
    if (!this.hooked) {
      this.hooked = true;
      this.on("Page.screencastFrame", (p) => {
        this.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
        if (this.recording) this.keep(p.data);
      });
    }
    this.format = format === "jpeg" ? "jpg" : "png";
    this.quality = quality;
    this.stream = { format, quality, everyNthFrame: 1, ...(maxWidth ? { maxWidth, maxHeight } : {}) };
    this.recording = true;
    await this.send("Page.startScreencast", this.stream);
  }

  /** One frame, stamped with its arrival: streamed and snapshot frames share one clock. */
  keep(data) {
    const file = path.join(this.dir, `f${String(this.frames.length).padStart(5, "0")}.${this.format}`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    this.frames.push({ file: path.basename(file), t: Date.now() / 1000 });
  }

  /** For long waits: the stream stops, `snapshot` adds a frame when asked, `resumeStream` goes back. */
  async pauseStream() {
    if (this.paused) return;
    this.paused = true;
    await this.send("Page.stopScreencast");
  }

  async resumeStream() {
    if (!this.paused) return;
    this.paused = false;
    await this.send("Page.startScreencast", this.stream);
  }

  async snapshot() {
    const shot = await this.send("Page.captureScreenshot", { format: this.format === "jpg" ? "jpeg" : "png", quality: this.quality });
    this.keep(shot.data);
  }

  async stopRecording() {
    await sleep(300);
    this.recording = false;
    await this.send("Page.stopScreencast");
    const end = Date.now() / 1000;
    fs.writeFileSync(path.join(this.dir, "frames.json"), JSON.stringify({ frames: this.frames, end }, null, 1));
    return this.frames.length;
  }

  close() {
    this.ws.close();
  }
}
