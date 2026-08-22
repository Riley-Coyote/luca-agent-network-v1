import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const APP_BUNDLE = process.env.LUCA_ARTIFACT_NATIVE_APP ?? "";
const APP_EXECUTABLE = join(APP_BUNDLE, "Contents/MacOS/buzz-desktop");
const APP_BUILD_RECEIPT = join(
  APP_BUNDLE,
  "Contents/Resources/luca-artifact-native-build.json",
);
const ARTIFACT_SECURITY_BUNDLE_ID = "com.luca.agent-network.artifact-security";
const BLOCKED_VECTORS = [
  "FETCH",
  "XHR",
  "WEBSOCKET",
  "IMAGE",
  "CSS",
  "FONT",
  "FORM",
  "META_REFRESH",
  "SAME_FRAME",
  "FRAME",
  "WORKER",
  "STORAGE",
  "CLIPBOARD",
  "PARENT",
  "TOP",
  "TAURI",
] as const;

type NativeLaunch = {
  appBundle: string;
  appExecutable: string;
  home: string;
  keyringService: string;
  pid: number;
};

type TripwireHit = {
  method: string;
  transport: "http" | "websocket";
  vector: string;
};

const launches = new Set<number>();

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

function appleScriptText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
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
      // The native window and its WKWebView accessibility tree commit separately.
    }
    await sleep(250);
  }
  throw new Error(
    `Timed out waiting for native UI: ${description}. Last AX tree length: ${lastTree.length}`,
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

function clickWebviewButton(pid: number, name: string) {
  const escapedName = appleScriptText(name);
  return appleScript(
    pid,
    `click button "${escapedName}" of UI element 1 of scroll area 1 of group 1 of group 1 of window 1`,
  );
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
    '#!/bin/sh\nif [ "$1" = "login" ] && [ "$2" = "status" ]; then\n  echo "Logged in using native artifact fixture"\nfi\nexit 0\n',
    "utf8",
  );
  chmodSync(codexAcp, 0o700);
  chmodSync(codex, 0o700);
  return binDir;
}

async function launchNative(root: string, runtimeBin: string) {
  const appBundle = realpathSync(APP_BUNDLE);
  const appExecutable = realpathSync(APP_EXECUTABLE);
  const home = join(root, "home");
  const keyringService = `buzz-desktop-dev.artifact-security-${randomUUID()}`;
  mkdirSync(home, { recursive: true });
  const before = new Set(liveNativePids(appExecutable));
  const path = `${runtimeBin}:/usr/bin:/bin:/usr/sbin:/sbin`;
  const launchEnvironment = {
    ...process.env,
    HOME: home,
    PATH: path,
    BUZZ_DEV_KEYRING_SERVICE: keyringService,
  };
  execFileSync(
    "open",
    [
      "-n",
      "-F",
      "--env",
      `HOME=${home}`,
      "--env",
      `PATH=${path}`,
      "--env",
      `BUZZ_DEV_KEYRING_SERVICE=${keyringService}`,
      "--env",
      "RUST_LOG=info",
      appBundle,
    ],
    {
      env: launchEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const deadline = Date.now() + 20_000;
  let pid: number | undefined;
  while (Date.now() < deadline) {
    pid = liveNativePids(appExecutable).find(
      (candidate) => !before.has(candidate),
    );
    if (pid) break;
    await sleep(100);
  }
  if (!pid) {
    throw new Error("LaunchServices did not start the isolated Luca.app");
  }
  launches.add(pid);
  await waitForTree(pid, (tree) => tree.length > 0, "first native window");
  return {
    appBundle,
    appExecutable,
    home,
    keyringService,
    pid,
  } satisfies NativeLaunch;
}

async function stopNative(launch: NativeLaunch) {
  if (!launches.has(launch.pid)) return;
  try {
    process.kill(launch.pid, "SIGTERM");
  } catch {
    // The native process may already have exited after a containment failure.
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

async function completeOwnerSetup(launch: NativeLaunch) {
  await waitForText(launch.pid, "Create owner identity");
  clickWebviewButton(launch.pid, "Create owner identity");
  await waitForText(launch.pid, "Your owner identity is secured");
  clickWebviewButton(launch.pid, "Next");

  await waitForText(launch.pid, "Prepare your resident setup", 45_000);
  await waitForText(launch.pid, "READY", 45_000);
  clickWebviewButton(launch.pid, "Next");
  await waitForText(
    launch.pid,
    "Choose your default runtime and model",
    30_000,
  );
  await waitForTree(
    launch.pid,
    (tree) => tree.includes("button Next"),
    "enabled final onboarding action",
    30_000,
  );
  clickWebviewButton(launch.pid, "Next");
  await waitForTree(
    launch.pid,
    (tree) => tree.includes("button Library"),
    "Luca personal home",
    45_000,
  );
}

async function chooseOpenPanelFile(pid: number, path: string) {
  await waitForTree(
    pid,
    (tree) => tree.includes("button Open"),
    "native Open panel",
  );
  appleScript(pid, 'keystroke "g" using {command down, shift down}');
  await waitForTree(
    pid,
    (tree) => /Go to the folder/i.test(tree),
    "Open panel Go to Folder sheet",
  );
  appleScript(pid, `keystroke "${appleScriptText(path)}"`);
  appleScript(pid, "key code 36");
  await waitForTree(
    pid,
    (tree) => tree.includes("button Open") && !/Go to the folder/i.test(tree),
    "selected fixture in native Open panel",
  );
  appleScript(pid, "key code 36");
}

async function startTripwire() {
  const hits: TripwireHit[] = [];
  const server = createServer((request, response) => {
    hits.push({
      method: request.method ?? "UNKNOWN",
      transport: "http",
      vector: tripwireVector(request.url),
    });
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    response.end();
  });
  server.on("upgrade", (request, socket) => {
    hits.push({
      method: request.method ?? "UNKNOWN",
      transport: "websocket",
      vector: tripwireVector(request.url),
    });
    socket.destroy();
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    hits,
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

function tripwireVector(url: string | undefined) {
  const candidate = url?.split("?", 1)[0].replace(/^\/+/, "") ?? "unknown";
  return candidate.replace(/[^a-z0-9_-]/gi, "_").slice(0, 48) || "root";
}

function adversarialHtml(origin: string) {
  const endpoint = JSON.stringify(origin);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src * data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; connect-src *; img-src * data: blob:; font-src * data:; frame-src *; form-action *">
  <base href="${origin}/hostile-base/">
  <title>Artifact security probe</title>
  <style>
    body { background: #101114; color: #eceef2; font: 15px system-ui; padding: 24px; }
    h1 { font-size: 18px; font-weight: 600; }
    li { margin: 5px 0; }
  </style>
</head>
<body>
  <h1>ARTIFACT_SECURITY_PROBE</h1>
  <ol id="ledger">
    <li id="INLINE_SCRIPT">INLINE_SCRIPT PENDING</li>
    ${BLOCKED_VECTORS.map((name) => `<li id="${name}">${name} PENDING</li>`).join("\n    ")}
  </ol>
  <p id="complete">PROBE_RUNNING</p>
  <script>
  (() => {
    "use strict";
    const ORIGIN = ${endpoint};
    const WS_ORIGIN = ORIGIN.replace(/^http:/, "ws:");
    const state = new Map();
    const names = ${JSON.stringify(BLOCKED_VECTORS)};
    const mark = (name, result) => {
      if (state.get(name) === "ESCAPED") return;
      if (state.has(name) && result !== "ESCAPED") return;
      state.set(name, result);
      const row = document.getElementById(name);
      if (row) row.textContent = name + " " + result;
    };
    const blocked = (name) => mark(name, "BLOCKED");
    const escaped = (name) => mark(name, "ESCAPED");
    const settleResource = (element, name) => {
      element.addEventListener("load", () => escaped(name), { once: true });
      element.addEventListener("error", () => blocked(name), { once: true });
      document.body.appendChild(element);
    };

    document.getElementById("INLINE_SCRIPT").textContent = "INLINE_SCRIPT PASS";

    fetch(ORIGIN + "/fetch", { mode: "no-cors" })
      .then(() => escaped("FETCH"), () => blocked("FETCH"));

    try {
      const xhr = new XMLHttpRequest();
      xhr.addEventListener("load", () => escaped("XHR"), { once: true });
      xhr.addEventListener("error", () => blocked("XHR"), { once: true });
      xhr.open("GET", ORIGIN + "/xhr");
      xhr.send();
    } catch (_) {
      blocked("XHR");
    }

    try {
      const socket = new WebSocket(WS_ORIGIN + "/websocket");
      socket.addEventListener("open", () => escaped("WEBSOCKET"), { once: true });
      socket.addEventListener("error", () => blocked("WEBSOCKET"), { once: true });
      setTimeout(() => socket.close(), 1200);
    } catch (_) {
      blocked("WEBSOCKET");
    }

    const image = new Image();
    settleResource(image, "IMAGE");
    image.src = ORIGIN + "/image";

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = ORIGIN + "/css";
    settleResource(stylesheet, "CSS");

    try {
      const face = new FontFace("ArtifactTripwire", "url(" + ORIGIN + "/font)");
      face.load().then(() => escaped("FONT"), () => blocked("FONT"));
    } catch (_) {
      blocked("FONT");
    }

    try {
      const formTarget = document.createElement("iframe");
      formTarget.name = "artifact-form-target";
      formTarget.hidden = true;
      document.body.appendChild(formTarget);
      const form = document.createElement("form");
      form.action = ORIGIN + "/form";
      form.method = "POST";
      form.target = formTarget.name;
      document.body.appendChild(form);
      form.submit();
    } catch (_) {
      blocked("FORM");
    }

    try {
      const refresh = document.createElement("meta");
      refresh.httpEquiv = "refresh";
      refresh.content = "0; url=" + ORIGIN + "/meta-refresh";
      document.head.appendChild(refresh);
    } catch (_) {
      blocked("META_REFRESH");
    }

    try {
      location.href = ORIGIN + "/same-frame";
    } catch (_) {
      blocked("SAME_FRAME");
    }

    try {
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.src = ORIGIN + "/frame";
      frame.addEventListener("error", () => blocked("FRAME"), { once: true });
      document.body.appendChild(frame);
    } catch (_) {
      blocked("FRAME");
    }

    try {
      const worker = new Worker(ORIGIN + "/worker");
      worker.addEventListener("message", () => escaped("WORKER"), { once: true });
      worker.addEventListener("error", () => blocked("WORKER"), { once: true });
      setTimeout(() => worker.terminate(), 1200);
    } catch (_) {
      blocked("WORKER");
    }

    let storageEscaped = false;
    try {
      localStorage.setItem("artifact-security-probe", "1");
      storageEscaped = true;
      escaped("STORAGE");
    } catch (_) {}
    try {
      sessionStorage.setItem("artifact-security-probe", "1");
      storageEscaped = true;
      escaped("STORAGE");
    } catch (_) {}
    try {
      const request = indexedDB.open("artifact-security-probe");
      request.addEventListener("success", () => {
        storageEscaped = true;
        escaped("STORAGE");
        request.result.close();
      }, { once: true });
    } catch (_) {}
    if (!storageEscaped) setTimeout(() => blocked("STORAGE"), 600);

    try {
      if (!navigator.clipboard?.readText) {
        blocked("CLIPBOARD");
      } else {
        navigator.clipboard.readText()
          .then(() => escaped("CLIPBOARD"), () => blocked("CLIPBOARD"));
      }
    } catch (_) {
      blocked("CLIPBOARD");
    }

    try {
      void parent.document.title;
      escaped("PARENT");
    } catch (_) {
      blocked("PARENT");
    }

    try {
      const ownTauri = window.__TAURI_INTERNALS__ || window.__TAURI__;
      void parent.__TAURI_INTERNALS__;
      if (ownTauri) escaped("TAURI");
      else blocked("TAURI");
    } catch (_) {
      if (window.__TAURI_INTERNALS__ || window.__TAURI__) escaped("TAURI");
      else blocked("TAURI");
    }

    try {
      top.location.href = ORIGIN + "/top";
    } catch (_) {
      blocked("TOP");
    }

    setTimeout(() => {
      for (const name of names) {
        if (!state.has(name)) blocked(name);
      }
      document.getElementById("complete").textContent = "PROBE_COMPLETE";
    }, 1600);
  })();
  </script>
</body>
</html>`;
}

function adversarialSvg(origin: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"
  onload="new Image().src='${origin}/svg-onload'">
  <title>SVG_SECURITY_PROBE</title>
  <rect width="640" height="360" fill="#101114" />
  <text x="32" y="72" fill="#eceef2" font-size="24">SVG image containment</text>
  <script><![CDATA[
    new Image().src = "${origin}/svg-script";
    fetch("${origin}/svg-fetch", { mode: "no-cors" });
  ]]></script>
</svg>`;
}

async function assertHtmlLedger(pid: number, hits: TripwireHit[]) {
  await waitForTree(
    pid,
    (candidate) => {
      if (hits.length > 0) return true;
      return (
        candidate.includes("INLINE_SCRIPT PASS") &&
        candidate.includes("PROBE_COMPLETE") &&
        BLOCKED_VECTORS.every((name) => candidate.includes(`${name} BLOCKED`))
      );
    },
    "completed static HTML containment ledger",
    45_000,
  );
  assertNoTripwireHits(hits, "HTML Canvas");
  await sleep(1_000);
  const tree = accessibilityTree(pid);
  expect(tree).toContain("INLINE_SCRIPT PASS");
  expect(tree).toContain("PROBE_COMPLETE");
  for (const name of BLOCKED_VECTORS) {
    expect(tree).toContain(`${name} BLOCKED`);
  }
  expect(tree).not.toContain(" PENDING");
  expect(tree).not.toContain(" ESCAPED");
}

function assertNoTripwireHits(hits: TripwireHit[], phase: string) {
  expect(
    hits,
    `${phase} attempted forbidden external access: ${JSON.stringify(hits)}`,
  ).toEqual([]);
}

test.beforeAll(() => {
  expect(process.platform, "native artifact proof is macOS-only").toBe(
    "darwin",
  );
  expect(
    APP_BUNDLE,
    "set LUCA_ARTIFACT_NATIVE_APP to opt into the exact-revision native proof",
  ).not.toBe("");
  expect(
    existsSync(APP_EXECUTABLE),
    "LUCA_ARTIFACT_NATIVE_APP must point to the dedicated exact-revision Artifact Security app",
  ).toBe(true);
  expect(
    existsSync(APP_BUILD_RECEIPT),
    "the dedicated Artifact Security app must contain its exact-source build receipt",
  ).toBe(true);

  const bundleIdentifier = shell("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    join(APP_BUNDLE, "Contents/Info.plist"),
  ]);
  expect(bundleIdentifier).toBe(ARTIFACT_SECURITY_BUNDLE_ID);
  expect(
    shell("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :LucaArtifactNativeSecurityBundle",
      join(APP_BUNDLE, "Contents/Info.plist"),
    ]),
  ).toBe("true");

  shell("codesign", ["--verify", "--deep", "--strict", APP_BUNDLE]);
  const receipt = JSON.parse(readFileSync(APP_BUILD_RECEIPT, "utf8")) as {
    bundleIdentifier?: string;
    sourceRevision?: string;
    worktreeClean?: boolean;
  };
  expect(receipt.bundleIdentifier).toBe(ARTIFACT_SECURITY_BUNDLE_ID);
  expect(receipt.sourceRevision).toBe(shell("git", ["rev-parse", "HEAD"]));
  expect(receipt.worktreeClean).toBe(true);
});

test.afterAll(async () => {
  for (const pid of [...launches]) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Cleanup remains scoped to exact PIDs launched by this spec.
    }
  }
});

test("real Tauri Canvas contains adversarial HTML and renders SVG without execution", async () => {
  const root = mkdtempSync(join(tmpdir(), "luca-artifact-native-security-"));
  const runtimeBin = createRuntimeDiscoveryFixtures(root);
  const tripwire = await startTripwire();
  const htmlFixture = join(root, "artifact-security-probe.html");
  const svgFixture = join(root, "artifact-security-probe.svg");
  writeFileSync(htmlFixture, adversarialHtml(tripwire.origin), "utf8");
  writeFileSync(svgFixture, adversarialSvg(tripwire.origin), "utf8");
  let launch: NativeLaunch | undefined;

  try {
    launch = await launchNative(root, runtimeBin);
    await completeOwnerSetup(launch);
    clickWebviewButton(launch.pid, "Library");
    await waitForText(launch.pid, "Artifacts made with your residents");

    clickWebviewButton(launch.pid, "Import");
    await chooseOpenPanelFile(launch.pid, htmlFixture);
    await waitForText(
      launch.pid,
      "Canvas preview of artifact-security-probe.html",
      45_000,
    );
    await assertHtmlLedger(launch.pid, tripwire.hits);
    assertNoTripwireHits(tripwire.hits, "HTML Canvas");

    clickWebviewButton(launch.pid, "Close Canvas");
    await waitForTree(
      launch.pid,
      (tree) =>
        !tree.includes("Canvas preview of artifact-security-probe.html"),
      "closed HTML Canvas",
    );
    clickWebviewButton(launch.pid, "Import");
    await chooseOpenPanelFile(launch.pid, svgFixture);
    await waitForTree(
      launch.pid,
      (tree) =>
        tree.includes("Canvas preview of artifact-security-probe.svg") &&
        tree.includes("SVG rendered as an image"),
      "non-executable SVG image renderer",
      45_000,
    );
    await sleep(1_500);
    assertNoTripwireHits(tripwire.hits, "SVG Canvas");
  } finally {
    if (launch) await stopNative(launch);
    await tripwire.close();
  }
});
