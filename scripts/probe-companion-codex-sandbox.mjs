/** Opt-in native permission assay. No model, personal file read, account change,
 * installed app or native task/session adoption. Only owned disposable files. */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const executable = process.argv[2];
if (!executable || !path.isAbsolute(executable)) throw new Error("Pass an exact installed Codex executable.");
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "polyphonic-codex-sandbox-")));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { mode: 0o700 });
await fs.writeFile(path.join(workspace, "allowed.txt"), "INSIDE_DISPOSABLE_SCOPE", { mode: 0o600 });
await fs.writeFile(path.join(root, "outside.txt"), "OUTSIDE_DISPOSABLE_SCOPE", { mode: 0o600 });
const profile = "polyphonic-companion-probe";
const args = ["app-server", "--listen", "stdio://",
  "-c", `permissions.${profile}.filesystem={\":root\"=\"deny\",\":minimal\"=\"read\",${JSON.stringify(workspace)}=\"write\"}`,
  "-c", `permissions.${profile}.network.enabled=false`,
  "-c", "approval_policy=\"never\"",
  "-c", "shell_environment_policy.inherit=\"none\"",
  "-c", "shell_environment_policy.ignore_default_excludes=false",
  "-c", "allow_login_shell=false"];
const child = spawn(executable, args, { cwd: workspace, stdio: ["pipe", "pipe", "ignore"], detached: true });
const pending = new Map();
let sequence = 0;
let carry = "";
let failed = false;
let exited = false;
const exit = new Promise((resolve) => child.once("exit", () => { exited = true; resolve(); }));
const abort = () => {
  failed = true;
  for (const waiter of pending.values()) waiter.reject(new Error("Native protocol unavailable."));
  pending.clear();
};
child.once("error", abort);
child.once("exit", abort);
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  carry += chunk;
  if (Buffer.byteLength(carry) > 2 * 1024 * 1024) { abort(); return; }
  let end;
  while ((end = carry.indexOf("\n")) >= 0) {
    const line = carry.slice(0, end); carry = carry.slice(end + 1);
    let value;
    try { value = JSON.parse(line); } catch { abort(); return; }
    if (typeof value.id === "number" && pending.has(value.id)) {
      const waiter = pending.get(value.id); pending.delete(value.id);
      if (value.error) waiter.reject(new Error(`Native request rejected (${value.error.code ?? "unknown"}).`));
      else waiter.resolve(value.result);
    } else if (value.id !== undefined && value.method) {
      // No approvals, dynamic tools, external calls or permission widening.
      child.stdin.write(`${JSON.stringify({ id: value.id, error: { code: -32601, message: "Unsupported in the disposable assay." } })}\n`);
    }
  }
});
function call(method, params) {
  if (failed || exited) return Promise.reject(new Error("Native worker unavailable."));
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Native request timed out.")); }, 15_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
      if (error) { const waiter = pending.get(id); pending.delete(id); waiter?.reject(new Error("Native frame unavailable.")); }
    });
  });
}
const options = (command) => ({ command, cwd: workspace, permissionProfile: profile, timeoutMs: 5000, outputBytesCap: 4096 });
try {
  await call("initialize", { clientInfo: { name: "polyphonic_companion_permission_assay", title: "Polyphonic permission assay", version: "0.5.0-beta.13" }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  const config = await call("config/read", { cwd: workspace, includeLayers: false });
  console.log(JSON.stringify({ nativeConfigShape: {
    mcpNamesAvailable: typeof config.config?.mcp_servers === "object",
    pluginNamesAvailable: typeof config.config?.plugins === "object",
    featuresAvailable: typeof config.config?.features === "object",
    keyNames: Object.keys(config.config ?? {}).filter((name) => /mcp|plugin|hook|feature|model|browser|computer/.test(name))
  } }));
  const profiles = await call("permissionProfile/list", { cwd: workspace, limit: 100 });
  if (!profiles.data?.some((value) => value.id === profile && value.allowed === true)) throw new Error("Named scope not available.");
  const inside = await call("command/exec", options(["/bin/cat", path.join(workspace, "allowed.txt")]));
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "INSIDE_DISPOSABLE_SCOPE") throw new Error("Allowed sentinel could not be read.");
  const outside = await call("command/exec", options(["/bin/cat", path.join(root, "outside.txt")]));
  if (outside.exitCode === 0 || outside.stdout.includes("OUTSIDE_DISPOSABLE_SCOPE")) throw new Error("Outside sentinel was readable.");
  const written = await call("command/exec", options(["/bin/sh", "-c", "printf '%s' OWNED_SCOPE_WRITE > written.txt"]));
  if (written.exitCode !== 0 || await fs.readFile(path.join(workspace, "written.txt"), "utf8") !== "OWNED_SCOPE_WRITE") throw new Error("Owned scratch write failed.");
  const forbidden = await call("command/exec", options(["/bin/sh", "-c", "printf '%s' DENIED > ../forbidden.txt"]));
  if (forbidden.exitCode === 0 || await fs.access(path.join(root, "forbidden.txt")).then(() => true, () => false)) throw new Error("Outside scratch write was possible.");
  console.log(JSON.stringify({ profileAdvertised: true, insideRead: true, outsideReadDenied: true, scratchWrite: true, outsideWriteDenied: true, modelInvoked: false }));
} finally {
  abort();
  if (!exited && child.pid) {
    try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (!exited) { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } await exit; }
  }
  // This exact generated directory is never a source, native profile or cache.
  if (!exited) throw new Error("Owned native worker was not reaped.");
  await fs.rm(root, { recursive: true });
}
