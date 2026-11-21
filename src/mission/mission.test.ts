import { describe, expect, it } from "vitest";
import { budgetBar, budgetOf, clockText, conflictPending, memberTime, NEW_MISSION, nightMin, noNewWork, oneLine, overruns, proposedPlan, proposedTasks, readMission, remainingGlobal, sameName, spentMin, squashMessage, subTasksNamedBy, windingDown, worktreeOwners, type Member, type Mission } from "./mission";

const task = (agent: string, budget = 20) => ({ titre: "Login", consigne: "Fais le login", agent, budget_min: budget });
const args = (...sous_taches: object[]) => ({ nom: "Auth", tache: "Ajoute l'authentification", sous_taches });

describe("proposedPlan", () => {
  it("takes a plan of linked agents, named case and accents aside, and new ones", () => {
    const result = proposedPlan(args(task("hulk"), { ...task("nouveau", 30), titre: "API" }), NEW_MISSION, ["Hulk", "Wolverine"]);
    expect(result).toEqual({
      name: "Auth",
      task: "Ajoute l'authentification",
      plan: [
        { title: "Login", brief: "Fais le login", agent: "Hulk", budgetMin: 20 },
        { title: "API", brief: "Fais le login", agent: "nouveau", budgetMin: 30 },
      ],
    });
  });

  it("refuses what the team cannot do, with a reason the fleet can read", () => {
    const budgeted: Mission = { ...NEW_MISSION, overnight: true, budgetMin: 30, maxAgents: 2 };
    expect(proposedPlan(args(task("Deadpool")), NEW_MISSION, ["Hulk"])).toContain("Deadpool");
    expect(proposedPlan(args(task("Hulk"), task("Hulk")), NEW_MISSION, ["Hulk"])).toContain("one sub-task per agent");
    // Real time: two agents in parallel share it, one sub-task alone must fit.
    expect(proposedPlan(args({ ...task("nouveau", 30), titre: "A" }, { ...task("nouveau", 30), titre: "B" }), budgeted, [])).toMatchObject({ name: "Auth" });
    expect(proposedPlan(args(task("nouveau", 31)), budgeted, [])).toBe("Sub-task 1: 31 min do not fit in the night (30 min of real time).");
    // Past Max agents, sub-tasks wait in the queue at the go-ahead: only "new" ones, the queue names no agent.
    expect(proposedPlan(args({ ...task("nouveau"), titre: "A" }, { ...task("nouveau"), titre: "B" }, { ...task("nouveau"), titre: "C" }), budgeted, [])).toMatchObject({ name: "Auth" });
    expect(proposedPlan(args({ ...task("nouveau"), titre: "A" }, { ...task("nouveau"), titre: "B" }, task("Hulk")), budgeted, ["Hulk"])).toBe(
      'Sub-task 3: only the first 2 sub-tasks start at the go-ahead (Max active agents), the rest wait in the queue for a new agent: give it agent "new".',
    );
    expect(proposedPlan(args(task("nouveau", 0)), NEW_MISSION, [])).toContain("budget");
    expect(proposedPlan({ tache: "x", sous_taches: [task("nouveau")] }, NEW_MISSION, [])).toContain("name");
    expect(proposedPlan(args(), NEW_MISSION, [])).toContain("at least one");
  });

  it("refuses a plan whose waiting sub-tasks would overflow the queue", () => {
    const queued = (count: number) => Array.from({ length: count }, (_, i) => ({ title: `Q${i}`, brief: "b", budgetMin: 5 }));
    const three = args({ ...task("nouveau"), titre: "A" }, { ...task("nouveau"), titre: "B" }, { ...task("nouveau"), titre: "C" });
    expect(proposedPlan(three, { ...NEW_MISSION, maxAgents: 1, queue: queued(99) }, [])).toBe("The queue holds 100 tasks at most.");
    expect(proposedPlan(three, { ...NEW_MISSION, maxAgents: 1, queue: queued(98) }, [])).toMatchObject({ name: "Auth" });
    // Only the sub-tasks past Max agents join the queue: one that starts takes no place in it.
    expect(proposedPlan(args({ ...task("nouveau"), titre: "A" }), { ...NEW_MISSION, maxAgents: 1, queue: queued(100) }, [])).toMatchObject({ name: "Auth" });
  });

  it("keeps the Kanban card of a sub-task, when its boards have it", () => {
    const result = proposedPlan(args({ ...task("nouveau"), card: "c1" }), NEW_MISSION, [], [], ["c1"]);
    expect(typeof result !== "string" && result.plan[0].card).toBe("c1");
    expect(proposedPlan(args({ ...task("nouveau"), card: "zz" }), NEW_MISSION, [], [], ["c1"])).toContain("zz");
    // Kept through a save; an unreadable card is dropped.
    const plan = [{ title: "Login", brief: "b", agent: "nouveau", budgetMin: 5, card: "c1" }, { title: "API", brief: "b", agent: "nouveau", budgetMin: 5, card: 3 }];
    expect(readMission({ ...NEW_MISSION, plan })!.plan!.map((s) => s.card)).toEqual(["c1", undefined]);
  });
});

describe("a new agent's group", () => {
  const groups = [{ id: "f1", name: "Interface" }];

  it("puts it in a linked group, named as the fleet reads it", () => {
    const result = proposedPlan(args({ ...task("nouveau"), groupe: "interface" }), NEW_MISSION, [], groups);
    expect(typeof result === "string" ? result : result.plan[0].group).toEqual({ id: "f1", name: "Interface" });
  });

  it("keeps the mission's group without one", () => {
    const result = proposedPlan(args(task("nouveau")), NEW_MISSION, [], groups);
    expect(typeof result === "string" ? result : Object.keys(result.plan[0])).not.toContain("group");
  });

  it("refuses an unknown group, and a group for a named agent", () => {
    expect(proposedPlan(args({ ...task("nouveau"), groupe: "Deadpool" }), NEW_MISSION, [], groups)).toBe("Sub-task 1: \"Deadpool\" is not a linked group.");
    expect(proposedPlan(args({ ...task("Hulk"), groupe: "Interface" }), NEW_MISSION, ["Hulk"], groups)).toBe("Sub-task 1: group only goes with agent \"new\".");
  });

  it("refuses them in English too", () => {
    try {
      expect(proposedPlan(args({ ...task("nouveau"), groupe: "Deadpool" }), NEW_MISSION, [], groups)).toBe('Sub-task 1: "Deadpool" is not a linked group.');
      expect(proposedPlan(args({ ...task("Hulk"), groupe: "Interface" }), NEW_MISSION, ["Hulk"], groups)).toBe('Sub-task 1: group only goes with agent "new".');
    } finally {
    }
  });

  it("is saved with the plan and on the member", () => {
    const saved = readMission({
      state: "en_cours",
      plan: [{ title: "A", brief: "B", agent: "nouveau", budgetMin: 1, group: { id: "f1", name: "Interface" } }, { title: "C", brief: "D", agent: "nouveau", budgetMin: 1, group: { id: 3 } }],
      members: [{ nodeId: "n", name: "Batman", task: "A", budgetMin: 1, linked: false, branch: "b", worktree: "w", group: "f1" }],
    });
    expect(saved?.plan?.map((s) => s.group)).toEqual([{ id: "f1", name: "Interface" }, undefined]);
    expect(saved?.members[0].group).toBe("f1");
  });
});

it("keeps a member's sub-task not typed yet across a restart, and none once it was typed (12 Nov)", () => {
  const member = { nodeId: "n", name: "Batman", task: "A", budgetMin: 1, linked: false, branch: "b", worktree: "w" };
  const saved = readMission(JSON.parse(JSON.stringify({ state: "en_cours", maxAgents: 4, members: [{ ...member, brief: "Do A." }, { ...member, nodeId: "m", brief: "Do A.", sentAt: 5 }, { ...member, nodeId: "o", brief: 3 }] })));
  expect(saved?.members.map((m) => m.brief)).toEqual(["Do A.", undefined, undefined]);
});

describe("tasks for the queue", () => {
  const item = (titre: string, extra: object = {}) => ({ titre, consigne: "Fais-le", budget_min: 20, ...extra });
  const added = (...tasks: unknown[]) => ({ tasks });

  it("reads them in order, with their level and group", () => {
    const groups = [{ id: "g1", name: "Interface" }];
    expect(proposedTasks(added(item("A"), item("B", { niveau: "eleve", groupe: "interface" })), NEW_MISSION, groups)).toEqual([
      { title: "A", brief: "Fais-le", budgetMin: 20 },
      { title: "B", brief: "Fais-le", budgetMin: 20, level: "eleve", group: { id: "g1", name: "Interface" } },
    ]);
  });

  it("counts a pending plan's sub-tasks beyond Max agents: they join the queue at the go-ahead", () => {
    const sub = (title: string) => ({ title, brief: "b", agent: "nouveau", budgetMin: 5 });
    const queue = Array.from({ length: 97 }, (_, i) => ({ title: `Q${i}`, brief: "b", budgetMin: 5 }));
    const pending: Mission = { ...NEW_MISSION, state: "plan", maxAgents: 1, plan: [sub("P1"), sub("P2"), sub("P3")], queue };
    expect(proposedTasks(added(item("A"), item("B")), pending, [])).toBe("The queue holds 100 tasks at most.");
    expect(proposedTasks(added(item("A")), pending, [])).toHaveLength(1);
  });

  it("keeps the Kanban card of a task, one of its linked boards only", () => {
    expect(proposedTasks(added(item("A", { card: "c1" })), NEW_MISSION, [], ["c1"])).toEqual([{ title: "A", brief: "Fais-le", budgetMin: 20, card: "c1" }]);
    expect(proposedTasks(added(item("A", { card: "zz" })), NEW_MISSION, [], ["c1"])).toContain('"zz"');
  });

  it("checks them like a plan", () => {
    expect(proposedTasks(added(), NEW_MISSION, [])).toBe("Give at least one sub-task.");
    expect(proposedTasks(added(item("")), NEW_MISSION, [])).toContain("a short title");
    expect(proposedTasks(added(item("A", { consigne: "" })), NEW_MISSION, [])).toContain("brief");
    expect(proposedTasks(added(item("A", { budget_min: 0 })), NEW_MISSION, [])).toContain("budget");
    expect(proposedTasks(added(item("A", { budget_min: 31 })), { ...NEW_MISSION, overnight: true, budgetMin: 30 }, [])).toContain("do not fit in the night");
    // A regular mission has no overall limit, even one held over from the old global budget.
    expect(proposedTasks(added(item("A", { budget_min: 31 })), { ...NEW_MISSION, budgetMin: 30 }, [])).toEqual([{ title: "A", brief: "Fais-le", budgetMin: 31 }]);
    expect(proposedTasks(added(item("A", { niveau: "énorme" })), NEW_MISSION, [])).toContain("level");
    expect(proposedTasks(added(item("A")), { ...NEW_MISSION, router: true }, [])).toContain("Sub-task 1: a level (low, medium, high or extreme) — the router chooses the agent's model with it.");
    expect(proposedTasks(added(item("A", { groupe: "Deadpool" })), NEW_MISSION, [])).toContain("Deadpool");
  });

  it("keeps titles unique: reassign and team name a task by its title", () => {
    const mission = { ...NEW_MISSION, plan: [{ title: "Login", brief: "b", agent: "Batman", budgetMin: 5 }], queue: [{ title: "API", brief: "b", budgetMin: 5 }], members: [] };
    expect(proposedTasks(added(item("login")), mission, [])).toContain('Sub-task 1: the title "login" is taken by a sub-task of the pending plan; one title per task');
    expect(proposedTasks(added(item("api")), mission, [])).toContain("is taken by a task waiting in the queue");
    expect(proposedTasks(added(item("Docs"), item("docs")), mission, [])).toContain('Sub-task 2: the title "docs" is taken by sub-task 1 of this same call');
    expect(proposedPlan(args(task("nouveau")), { ...mission, plan: undefined, queue: [{ title: "Login", brief: "b", budgetMin: 5 }] }, [])).toContain("is taken");
  });

  it("says who holds a title an agent works on or finished, and what to do about it", () => {
    const member = (name: string, task: string, done: string[] = []) => ({ nodeId: name, name, task, budgetMin: 5, linked: false, branch: "b", worktree: "w", done });
    const mission = { ...NEW_MISSION, state: "en_cours" as const, members: [member("Thor", "Banners", ["Header"])] };
    const working = proposedTasks(added(item("banners")), mission, []) as string;
    expect(working).toContain("is taken by Thor's sub-task");
    // The way out is in the refusal: leave it to its holder, or give it a title of its own.
    expect(working).toContain("If it is the same work, leave it to its holder; otherwise give this one a title of its own.");
    expect(proposedTasks(added(item("Header")), mission, [])).toContain("is taken by a sub-task Thor finished");
  });

  it("says how long a title is past the limit, and offers one cut at a word, never cutting it itself", () => {
    const long = "Rewrite the checkout flow so the cart survives a reload and the payment step keeps its draft";
    const refused = proposedTasks(added(item(long)), NEW_MISSION, []) as string;
    expect(refused).toContain("(60 characters at most): this one has 92");
    expect(refused).toContain('for example "Rewrite the checkout flow so the cart survives a reload and"');
    expect(refused).toContain("keep the detail in the brief");
    // An unbroken text is cut where the limit falls; a title of 60 characters is no refusal.
    expect(proposedTasks(added(item("x".repeat(70))), NEW_MISSION, [])).toContain(`for example "${"x".repeat(60)}"`);
    expect(Array.isArray(proposedTasks(added(item("x".repeat(60))), NEW_MISSION, []))).toBe(true);
    // An empty title is no length problem.
    expect(proposedTasks(added(item("")), NEW_MISSION, [])).toBe("Sub-task 1: a short title (60 characters at most).");
  });

  it("names the sub-task a reassign means by the holder's name, its card or the start of its title, never by guess", () => {
    const held = (name: string, task: string) => ({ nodeId: name, name, task, budgetMin: 5, linked: false, branch: "b", worktree: "w" });
    const mission = {
      ...NEW_MISSION,
      state: "en_cours" as const,
      plan: [
        { title: "Login form", brief: "b", agent: "Batman", budgetMin: 5, card: "c1" },
        { title: "Login API", brief: "b", agent: "Aquaman", budgetMin: 5 },
        { title: "Docs", brief: "b", agent: "Shazam", budgetMin: 5 },
      ],
      members: [held("Batman", "Login form"), held("Aquaman", "Login API"), { ...held("Shazam", "Docs"), handedTo: "Batman" }, { ...held("Hulk", "Lint"), abandoned: true }],
    };
    const names = (given: string) => subTasksNamedBy(mission, given).map((m) => m.name);
    expect(names("aquaman")).toEqual(["Aquaman"]);
    expect(names("C1")).toEqual(["Batman"]);
    expect(names("login f")).toEqual(["Batman"]);
    // A start two sub-tasks share names none; one too short names none either.
    expect(names("Login")).toEqual(["Batman", "Aquaman"]);
    expect(names("lo")).toEqual([]);
    // What was handed over or abandoned is no sub-task to hand over; free text, or nothing, fits none.
    expect(names("Docs")).toEqual([]);
    expect(names("Hulk")).toEqual([]);
    expect(names("Finish the login form: validate every field")).toEqual([]);
    expect(names("")).toEqual([]);
  });

  it("holds 100 tasks at most", () => {
    const queue = Array.from({ length: 99 }, (_, i) => ({ title: `T${i}`, brief: "b", budgetMin: 5 }));
    expect(proposedTasks(added(item("A")), { ...NEW_MISSION, queue }, [])).toHaveLength(1);
    expect(proposedTasks(added(item("A"), item("B")), { ...NEW_MISSION, queue }, [])).toBe("The queue holds 100 tasks at most.");
  });

  it("says what is wrong in English", () => {
    try {
      const mission = { ...NEW_MISSION, queue: [{ title: "API", brief: "b", budgetMin: 5 }] };
      expect(proposedTasks(added(item("api")), mission, [])).toContain('Sub-task 1: the title "api" is taken by a task waiting in the queue; one title per task');
      expect(proposedTasks({ tasks: Array.from({ length: 101 }, (_, i) => item(`T${i}`)) }, NEW_MISSION, [])).toBe("The queue holds 100 tasks at most.");
    } finally {
    }
  });

  it("is saved with the mission, what an agent finished too", () => {
    const past = { task: "Login", status: "termine", summary: "ok", merged: true, spentMin: 3, budgetMin: 5, branch: "b" };
    const saved = readMission({
      state: "en_cours",
      queue: [{ title: "A", brief: "B", budgetMin: 1, level: "faible", group: { id: "g", name: "G" } }, { title: 3 }],
      members: [{ nodeId: "n", name: "Batman", task: "A", budgetMin: 1, linked: false, branch: "b", worktree: "w", past: [past, { task: "x" }] }],
    });
    expect(saved?.queue).toEqual([{ title: "A", brief: "B", budgetMin: 1, level: "faible", group: { id: "g", name: "G" } }]);
    expect(saved?.members[0].past).toEqual([past]);
    expect(readMission({ state: "plan" })).not.toHaveProperty("queue");
  });

  it("keeps, after a restart, the head an agent's last merge took in: the next merge and the cleanups need it", () => {
    const member = { nodeId: "n", name: "Batman", task: "A", budgetMin: 1, linked: false, branch: "b", worktree: "w", squashed: "c0ffee" };
    const saved = readMission(JSON.parse(JSON.stringify({ state: "terminee", members: [member, { ...member, nodeId: "m", name: "Robin", squashed: 3 }], strays: ["Superman"] })));
    expect(saved?.members.map((m) => m.squashed)).toEqual(["c0ffee", undefined]);
    // What the cleanups are told: each agent with the head its squash took in, a stray with none.
    expect(worktreeOwners(saved!)).toEqual([{ name: "Batman", squashed: "c0ffee" }, { name: "Robin" }, { name: "Superman" }]);
  });

  it("keeps, after a restart, which report's merge conflicted: no merge retries the agent fixing it (#12)", () => {
    const report = { summary: "ok", status: "termine", at: 7 };
    const member = { nodeId: "n", name: "Batman", task: "A", budgetMin: 1, linked: false, branch: "b", worktree: "w", report, conflictAt: 7 };
    const saved = readMission(JSON.parse(JSON.stringify({ state: "en_cours", members: [member, { ...member, nodeId: "m", name: "Robin", conflictAt: "7" }] })));
    expect(saved?.members.map((m) => m.conflictAt)).toEqual([7, undefined]);
    expect(conflictPending(saved!.members[0])).toBe(true);
  });

  it("names an agent's squash after its sub-task, its report and what it leaves to check as the body, never half a character", () => {
    const report = { summary: "  Login form done.\n\n# Notes\nTyped. ", status: "termine" as const, at: 1 };
    expect(squashMessage({ task: "Login\nform", report })).toBe("Login form\n\nLogin form done.\n\n# Notes\nTyped.");
    expect(squashMessage({ task: "Login", report: { ...report, check: "Try a wrong password" } })).toContain("\n\nTo check by hand: Try a wrong password");
    expect(squashMessage({ task: "Login" })).toBe("Login");
    expect(squashMessage({ task: "Login", report: { ...report, summary: "Shipped \uD83C" } })).toBe("Login\n\nShipped ");
  });

  it("keeps, after a restart, the agents a stop left behind: the cleanup still removes their worktrees", () => {
    expect(readMission({ state: "terminee", members: [], strays: ["Superman", 3, ""] })?.strays).toEqual(["Superman"]);
    expect(readMission({ state: "terminee", members: [] })).not.toHaveProperty("strays");
  });

  it("keeps, after a restart, the agent that handed a task over: the Fleet's mission status still names it", () => {
    const task = { title: "Docs", brief: "B", budgetMin: 1, handedBy: "Batman" };
    const saved = readMission(JSON.parse(JSON.stringify({ state: "en_cours", queue: [task], plan: [{ ...task, title: "API", agent: "nouveau" }], members: [] })));
    expect(saved?.queue).toEqual([task]);
    expect(saved?.plan).toEqual([{ ...task, title: "API", agent: "nouveau" }]);
  });
});

describe("a refused plan in English", () => {
  it("explains what is wrong in the interface's language", () => {
    try {
      expect(proposedPlan(args(task("Deadpool")), NEW_MISSION, ["Hulk"])).toBe('Sub-task 1: "Deadpool" is not a linked Claude agent (a first name, or "new").');
      expect(proposedPlan(args(task("nouveau", 0)), NEW_MISSION, [])).toBe("Sub-task 1: a budget in minutes (a whole number, 1 at least).");
      expect(proposedPlan(args(task("nouveau")), { ...NEW_MISSION, router: true }, [])).toBe("Sub-task 1: a level (low, medium, high or extreme) — the router chooses the agent's model with it.");
    } finally {
    }
  });
});

describe("each sub-task's level", () => {
  it("reads it as written; the router needs one per sub-task", () => {
    const leveled = proposedPlan(args({ ...task("nouveau"), niveau: "Élevé" }), NEW_MISSION, []);
    expect(typeof leveled === "object" && leveled.plan[0].level).toBe("eleve");
    const plain = proposedPlan(args(task("nouveau")), NEW_MISSION, []);
    expect(typeof plain === "object" && plain.plan[0]).toEqual({ title: "Login", brief: "Fais le login", agent: "nouveau", budgetMin: 20 });
    expect(proposedPlan(args(task("nouveau")), { ...NEW_MISSION, router: true }, [])).toContain("level");
    expect(proposedPlan(args({ ...task("nouveau"), niveau: "énorme" }), NEW_MISSION, [])).toContain("level");
  });

  it("reads the router, the levels and the members' models back", () => {
    const saved = {
      state: "en_cours",
      maxAgents: 4,
      router: true,
      plan: [{ title: "Login", brief: "b", agent: "nouveau", budgetMin: 5, level: "faible" }],
      members: [{ nodeId: "n1", name: "Batman", task: "Login", budgetMin: 5, linked: false, branch: "b", worktree: "w", model: "claude-haiku-5-5" }],
    };
    expect(readMission(saved)).toEqual(saved);
    expect(readMission({ ...saved, router: "oui", plan: [{ ...saved.plan[0], level: "x" }] })).toMatchObject({ plan: [{ title: "Login" }] });
    expect(readMission({ ...saved, router: "oui" })?.router).toBeUndefined();
    // A Fleet's switch set off is a veto for its mission: kept, not read as unset (which follows Settings).
    expect(readMission({ ...saved, router: false })?.router).toBe(false);
    expect(readMission({ ...saved, plan: [{ ...saved.plan[0], level: "x" }] })?.plan?.[0].level).toBeUndefined();
  });
});

describe("readMission", () => {
  it("reads a saved mission back; a launch cut short by a restart is back to its plan", () => {
    const saved = { state: "lancement", maxAgents: 3, name: "Auth", plan: [{ title: "Login", brief: "b", agent: "nouveau", budgetMin: 5 }], members: [] };
    expect(readMission(saved)).toEqual({ ...saved, state: "plan" });
    const member = { nodeId: "n1", name: "Batman", task: "Login", budgetMin: 5, linked: false, branch: "dummyplane/auth-batman", worktree: "C:/w", sentAt: 4, report: { summary: "ok", status: "termine", at: 9 } };
    expect(readMission({ state: "en_cours", maxAgents: 4, members: [member, { nodeId: 3 }] })?.members).toEqual([member]);
  });

  it("drops what is not a mission", () => {
    expect(readMission({ state: "partie" })).toBeUndefined();
    expect(readMission("x")).toBeUndefined();
  });
});

it("compares names case and accents aside, and keeps typed text on one line", () => {
  expect(sameName(" IRONMÁN", "ironman")).toBe(true);
  expect(sameName("Ironman", "Cyclops")).toBe(false);
  expect(oneLine("Fais ceci\r\n\n  puis cela ")).toBe("Fais ceci puis cela");
});

describe("the time of a mission", () => {
  const min = 60_000;
  const member = (extra: Partial<Member> = {}): Member => ({ nodeId: "n1", name: "Batman", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 0, ...extra });
  const running = (members: Member[], extra: Partial<Mission> = {}): Mission => ({ ...NEW_MISSION, state: "en_cours", name: "Auth", members, ...extra });

  it("counts a member's time from its sub-task to its report, its budget with its extensions", () => {
    expect(spentMin(member(), 6 * min)).toBe(6);
    expect(spentMin(member({ report: { summary: "ok", status: "termine", at: 4 * min } }), 9 * min)).toBe(4);
    expect(spentMin(member({ sentAt: undefined }), 9 * min)).toBe(0);
    expect(budgetOf(member({ extraMin: 5 }))).toBe(15);
  });

  it("stops a member's time when the mission ends", () => {
    const ended = running([member()], { state: "terminee", endedAt: 30 * min });
    expect(memberTime(ended, member(), 1440 * min)).toBe(30);
    expect(memberTime(running([member()]), member(), 9 * min)).toBe(9);
    const before = running([member()], { state: "terminee" });
    expect(memberTime(before, member(), 1440 * min)).toBeUndefined();
    expect(memberTime(before, member({ report: { summary: "ok", status: "termine", at: 6 * min } }), 1440 * min)).toBe(6);
    expect(readMission({ ...ended })?.endedAt).toBe(30 * min);
  });

  it("finds each overrun once per step, 100 % then 200 %, and the end of the night", () => {
    const report = { summary: "ok", status: "termine" as const, at: min };
    const mission = running(
      [member(), member({ nodeId: "n2", name: "Aquaman", overdue: 1 }), member({ nodeId: "n3", name: "Shazam", report }), member({ nodeId: "n4", name: "Cyborg", handedTo: "Aquaman" })],
      { overnight: true, budgetMin: 30, startedAt: 0 },
    );
    expect(overruns(mission, 11 * min)).toEqual({ members: [{ nodeId: "n1", name: "Batman", task: "Login", level: 1, budget: 10 }], global: false });
    expect(overruns(mission, 21 * min).members.map((o) => [o.nodeId, o.level])).toEqual([["n1", 2], ["n2", 2]]);
    expect(overruns(mission, 31 * min).global).toBe(true);
    expect(overruns({ ...mission, globalOverdue: true }, 31 * min).global).toBe(false);
    expect(overruns({ ...mission, state: "terminee" }, 31 * min)).toEqual({ members: [], global: false });
    // Without a night, no overall end comes.
    expect(overruns({ ...mission, overnight: undefined }, 31 * min).global).toBe(false);
  });

  it("counts the night in real time from the go-ahead, whatever the number of agents", () => {
    const team = [member(), member({ nodeId: "n2", extraMin: 5 }), member({ nodeId: "n3", handedTo: "Batman" })];
    const night = { overnight: true, budgetMin: 30 };
    expect(remainingGlobal(running(team, { ...night, startedAt: 0 }), 12 * min)).toBe(18);
    expect(remainingGlobal(running(team), 12 * min)).toBeUndefined();
    expect(remainingGlobal(running(team, night), 12 * min)).toBe(30);
    expect(remainingGlobal(running(team, { ...night, startedAt: 0 }), 40 * min)).toBe(0);
    expect(remainingGlobal(running(team, { ...night, state: "terminee", startedAt: 0, endedAt: 10 * min }), 25 * min)).toBe(20);
  });

  it("gives a regular mission no overall time: the old global budget, saved or not, counts for nothing", () => {
    const old = running([member()], { budgetMin: 30, startedAt: 0 });
    expect(nightMin(old)).toBeUndefined();
    expect(remainingGlobal(old, 40 * min)).toBeUndefined();
    expect(noNewWork(old, 40 * min)).toBe(false);
    expect(clockText(old, 40 * min)).toBe("40 min");
    expect(readMission({ state: "redaction", maxAgents: 4, budgetMin: 90 })).not.toHaveProperty("budgetMin");
    expect(readMission({ state: "en_cours", maxAgents: 4, overnight: true, budgetMin: 480 })?.budgetMin).toBe(480);
  });

  it("winds an overnight mission down near its end, at 10 % or 10 min, and half of a short one", () => {
    const night = (budgetMin: number) => running([member()], { overnight: true, budgetMin, startedAt: 0 });
    expect(windingDown(night(480), 431 * min)).toBe(false);
    expect(windingDown(night(480), 432 * min)).toBe(true);
    expect(windingDown(night(60), 49 * min)).toBe(false);
    expect(windingDown(night(60), 50 * min)).toBe(true);
    expect(windingDown(night(15), 7 * min)).toBe(false);
    expect(windingDown(night(15), 8 * min)).toBe(true);
    expect(windingDown(running([member()], { budgetMin: 60, startedAt: 0 }), 59 * min)).toBe(false);
  });

  it("keeps the overnight marks of a saved mission", () => {
    expect(readMission({ state: "en_cours", overnight: true, windDownTold: true, autoLaunch: true, tickets: { kind: "github", label: "nuit" } })).toMatchObject({ overnight: true, windDownTold: true, autoLaunch: true, tickets: { kind: "github", label: "nuit" } });
    expect(readMission({ state: "plan", tickets: { kind: "backlog" } })?.tickets).toEqual({ kind: "backlog" });
    expect(readMission({ state: "plan", tickets: { kind: "kanban" } })).not.toHaveProperty("tickets");
    expect(readMission({ state: "plan", tickets: { kind: "linear", team: "ENG", label: "nuit" } })?.tickets).toEqual({ kind: "linear", team: "ENG", label: "nuit" });
    expect(readMission({ state: "plan", tickets: { kind: "linear", label: "nuit" } })).not.toHaveProperty("tickets");
    expect(readMission({ state: "en_cours" })).not.toHaveProperty("overnight");
  });

  it("colours a budget's bar: green, orange past 80 %, red past 100 %", () => {
    expect(budgetBar(4, 10)).toEqual({ ratio: 0.4, tone: "ok" });
    expect(budgetBar(9, 10)).toEqual({ ratio: 0.9, tone: "late" });
    expect(budgetBar(25, 10)).toEqual({ ratio: 1, tone: "over" });
  });

  it("completes the bar of a member that reported, in the tone of its report, whatever its time", () => {
    expect(budgetBar(22, 50, "termine")).toEqual({ ratio: 1, tone: "ok" });
    expect(budgetBar(22, 50, "bloque")).toEqual({ ratio: 1, tone: "late" });
    expect(budgetBar(22, 50, "echec")).toEqual({ ratio: 1, tone: "over" });
    expect(budgetBar(0, 0, "termine")).toEqual({ ratio: 1, tone: "ok" });
    // Even past its budget a done member is done, not over.
    expect(budgetBar(80, 50, "termine")).toEqual({ ratio: 1, tone: "ok" });
  });

  it("writes the mission's time for the fleet's header", () => {
    expect(clockText(running([], { startedAt: 0, overnight: true, budgetMin: 60 }), 12.4 * min)).toBe("12 / 60 min");
    expect(clockText(running([], { startedAt: 0 }), 3 * min)).toBe("3 min");
    expect(clockText({ ...NEW_MISSION }, 3 * min)).toBeNull();
  });

  it("reads the time fields back", () => {
    const saved = { state: "en_cours", maxAgents: 4, startedAt: 5, globalOverdue: true, members: [{ ...member(), extraMin: 5, overdue: 2, handedTo: "Aquaman", done: ["API"] }] };
    expect(readMission(saved)).toEqual(saved);
  });
});

it("keeps a finished mission's summary as the fleet wrote it in OpenUI Lang, beside its text", () => {
  const ui = 'root = Stack([Text("All done")])';
  const saved = readMission({ ...NEW_MISSION, state: "terminee", summary: "All done", summaryUi: ui })!;
  expect(saved.summary).toBe("All done");
  expect(saved.summaryUi).toBe(ui);
  expect(readMission({ ...NEW_MISSION, state: "terminee", summaryUi: 3 })!.summaryUi).toBeUndefined();
});
