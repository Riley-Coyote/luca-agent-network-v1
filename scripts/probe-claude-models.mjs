// Read-only ACP catalog + exact-selection acceptance. No prompt is sent.
// Usage: node scripts/probe-claude-models.mjs /absolute/adapter/dist/index.js
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import assert from "node:assert/strict";
const index = resolve(process.argv[2]);
const bridge = pathToFileURL(
  resolve("desktop/src-tauri/src/managed_agents/claude_model_bridge.mjs"),
).href;
const agent = pathToFileURL(resolve(dirname(index), "acp-agent.js")).href;
const program = `import {installModelBridge} from ${JSON.stringify(bridge)}; const m=await import(${JSON.stringify(agent)}); installModelBridge(m.ClaudeAcpAgent); await import(${JSON.stringify(pathToFileURL(index).href)});`;
const child = spawn(process.execPath, ["--input-type=module", "-e", program], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});
const waiting = new Map();
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    const cb = waiting.get(msg.id);
    if (cb) {
      waiting.delete(msg.id);
      msg.error
        ? cb.reject(new Error(JSON.stringify(msg.error)))
        : cb.resolve(msg.result);
    }
  } catch {}
});
child.stderr.on("data", () => {}); // Do not print native logs or environment.
let id = 0;
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, { resolve, reject });
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n",
    );
  });
}
const timer = setTimeout(() => {
  child.kill();
  throw new Error("Claude catalog probe timed out");
}, 60000);
try {
  await rpc("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "polyphonic-model-check", version: "1" },
  });
  const s = await rpc("session/new", { cwd: homedir(), mcpServers: [] });
  const option = s.configOptions.find((o) => o.category === "model");
  console.log("Models:", option.options.map((o) => o.name).join(", "));
  for (const value of [
    "claude-opus-4-6",
    "claude-fable-5",
    "claude-fable-5-1",
  ]) {
    assert(option.options.some((o) => o.value === value));
    const result = await rpc("session/set_config_option", {
      sessionId: s.sessionId,
      configId: option.id,
      value,
    });
    assert.equal(
      result.configOptions.find((o) => o.category === "model").currentValue,
      value,
    );
    console.log("Exact selection confirmed:", value);
  }
} finally {
  clearTimeout(timer);
  child.stdin.end();
  lines.close();
}
