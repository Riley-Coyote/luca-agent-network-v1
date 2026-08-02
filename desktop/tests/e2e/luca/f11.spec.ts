import { expect, test } from "@playwright/test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { hexToBytes } from "@noble/hashes/utils.js";
import { nsecEncode } from "nostr-tools/nip19";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const APP_BUNDLE =
  process.env.LUCA_F11_NATIVE_APP ??
  join(REPO_ROOT, "desktop/src-tauri/target/debug/bundle/macos/Luca.app");
const APP_EXECUTABLE = join(APP_BUNDLE, "Contents/MacOS/buzz-desktop");
const EVIDENCE_ROOT = join(REPO_ROOT, "evidence/M1/F11");
const OUTPUTS_ROOT = join(EVIDENCE_ROOT, "outputs");
const SCREENSHOTS_ROOT = join(EVIDENCE_ROOT, "screenshots");

type NativeLaunch = {
  appBundle: string;
  appExecutable: string;
  home: string;
  keyringService: string;
  pid: number;
  stderrPath: string;
  stdoutPath: string;
};

const launches = new Set<number>();
const consoleEvidence: Array<{
  phase: string;
  stream: "harness" | "stderr" | "stdout";
  text: string;
}> = [];
const screenshotEvidence: Array<{
  phase: string;
  path: string;
}> = [];

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function shell(command: string, args: string[] = []) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sleep(milliseconds: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function liveNativePids(appExecutable: string) {
  const rows = shell("ps", ["-axo", "pid=,command="])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return rows.flatMap((row) => {
    const match = row.match(/^(\d+)\s+(.+)$/);
    if (!match || match[2] !== appExecutable) return [];
    return [Number(match[1])];
  });
}

function appleScript(pid: number, statement: string) {
  return shell("osascript", [
    "-e",
    `tell application "System Events" to tell first application process whose unix id is ${pid} to ${statement}`,
  ]);
}

function accessibilityTree(pid: number) {
  return appleScript(pid, "get entire contents of first window");
}

async function waitForTree(
  pid: number,
  predicate: (tree: string) => boolean,
  description: string,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastTree = "";
  while (Date.now() < deadline) {
    try {
      lastTree = accessibilityTree(pid);
      if (predicate(lastTree)) return lastTree;
    } catch {
      // The AX tree is not available until the first real WKWebView commit.
    }
    await sleep(250);
  }
  throw new Error(
    `Timed out waiting for native UI: ${description}. Last AX tree: ${lastTree.slice(0, 4_000)}`,
  );
}

async function waitForText(pid: number, text: string, timeoutMs?: number) {
  return waitForTree(
    pid,
    (tree) => tree.includes(text),
    JSON.stringify(text),
    timeoutMs,
  );
}

function clickButton(pid: number, name: string) {
  const escapedName = name.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return appleScript(
    pid,
    `click button "${escapedName}" of UI element 1 of scroll area 1 of group 1 of group 1 of window 1`,
  );
}

function typeGeneratedRecoveryKey(pid: number) {
  const nsec = nsecEncode(hexToBytes("01".repeat(32)));
  appleScript(
    pid,
    'click text field "Private key" of group 2 of UI element 1 of scroll area 1 of group 1 of group 1 of window 1',
  );
  const escapedNsec = nsec.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  appleScript(pid, `keystroke "${escapedNsec}"`);
}

function assertNoPublicSetupSurface(tree: string) {
  expect(tree).not.toContain("static text BUZZ");
  expect(tree).not.toMatch(
    /join a community|create a community|community setup|workspace setup|organization setup|invite setup|relay url/i,
  );
}

function sanitizeLog(text: string) {
  return text
    .replace(/\b[0-9a-f]{64}\b/gi, "[redacted-pubkey]")
    .replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:[port]")
    .replaceAll(/\/private\/var\/folders\/[^\s]+/g, "[isolated-temp]")
    .replaceAll(/\/tmp\/luca-f11-[^\s]+/g, "[isolated-temp]")
    .trim();
}

function recordLaunchLogs(phase: string, launch: NativeLaunch) {
  for (const [stream, path] of [
    ["stdout", launch.stdoutPath],
    ["stderr", launch.stderrPath],
  ] as const) {
    if (!existsSync(path)) continue;
    const text = sanitizeLog(readFileSync(path, "utf8"));
    if (text) consoleEvidence.push({ phase, stream, text });
  }
}

function createRuntimeDiscoveryFixtures(root: string) {
  const binDir = join(root, "runtime-bin");
  mkdirSync(binDir, { recursive: true });
  const codexAcp = join(binDir, "codex-acp");
  const codex = join(binDir, "codex");
  writeFileSync(
    codexAcp,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "codex-acp 1.0.0"\nfi\nexit 0\n',
    "utf8",
  );
  writeFileSync(
    codex,
    '#!/bin/sh\nif [ "$1" = "login" ] && [ "$2" = "status" ]; then\n  echo "Logged in using F11 generated fixture"\nfi\nexit 0\n',
    "utf8",
  );
  chmodSync(codexAcp, 0o700);
  chmodSync(codex, 0o700);
  return binDir;
}

async function launchNative(
  root: string,
  phase: string,
  runtimeBin: string,
  failProvisioning = false,
  reuse?: Pick<
    NativeLaunch,
    "appBundle" | "appExecutable" | "home" | "keyringService"
  >,
) {
  const appBundle = reuse?.appBundle ?? join(root, `${phase}-Luca.app`);
  let appExecutable = join(appBundle, "Contents/MacOS/buzz-desktop");
  if (!reuse) {
    shell("cp", ["-cR", APP_BUNDLE, appBundle]);
    shell("/usr/libexec/PlistBuddy", [
      "-c",
      `Set :CFBundleIdentifier com.luca.agent-network.f11.${randomUUID()}`,
      join(appBundle, "Contents/Info.plist"),
    ]);
  }
  appExecutable = realpathSync(appExecutable);
  const home = reuse?.home ?? join(root, `${phase}-home`);
  mkdirSync(home, { recursive: true });
  const keyringService =
    reuse?.keyringService ?? `buzz-desktop-dev.f11-${randomUUID()}`;
  const stdoutPath = join(root, `${phase}.stdout.log`);
  const stderrPath = join(root, `${phase}.stderr.log`);
  const before = new Set(liveNativePids(appExecutable));
  const args = [
    "-n",
    "-F",
    "--env",
    `HOME=${home}`,
    "--env",
    `PATH=${runtimeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    "--env",
    `BUZZ_DEV_KEYRING_SERVICE=${keyringService}`,
    "--env",
    "RUST_LOG=info",
  ];
  if (failProvisioning) {
    args.push("--env", "LUCA_TEST_FAIL_PERSONAL_HOME_PROVISIONING=1");
  }
  args.push("--stdout", stdoutPath, "--stderr", stderrPath, appBundle);
  const launchEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: `${runtimeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    BUZZ_DEV_KEYRING_SERVICE: keyringService,
    ...(failProvisioning
      ? { LUCA_TEST_FAIL_PERSONAL_HOME_PROVISIONING: "1" }
      : {}),
  };
  if (!failProvisioning) {
    delete launchEnv.LUCA_TEST_FAIL_PERSONAL_HOME_PROVISIONING;
  }
  execFileSync("open", args, {
    env: launchEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const deadline = Date.now() + 20_000;
  let pid: number | undefined;
  while (Date.now() < deadline) {
    pid = liveNativePids(appExecutable).find(
      (candidate) => !before.has(candidate),
    );
    if (pid) break;
    await sleep(100);
  }
  if (!pid) throw new Error("LaunchServices did not start the F11 Luca.app");
  launches.add(pid);
  await waitForTree(pid, (tree) => tree.length > 0, "first native window");
  consoleEvidence.push({
    phase,
    stream: "harness",
    text: `real Tauri process launched with isolated app-data and scoped development keyring`,
  });
  return {
    appBundle,
    appExecutable,
    home,
    keyringService,
    pid,
    stderrPath,
    stdoutPath,
  };
}

async function stopNative(launch: NativeLaunch) {
  if (!launches.has(launch.pid)) return;
  try {
    process.kill(launch.pid, "SIGTERM");
  } catch {
    // It may already have closed through native app behavior.
  }
  const deadline = Date.now() + 10_000;
  while (
    Date.now() < deadline &&
    liveNativePids(launch.appExecutable).includes(launch.pid)
  ) {
    await sleep(100);
  }
  launches.delete(launch.pid);
}

async function captureNative(phase: string, launch: NativeLaunch) {
  // WKWebView can publish an accessibility-tree update shortly before the
  // corresponding CoreAnimation frame is visible to screencapture.
  await sleep(1_000);
  const geometry = appleScript(
    launch.pid,
    "get {position of window 1, size of window 1}",
  )
    .split(",")
    .map((part) => Number(part.trim()));
  expect(geometry).toHaveLength(4);
  expect(geometry.every(Number.isFinite)).toBe(true);
  const path = join(SCREENSHOTS_ROOT, `${phase}.png`);
  mkdirSync(dirname(path), { recursive: true });
  shell("screencapture", ["-x", `-R${geometry.join(",")}`, path]);
  expect(existsSync(path)).toBe(true);
  screenshotEvidence.push({
    phase,
    path: relative(REPO_ROOT, path),
  });
}

async function completeOwnerSetup(launch: NativeLaunch, phase: string) {
  let tree = await waitForText(launch.pid, "Create owner identity");
  expect(tree).toContain("A personal home for the agents");
  assertNoPublicSetupSurface(tree);
  await captureNative(`${phase}-identity`, launch);

  clickButton(launch.pid, "Create owner identity");
  tree = await waitForText(launch.pid, "Your owner identity is secured");
  expect(tree).toContain("system keychain");
  assertNoPublicSetupSurface(tree);

  clickButton(launch.pid, "Next");
  await completeRuntimeSetup(launch, phase);
}

async function completeRuntimeSetup(launch: NativeLaunch, phase: string) {
  let tree = await waitForText(
    launch.pid,
    "Prepare your resident setup",
    45_000,
  );
  tree = await waitForText(launch.pid, "READY", 45_000);
  expect(tree).toContain("Codex");
  assertNoPublicSetupSurface(tree);
  await captureNative(`${phase}-resident-setup`, launch);

  clickButton(launch.pid, "Next");
  tree = await waitForText(
    launch.pid,
    "Choose your default runtime and model",
    30_000,
  );
  expect(tree).toContain("owner identity stays the same");
  await waitForTree(
    launch.pid,
    (current) => current.includes("button Next"),
    "enabled final onboarding action",
    30_000,
  );
  clickButton(launch.pid, "Next");
}

test.beforeAll(() => {
  expect(process.platform, "F11 native proof is macOS-only").toBe("darwin");
  expect(
    existsSync(APP_EXECUTABLE),
    `Build the exact-revision debug app first: ${relative(REPO_ROOT, APP_BUNDLE)}`,
  ).toBe(true);
  mkdirSync(OUTPUTS_ROOT, { recursive: true });
  mkdirSync(SCREENSHOTS_ROOT, { recursive: true });
});

test.afterAll(async () => {
  for (const pid of [...launches]) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Best-effort cleanup is limited to PIDs launched by this spec.
    }
  }
  writeJson(join(OUTPUTS_ROOT, "screenshots.json"), {
    native: true,
    screenshots: screenshotEvidence,
  });
  writeJson(join(OUTPUTS_ROOT, "console_log.json"), {
    entries: consoleEvidence,
    native: true,
    syntheticBridge: false,
  });
});

test("F11: real Tauri clean profile provisions and relaunches the same Luca home", async () => {
  const root = mkdtempSync(join(tmpdir(), "luca-f11-native-normal-"));
  const runtimeBin = createRuntimeDiscoveryFixtures(root);
  const first = await launchNative(root, "first-launch", runtimeBin);

  try {
    await completeOwnerSetup(first, "normal");
    const homeTree = await waitForTree(
      first.pid,
      (tree) =>
        !tree.includes("Choose your default runtime and model") &&
        !tree.includes("Create owner identity") &&
        tree.includes("Toggle Sidebar") &&
        tree.includes("button Chat") &&
        tree.includes("button Agents"),
      "Luca personal home",
      45_000,
    );
    assertNoPublicSetupSurface(homeTree);
    await captureNative("normal-home", first);
    recordLaunchLogs("first-launch", first);
  } finally {
    await stopNative(first);
  }

  const relaunch = await launchNative(
    root,
    "relaunch",
    runtimeBin,
    false,
    first,
  );
  try {
    const relaunchTree = await waitForTree(
      relaunch.pid,
      (tree) =>
        !tree.includes("Create owner identity") &&
        tree.includes("Toggle Sidebar") &&
        tree.includes("button Chat") &&
        tree.includes("button Agents"),
      "same Luca personal home after process relaunch",
      45_000,
    );
    assertNoPublicSetupSurface(relaunchTree);
    await captureNative("normal-relaunch", relaunch);
    recordLaunchLogs("relaunch", relaunch);
  } finally {
    await stopNative(relaunch);
  }

  const executableSha256 = createHash("sha256")
    .update(readFileSync(APP_EXECUTABLE))
    .digest("hex");
  writeJson(join(OUTPUTS_ROOT, "installed_app_smoke.json"), {
    appBundle: relative(REPO_ROOT, APP_BUNDLE),
    executableSha256,
    launchMechanism: "macOS LaunchServices open -n -F",
    nativeAccessibilityObserved: true,
    syntheticBridge: false,
  });
  writeJson(join(OUTPUTS_ROOT, "native_clean_profile.json"), {
    appData:
      "isolated empty temporary HOME plus unique native bundle/WebKit container",
    identity: "created through native Luca onboarding",
    keyring: "dedicated empty buzz-desktop-dev.f11-<uuid> service",
    personalHome: "automatically provisioned and selected",
    relaunch:
      "same isolated app-data and keyring; no shell or database intervention",
    reached: "Luca home",
  });
});

test("F11: real Tauri recovers a generated owner identity into a private Luca home", async () => {
  const root = mkdtempSync(join(tmpdir(), "luca-f11-native-recovery-"));
  const runtimeBin = createRuntimeDiscoveryFixtures(root);
  const launch = await launchNative(root, "recovery", runtimeBin);

  try {
    let tree = await waitForText(launch.pid, "Connect an existing identity");
    assertNoPublicSetupSurface(tree);
    clickButton(launch.pid, "Connect an existing identity");
    tree = await waitForText(launch.pid, "Connect your owner identity");
    expect(tree).toContain("It stays masked while you enter it");
    typeGeneratedRecoveryKey(launch.pid);
    tree = await waitForText(launch.pid, "Nostr identity found", 15_000);
    expect(tree).not.toContain("text field nsec1");
    await captureNative("recovery-masked-identity", launch);
    clickButton(launch.pid, "Next");
    await completeRuntimeSetup(launch, "recovery");
    tree = await waitForTree(
      launch.pid,
      (current) =>
        !current.includes("Create owner identity") &&
        current.includes("Toggle Sidebar") &&
        current.includes("button Chat") &&
        current.includes("button Agents"),
      "Luca home after native identity recovery",
      45_000,
    );
    assertNoPublicSetupSurface(tree);
    await captureNative("recovery-home", launch);
    recordLaunchLogs("recovery", launch);
  } finally {
    await stopNative(launch);
  }

  writeJson(join(OUTPUTS_ROOT, "native_clean_profile.json"), {
    appData:
      "isolated empty temporary HOME plus unique native bundle/WebKit container",
    identity: "created and recovered through native Luca onboarding",
    keyring: "dedicated empty buzz-desktop-dev.f11-<uuid> service per profile",
    personalHome: "automatically provisioned and selected",
    relaunch:
      "same isolated app-data and keyring; no shell or database intervention",
    reached: "Luca home",
  });
});

test("F11: native debug failpoint renders Luca personal-home retry state", async () => {
  const root = mkdtempSync(join(tmpdir(), "luca-f11-native-failure-"));
  const runtimeBin = createRuntimeDiscoveryFixtures(root);
  const launch = await launchNative(root, "failpoint", runtimeBin, true);

  try {
    await completeOwnerSetup(launch, "failpoint");
    const tree = await waitForText(
      launch.pid,
      "Luca couldn’t open your personal home",
      45_000,
    );
    expect(tree).toContain("Retry");
    expect(tree).not.toMatch(
      /join a community|create a community|workspace|invite/i,
    );
    expect(tree).not.toContain("static text BUZZ");
    await captureNative("failpoint-retry", launch);
    recordLaunchLogs("failpoint", launch);
  } finally {
    await stopNative(launch);
  }
});
