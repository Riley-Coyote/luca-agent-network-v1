// The longest main-thread tasks during ONE nav transition, broken down by
// what the engine did inside them (script, style, layout, paint…). This is
// the instrument for "which frame dropped, and why". Not a test.
//   node --experimental-strip-types --import ./test-loader.mjs scripts/_nav-frames.mjs <scenario>
// scenarios: column-open-room | column-open-project | column-close |
//            navigator-enter | rail-collapse | rail-expand
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { installMockBridge } from "../tests/helpers/bridge.ts";

const scenario = process.argv[2] ?? "column-open-room";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const OUT =
  "/private/tmp/claude-501/-Users-rileycoyote-Documents-Repositories/3c5ae494-c727-4cb9-b15e-f33b57f18251/scratchpad/nav-trace";
fs.mkdirSync(OUT, { recursive: true });
const WINDOW_MS = 900;
const TASK_FLOOR_MS = Number(process.env.FLOOR ?? 8);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await installMockBridge(page, {
  managedAgents: [
    { name: "Atlas", pubkey: "a".repeat(64), status: "running" },
    { name: "Bex", pubkey: "b".repeat(64), status: "running" },
  ],
});
await page.goto(`${BASE}/?e2e=mock&projectDemo=1`, {
  waitUntil: "networkidle",
});

const toggle = () =>
  page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
const openDeepHistory = async () => {
  await page.getByTestId("project-row-luca").click();
  await page
    .getByTestId("project-room-navigator")
    .getByRole("button", { name: /deep-history/i })
    .click();
};
const setups = {
  "column-open-room": () => page.getByTestId("channel-watercooler").click(),
  "column-open-project": openDeepHistory,
  "column-close": async () => {
    await page.getByTestId("channel-watercooler").click();
    await page.getByTestId("agent-rail-atlas").click();
  },
  "navigator-enter": () => page.getByTestId("project-row-field-unit").click(),
  "rail-collapse": openDeepHistory,
  "rail-expand": async () => {
    await openDeepHistory();
    await toggle();
  },
};
const actions = {
  "column-open-room": () => page.getByTestId("agent-rail-atlas").click(),
  "column-open-project": () => page.getByTestId("agent-rail-atlas").click(),
  "column-close": () => page.getByTestId("agent-rail-atlas").click(),
  "navigator-enter": () => page.getByTestId("project-row-luca").click(),
  "rail-collapse": toggle,
  "rail-expand": toggle,
};
if (!setups[scenario]) throw new Error(`unknown scenario ${scenario}`);
await setups[scenario]();
await page.waitForTimeout(3000);

await browser.startTracing(page, {
  categories: [
    "toplevel",
    "devtools.timeline",
    "disabled-by-default-devtools.timeline",
    "blink.user_timing",
    "v8.execute",
  ],
});
await actions[scenario]();
await page.waitForTimeout(WINDOW_MS);
const buffer = await browser.stopTracing();
fs.writeFileSync(`${OUT}/${scenario}.trace.json`, buffer);
const { traceEvents } = JSON.parse(buffer.toString());

// The renderer main thread is the one that names itself so.
const mainThreads = new Set(
  traceEvents
    .filter(
      (e) =>
        e.ph === "M" &&
        e.name === "thread_name" &&
        e.args?.name === "CrRendererMain",
    )
    .map((e) => `${e.pid}:${e.tid}`),
);
const complete = traceEvents
  .filter(
    (e) => e.ph === "X" && mainThreads.has(`${e.pid}:${e.tid}`) && e.dur > 0,
  )
  .sort((a, b) => a.ts - b.ts || b.dur - a.dur);

const isTask = (e) =>
  e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask";
const seen = new Set();
// RunTask nests inside ThreadControllerImpl::RunTask at the same instant; keep one.
const tasks = complete
  .filter(isTask)
  .filter((t) => (seen.has(t.ts) ? false : (seen.add(t.ts), true)))
  .sort((a, b) => b.dur - a.dur);
const topTasks = tasks.filter((t) => t.dur / 1000 >= TASK_FLOOR_MS).slice(0, 4);

function breakdown(task) {
  const inside = complete.filter(
    (e) => !isTask(e) && e.ts >= task.ts && e.ts + e.dur <= task.ts + task.dur,
  );
  // Self time: each event minus its direct children (stack over ts order).
  const stack = [];
  const selfByName = new Map();
  for (const e of inside) {
    while (
      stack.length &&
      stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts
    ) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.childDur = (parent.childDur ?? 0) + e.dur;
    stack.push(e);
  }
  for (const e of inside) {
    const self = e.dur - (e.childDur ?? 0);
    if (self <= 0) continue;
    const label =
      e.name === "FunctionCall" ||
      e.name === "EventDispatch" ||
      e.name === "TimerFire" ||
      e.name === "FireAnimationFrame"
        ? `${e.name}${e.args?.data?.type ? ` (${e.args.data.type})` : ""}`
        : e.name;
    selfByName.set(label, (selfByName.get(label) ?? 0) + self);
  }
  const accounted = [...selfByName.values()].reduce((a, b) => a + b, 0);
  selfByName.set(
    "(task self / unattributed)",
    Math.max(0, task.dur - accounted),
  );
  return [...selfByName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(
      ([name, us]) => `      ${(us / 1000).toFixed(1).padStart(6)} ms  ${name}`,
    )
    .join("\n");
}

const t0 = complete[0]?.ts ?? 0;
console.log(
  `SCENARIO ${scenario} — main-thread tasks ≥ ${TASK_FLOOR_MS} ms in a ${WINDOW_MS} ms window: ${tasks.filter((t) => t.dur / 1000 >= TASK_FLOOR_MS).length}`,
);
for (const task of topTasks) {
  console.log(
    `  task ${(task.dur / 1000).toFixed(1)} ms at +${((task.ts - t0) / 1000).toFixed(0)} ms`,
  );
  console.log(breakdown(task));
}
await browser.close();
