#!/usr/bin/env node
// Deterministic standalone ACP-host comparison. Never launches desktop apps,
// contacts a real provider, discovers native sessions, or changes native state.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { execFileSync, spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const BASE = "f84aaafa53386f213b832441983838b23c32c745";
const SESSION = "synthetic-performance-session";
const FINAL = "SYNTHETIC_PERFORMANCE_FINAL";
const FAKE_WAIT_MS = 160;
const SELF = fileURLToPath(import.meta.url);

// One shared fake ACP implementation is used by both source revisions. Its
// stage timestamps use the same machine's wall clock (1ms resolution); host
// lifetime measurements use a monotonic clock in the parent. No model runs.
async function fakeAdapter(folder) {
  assert.equal(path.basename(folder).startsWith("sample-"), true);
  const telemetry = path.join(folder, "fake-stages.jsonl");
  const stamp = (stage) =>
    fs.appendFileSync(
      telemetry,
      `${JSON.stringify({ stage, timeMs: Date.now() })}\n`,
      { mode: 0o600 },
    );
  const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  stamp("adapter_started");
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    const request = JSON.parse(line);
    if (request.id === undefined) continue;
    if (request.method === "initialize") {
      stamp("initialize_received");
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: { protocolVersion: 2, agentCapabilities: {} },
      });
    } else if (request.method === "session/new") {
      assert.equal(request.params.cwd, folder);
      stamp("session_response_emitted");
      send({ jsonrpc: "2.0", id: request.id, result: { sessionId: SESSION } });
    } else if (request.method === "session/prompt") {
      assert.equal(request.params.sessionId, SESSION);
      stamp("prompt_received");
      stamp("planning_update_emitted");
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: SESSION, update: { sessionUpdate: "plan" } },
      });
      await new Promise((resolve) => setTimeout(resolve, FAKE_WAIT_MS));
      stamp("message_update_emitted");
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: SESSION,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: FINAL },
          },
        },
      });
      stamp("completion_response_emitted");
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: { stopReason: "end_turn" },
      });
    } else if (request.method === "shutdown") {
      send({ jsonrpc: "2.0", id: request.id, result: null });
      break;
    } else {
      // The fixture must not silently approve input/permissions or invent
      // capability support if the runner's protocol changes unexpectedly.
      send({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32601,
          message: "Synthetic fixture does not support this method",
        },
      });
    }
  }
}

function regularFile(file) {
  assert.equal(path.isAbsolute(file), true, "binary must be absolute");
  assert.equal(fs.realpathSync(file), file, "symlinked binary path refused");
  const stat = fs.lstatSync(file);
  assert.equal(stat.isFile() && !stat.isSymbolicLink(), true);
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sourceReceipt(folder, expectedBase) {
  assert.equal(
    path.isAbsolute(folder) && fs.realpathSync(folder) === folder,
    true,
  );
  const git = (...args) =>
    execFileSync("git", ["-C", folder, ...args], { encoding: "utf8" }).trim();
  const revision = git("rev-parse", "HEAD");
  if (expectedBase)
    assert.equal(revision, BASE, "baseline must be exact beta.13");
  else git("merge-base", "--is-ancestor", BASE, "HEAD");
  assert.equal(
    git("status", "--porcelain", "--untracked-files=all"),
    "",
    "freeze source before measuring",
  );
  const modules = path.join(folder, "desktop/node_modules");
  if (fs.existsSync(modules))
    assert.equal(
      fs.lstatSync(modules).isSymbolicLink(),
      false,
      "shared/symlinked node_modules refused",
    );
  return { revision, sourceFolder: folder };
}

function processTree(rootPid) {
  const rows = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,%cpu=,rss="], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const owned = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, ppid] of rows)
      if (owned.has(ppid) && !owned.has(pid)) {
        owned.add(pid);
        changed = true;
      }
  }
  const selected = rows.filter(([pid]) => owned.has(pid));
  return {
    timeMs: Date.now(),
    count: selected.length,
    cpuPercent: selected.reduce((sum, row) => sum + row[2], 0),
    rssKiB: selected.reduce((sum, row) => sum + row[3], 0),
  };
}

async function sample(binary, folder) {
  fs.mkdirSync(folder, { mode: 0o700 });
  const purpose = path.join(folder, "purpose.jsonl");
  fs.writeFileSync(purpose, "", { mode: 0o600, flag: "wx" });
  assert.equal(
    SELF.includes(",") || folder.includes(","),
    false,
    "ACP comma-delimited argument path is unsupported",
  );
  const startedMonotonic = performance.now();
  const startedWall = Date.now();
  const child = spawn(
    binary,
    [
      "runtime-task",
      "--agent-command",
      process.execPath,
      `--agent-args=${SELF},--fake-acp,${folder}`,
      "--idle-timeout-secs",
      "30",
      "--max-duration-secs",
      "60",
    ],
    {
      cwd: folder,
      // Deliberately do not inherit credentials, runtime overrides, provider
      // authentication, MCP bootstrap, renderer IPC or native-profile env.
      env: {
        PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
        LANG: "C",
        LUCA_RUNTIME_SESSION_PURPOSE_STORE: purpose,
        LUCA_MANAGED_RUNTIME_FAMILY: "codex",
        LUCA_MANAGED_RESIDENT_PUBKEY: "a".repeat(64),
        LUCA_MANAGED_BINDING_REF: "synthetic-performance-binding",
        LUCA_MANAGED_SESSION_EPOCH: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const events = [];
  const resources = [];
  let stderrBytes = 0;
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
  });
  let readingError = null;
  const reading = (async () => {
    for await (const line of createInterface({ input: child.stdout })) {
      assert.equal(
        line.length <= 128 * 1024,
        true,
        "unbounded runner output refused",
      );
      events.push({
        ...JSON.parse(line),
        receivedMs: Date.now(),
        receivedElapsedMs: performance.now() - startedMonotonic,
      });
      assert.equal(events.length <= 16, true, "unexpected event volume");
    }
  })().catch((error) => {
    readingError = error;
    child.kill("SIGTERM");
  });
  const timer = setInterval(() => {
    if (child.pid) resources.push(processTree(child.pid));
  }, 80);
  timer.unref();
  // The timeout addresses only the child created above. It never discovers
  // or signals a provider, app, process group, or unrelated native session.
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, 12_000);
  timeout.unref();
  const hardBound = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }, 17_000);
  hardBound.unref();
  child.stdin.end(
    JSON.stringify({
      taskId: "task:performance",
      conversationId: "conversation:performance",
      prompt: "SYNTHETIC_PERFORMANCE_PROMPT",
      workingFolder: folder,
      permissionMode: "normal",
    }),
  );
  const exit = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      resolve({
        code,
        signal,
        elapsedMs: performance.now() - startedMonotonic,
      }),
    );
  });
  clearInterval(timer);
  clearTimeout(timeout);
  clearTimeout(hardBound);
  await reading;
  if (readingError) throw readingError;
  assert.deepEqual(
    { code: exit.code, signal: exit.signal },
    { code: 0, signal: null },
    "runner failed or exceeded bound",
  );
  const stages = fs
    .readFileSync(path.join(folder, "fake-stages.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const at = (stage) => {
    const found = stages.find((item) => item.stage === stage);
    assert.ok(found, `missing fake stage ${stage}`);
    return found.timeMs;
  };
  const event = (kind, label) => {
    const found = events.find(
      (item) =>
        item.kind === kind && (label === undefined || item.label === label),
    );
    assert.ok(found, `missing native host event ${kind}`);
    assert.equal(found.protocol, "polyphonic.runtime-task.v1");
    return found;
  };
  const session = event("session");
  const planning = event("step", "Planning the work");
  const result = event("result");
  assert.equal(session.providerSessionId, SESSION);
  assert.equal(result.result, FINAL);
  assert.equal(result.stopReason, "end_turn");
  assert.equal(events.filter((item) => item.kind === "result").length, 1);
  const actualFakeWorkMs =
    at("completion_response_emitted") - at("prompt_received");
  const metrics = {
    spawnToSessionMs: session.receivedElapsedMs,
    fakeAdapterStartupMs: at("adapter_started") - startedWall,
    sessionResponseToHostMs:
      session.receivedMs - at("session_response_emitted"),
    planningProgressPipeDelayMs:
      planning.receivedMs - at("planning_update_emitted"),
    providerCompletionToHostResultMs:
      result.receivedMs - at("completion_response_emitted"),
    actualFakeWorkMs,
    hostResultElapsedMinusFakeWorkMs:
      result.receivedElapsedMs - actualFakeWorkMs,
    ownedRunnerExitMs: exit.elapsedMs,
    sampledPeakDescendantsIncludingHost: Math.max(
      0,
      ...resources.map((item) => item.count),
    ),
    sampledPeakCpuPercent: Math.max(
      0,
      ...resources.map((item) => item.cpuPercent),
    ),
    sampledPeakRssKiB: Math.max(0, ...resources.map((item) => item.rssKiB)),
  };
  fs.writeFileSync(
    path.join(folder, "sample.json"),
    JSON.stringify(
      { metrics, events, stages, resources, stderrBytes },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  return metrics;
}

function summary(samples) {
  return Object.fromEntries(
    Object.keys(samples[0]).map((key) => {
      const values = samples.map((item) => item[key]).sort((a, b) => a - b);
      return [
        key,
        {
          median:
            (values[Math.floor((values.length - 1) / 2)] +
              values[Math.floor(values.length / 2)]) /
            2,
          p95: values[Math.ceil(values.length * 0.95) - 1],
          min: values[0],
          max: values.at(-1),
          samples: values,
        },
      ];
    }),
  );
}

async function compare(args) {
  assert.equal(args.length % 2, 0, "use flag/value pairs");
  const options = Object.fromEntries(
    Array.from({ length: args.length / 2 }, (_, index) => [
      args[index * 2],
      args[index * 2 + 1],
    ]),
  );
  const allowed = [
    "--baseline-binary",
    "--candidate-binary",
    "--baseline-source",
    "--candidate-source",
    "--output-parent",
    "--runs",
  ];
  assert.ok(
    Object.keys(options).every((key) => allowed.includes(key)),
    "unknown flag",
  );
  const runs = Number(options["--runs"] ?? 10);
  assert.equal(
    Number.isSafeInteger(runs) && runs >= 3 && runs <= 30,
    true,
    "runs must be 3..30",
  );
  const lanes = {
    baseline: {
      ...sourceReceipt(options["--baseline-source"], true),
      binary: options["--baseline-binary"],
    },
    candidate: {
      ...sourceReceipt(options["--candidate-source"], false),
      binary: options["--candidate-binary"],
    },
  };
  for (const lane of Object.values(lanes))
    lane.binarySha256 = regularFile(lane.binary);
  const parent = options["--output-parent"];
  assert.equal(
    path.isAbsolute(parent) &&
      fs.realpathSync(parent) === parent &&
      fs.statSync(parent).isDirectory(),
    true,
  );
  const root = fs.mkdtempSync(path.join(parent, "companion-overhead-"));
  const rows = { baseline: [], candidate: [] };
  const order = [];
  // Two warm-ups are recorded separately. AB/BA ordering avoids making cache
  // warmth or gradual background-load drift synonymous with one revision.
  for (let round = -1; round < runs; round += 1) {
    const names =
      round % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"];
    for (const name of names) {
      order.push({ round, name });
      const metrics = await sample(
        lanes[name].binary,
        path.join(root, `sample-${round < 0 ? "warmup" : round}-${name}`),
      );
      if (round >= 0) rows[name].push(metrics);
    }
  }
  const summaries = {
    baseline: summary(rows.baseline),
    candidate: summary(rows.candidate),
  };
  const report = {
    protocol: "polyphonic.companion-overhead-comparison.v1",
    source: lanes,
    environment: {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      machine: os.cpus()[0]?.model,
      node: process.version,
    },
    fixture: {
      scriptSha256: regularFile(SELF),
      fakeWorkScheduledMs: FAKE_WAIT_MS,
      runsPerLane: runs,
      measuredConcurrency: 1,
      timestampResolutionMs: 1,
      order,
    },
    boundaries: {
      measured:
        "Standalone native ACP task-host startup, safe progress JSON-pipe delivery, completion/cleanup and sampled host+fake-adapter resources",
      notMeasured: [
        "Tauri renderer IPC",
        "desktop catalogue reads",
        "GUI settled idle CPU/RSS",
        "WebKit/XPC resources",
        "native model/provider latency",
        "companion synthesis/result publication",
      ],
      sourceBinaryProvenance:
        "Retain executor's exact-source build logs and these binary hashes; source checkout identity alone does not prove binary freshness",
      fakeStartupIncluded:
        "Node adapter startup is identical fixture overhead, not a real harness latency estimate",
      cpuSampleSemantics:
        "ps lifetime-averaged CPU and 80ms sampled peaks during runner activity; not interval CPU or idle certification",
    },
    summaries,
    medianCandidateMinusBaseline: Object.fromEntries(
      Object.keys(summaries.baseline).map((key) => [
        key,
        summaries.candidate[key].median - summaries.baseline[key].median,
      ]),
    ),
  };
  fs.writeFileSync(
    path.join(root, "comparison.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  process.stdout.write(`${path.join(root, "comparison.json")}\n`);
}

if (process.argv[2] === "--fake-acp") await fakeAdapter(process.argv[3]);
else if (process.argv.length === 2 || process.argv[2] === "--help")
  process.stdout.write(
    "Usage: node scripts/compare-companion-overhead.mjs --baseline-binary /exact/beta13/buzz-acp --candidate-binary /exact/candidate/buzz-acp --baseline-source /clean/exact/base --candidate-source /clean/feature --output-parent /canonical/existing/dedicated-parent [--runs 10]\nNo desktop, native providers, model calls, personal sessions, shared dependencies or configuration changes. Main owns execution.\n",
  );
else await compare(process.argv.slice(2));
