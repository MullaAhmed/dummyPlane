// The README recordings. Each scene: optional setup (not recorded), play (recorded).

/** Right-click the canvas, "Lancer 4 agents": a group of four Claude Code sessions boots. */
export const launch = {
  async setup(d, sleep) {
    await d.move(760, 560, 10);
    await sleep(300);
  },
  async play(d, sleep) {
    await sleep(700);
    await d.move(640, 440, 700);
    await sleep(250);
    await d.click(null, { button: "right" });
    await sleep(900);
    const four = await d.at('button[aria-label="Lancer 4 agents"]');
    await d.move(four.x, four.y, 650);
    await sleep(900);
    await d.click();
    await sleep(800);
    await d.move(980, 620, 900);
    await sleep(9500);
  },
};

/** Starts a named group of Claude agents on `model` (setup only, not recorded). */
export async function team(d, sleep, { name = "Frontend", role = "frontend", names = ["Athena", "Hermes", "Apollo"], model = "claude-haiku-5-5" } = {}) {
  await d.eval(`(async () => {
    const { launchGroup } = await import("/src/fleet/groups.ts");
    const { defaultLaunchOptions } = await import("/src/fleet/launchAgent.ts");
    const options = defaultLaunchOptions();
    const names = ${JSON.stringify(names)};
    return launchGroup({ name: ${JSON.stringify(name)}, role: ${JSON.stringify(role)}, agents: names.map(() => "claude") }, options, undefined, {
      pantheon: "greek", names, cwds: names.map(() => options.cwd), models: names.map(() => ${JSON.stringify(model)}),
    });
  })()`);
  await sleep(12000);
}

/** "@frontend" + a question: the group's three agents work at once, then come back ready. */
export const broadcast = {
  async setup(d, sleep) {
    await team(d, sleep);
    await panel(d, sleep, false);
    await fit(d, sleep, 0.88);
    await d.move(900, 760, 10);
  },
  async play(d, sleep) {
    await sleep(600);
    await d.click(await d.at('textarea[placeholder^="Consigne"]', null, { fx: 0.3 }), { ms: 700 });
    await sleep(400);
    await d.type("@fron", 9);
    await sleep(900);
    await d.key("Tab");
    await sleep(500);
    await d.type("In one sentence, what does src/cart.ts do?", 20);
    await sleep(700);
    await d.key("Enter");
    await sleep(1500);
    await d.move(1000, 640, 900);
    await sleep(11000);
  },
};

/** Shows or hides the Agents panel. */
export async function panel(d, sleep, open) {
  const isOpen = await d.eval(`!!document.querySelector('[aria-label="Fermer le panneau"]')`);
  if (isOpen !== open) {
    await d.eval(`document.querySelector('[aria-label="${open ? "Agents" : "Fermer le panneau"}"]').click()`);
    await sleep(400);
  }
}

/** Fits the view to the whole scene. */
export async function fit(d, sleep, factor = 0.9, maxZoom = 1, dy = 0, keep = "true", dx = 0) {
  await d.eval(`(async () => {
    const { canvasStore } = await import("/src/canvas/canvasStore.ts");
    const api = canvasStore.getState().api;
    const els = api.getSceneElements().filter((e) => ${keep});
    const x0 = Math.min(...els.map((e) => e.x)), y0 = Math.min(...els.map((e) => e.y));
    const x1 = Math.max(...els.map((e) => e.x + e.width)), y1 = Math.max(...els.map((e) => e.y + e.height));
    const { width, height } = api.getAppState();
    const z = Math.min(${maxZoom}, (${factor} * width) / (x1 - x0), (${factor} * (height - 160)) / (y1 - y0));
    const cx = (x0 + x1) / 2 - ${dx} / z, cy = (y0 + y1) / 2 - ${dy} / z;
    api.updateScene({ appState: { zoom: { value: z }, scrollX: width / (2 * z) - cx, scrollY: height / (2 * z) - cy } });
  })()`);
  await sleep(500);
}

/** After the targets, "/" lists Claude Code's commands; /context runs in every agent of the group. */
export const commands = {
  async setup(d, sleep) {
    await d.move(1000, 640, 10);
  },
  async play(d, sleep) {
    await sleep(600);
    await d.click(await d.at('textarea:not(.xterm-helper-textarea)', null, { fx: 0.5 }), { ms: 700 });
    await sleep(400);
    await d.type("/", 6);
    await sleep(1600);
    await d.type("cont", 7);
    await sleep(1200);
    await d.key("Enter");
    await sleep(700);
    await d.key("Enter");
    await sleep(1200);
    await d.move(1060, 600, 800);
    await sleep(7000);
  },
};

/** Ctrl+P to an agent, Ctrl+Shift+P "Revue des changements", a remark on a diff line, ready to send. */
export const review = {
  async setup(d, sleep) {
    await team(d, sleep);
    await d.key("Shift+Escape");
    await fit(d, sleep, 0.88);
    await d.move(1000, 640, 10);
  },
  async play(d, sleep) {
    await sleep(800);
    await d.key("Ctrl+P");
    await sleep(700);
    await d.type("herm", 7);
    await sleep(900);
    await d.key("Enter");
    await sleep(1500);
    await d.key("Ctrl+Shift+P");
    await sleep(700);
    await d.type("revue", 7);
    await sleep(900);
    await d.key("Enter");
    await sleep(1800);
    const line = await d.at("span.whitespace-pre", "discountFor(coupon));", { fx: 0.4 });
    await d.click(line, { ms: 800 });
    await sleep(700);
    await d.type("Clamp the discount so a total can never go negative.", 18);
    await sleep(600);
    await d.key("Enter");
    await sleep(1000);
    const send = await d.at("button", "Envoyer à").catch(() => null);
    if (send) await d.move(send.x, send.y, 900);
    await sleep(2500);
  },
};

/** The mission's state as the panel shows it, read from the orchestrator node. */
async function missionState(d) {
  return d.eval(`(async () => {
    const { nodesStore } = await import("/src/store/nodes.ts");
    const { missionOf } = await import("/src/mission/store.ts");
    const node = Object.values(nodesStore.getState().nodes).find((n) => n?.kind === "orchestrator");
    const m = node && missionOf(node);
    return m ? { state: m.state, plan: m.plan?.length ?? 0, merged: (m.members ?? []).filter((x) => x.merged).length, members: (m.members ?? []).length, error: m.error ?? null } : null;
  })()`);
}

/**
 * Starts a group of `names` and an orchestrator wired to it, on `model` (setup only).
 * The orchestrator is made the way "Relier un orchestrateur" makes it, with a model.
 */
export async function orchestratedTeam(d, sleep, { names = ["Athena", "Hermes"], model = "claude-sonnet-5-5" } = {}) {
  await d.eval(`(async () => {
    const { launchGroup } = await import("/src/fleet/groups.ts");
    const { defaultLaunchOptions } = await import("/src/fleet/launchAgent.ts");
    const { canvasStore } = await import("/src/canvas/canvasStore.ts");
    const { createNodeElement } = await import("/src/canvas/nodeElement.ts");
    const { orchestratorSession } = await import("/src/nodes/terminal/launch.ts");
    const { markForAutostart } = await import("/src/nodes/terminal/registry.ts");
    const { ORCHESTRATOR_NAME } = await import("/src/nodes/types.ts");
    const { nodesStore } = await import("/src/store/nodes.ts");
    const { workspacesStore } = await import("/src/store/workspaces.ts");
    const { orchestratorSpot } = await import("/src/fleet/groupLayout.ts");
    const { withWire } = await import("/src/fleet/wires.ts");
    const options = defaultLaunchOptions();
    const names = ${JSON.stringify(names)};
    const g = await launchGroup({ name: "Backend", role: "backend", agents: names.map(() => "claude") }, options, undefined, {
      pantheon: "greek", names, cwds: names.map(() => options.cwd),
    });
    const api = canvasStore.getState().api;
    const frame = canvasStore.getState().frames.find((f) => f.id === g.frameId);
    const element = createNodeElement("orchestrator", orchestratorSpot(frame));
    const session = { ...orchestratorSession(ORCHESTRATOR_NAME, options), model: ${JSON.stringify(model)} };
    await nodesStore.getState().create(element.id, { workspaceId: workspacesStore.getState().activeId, kind: "orchestrator", payload: { name: ORCHESTRATOR_NAME, session } });
    markForAutostart(element.id);
    api.updateScene({ elements: withWire([...api.getSceneElementsIncludingDeleted(), element], element.id, g.frameId), captureUpdate: "IMMEDIATELY" });
  })()`);
  await sleep(14000);
}

/** A real mission: the router on, a goal typed to the orchestrator, its plan, the go-ahead, the team at work, the merge. */
export const mission = {
  record: { format: "jpeg", quality: 82 },
  goal: "Add validation to the cart: addItem must reject a quantity below 1 or a negative price, with unit tests. Also add unit tests for src/coupons.ts. Write the code and the tests only: install nothing, run nothing.",
  async setup(d, sleep) {
    await orchestratedTeam(d, sleep);
    await panel(d, sleep, false);
    await fit(d, sleep, 0.94, 1, -20, "true", 20);
    await d.move(900, 700, 10);
  },
  async play(d, sleep) {
    const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
    await sleep(800);
    // Ctrl+P to the orchestrator: the view comes to it and its terminal takes the keyboard.
    await d.key("Ctrl+P");
    await sleep(700);
    await d.type("orchestrateur", 12);
    await sleep(800);
    await d.key("Enter");
    await sleep(1500);
    await d.click(await d.at('input[aria-label="Routeur de modèles"]'), { ms: 800 });
    await sleep(700);
    const term = await d.eval(`(() => {
      let host = document.querySelector("[data-mission]");
      while (host && !host.querySelector(".xterm-screen")) host = host.parentElement;
      if (!host) return null;
      const b = host.querySelector(".xterm-screen").getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height * 0.55 };
    })()`);
    if (!term) throw new Error("no orchestrator terminal");
    await d.click(term, { ms: 700 });
    await sleep(400);
    const focused = await d.eval(`document.activeElement?.className === "xterm-helper-textarea"`);
    if (!focused) throw new Error("the orchestrator's terminal has no keyboard");
    await d.type(mission.goal, 28);
    await sleep(500);
    await d.key("Enter");
    log("goal sent");
    // The plan: streamed until it shows (the orchestrator reads the code first).
    let s;
    for (let i = 0; i < 360; i++) {
      s = await missionState(d);
      if (s?.state === "plan" || s?.error) break;
      if (i === 20) await d.pauseStream();
      if (i >= 20) await d.snapshot();
      await sleep(1000);
    }
    await d.resumeStream();
    log("plan", JSON.stringify(s));
    if (s?.state !== "plan") throw new Error("no plan: " + JSON.stringify(s));
    await sleep(2500);
    await afterPlan(d, sleep, log);
  },
};

/** The mission's second half, from a proposed plan: the go-ahead, the team at work, the merge. */
/** From a proposed plan: « Lancer la mission » (clicked once the panel is still), the team at work, the merge. */
async function afterPlan(d, sleep, log) {
  let s;
  for (let attempt = 0; attempt < 3 && (s = await missionState(d))?.state === "plan"; attempt++) {
    let at = await d.at("button", "Lancer la mission");
    for (let i = 0; i < 10; i++) {
      await sleep(300);
      const now = await d.at("button", "Lancer la mission");
      if (Math.abs(now.x - at.x) + Math.abs(now.y - at.y) < 1) break;
      at = now;
    }
    await d.click(at, { ms: attempt ? 200 : 900 });
    for (let i = 0; i < 10 && (s = await missionState(d))?.state === "plan"; i++) await sleep(300);
  }
  if (s?.state === "plan") throw new Error("the launch did not start");
  log("launched");
  await sleep(2000);
  await d.click(await d.at('button[aria-label="Ajuster la vue"]'), { ms: 900 });
  await sleep(6000);
  await d.move(1100, 760, 800);
  await d.pauseStream();
  for (let i = 0; i < 900; i++) {
    await d.snapshot();
    s = await missionState(d);
    if (s?.state === "terminee" || s?.error) break;
    if (i % 30 === 0) log("state", JSON.stringify(s));
    await sleep(1500);
  }
  log("end", JSON.stringify(s));
  await d.resumeStream();
  await sleep(3000);
}

/** The mission's second half alone, from a plan already proposed. */
export const missionGo = {
  record: { format: "jpeg", quality: 82 },
  async play(d, sleep) {
    await sleep(1000);
    await afterPlan(d, sleep, (...a) => console.log(new Date().toISOString().slice(11, 19), ...a));
  },
};
