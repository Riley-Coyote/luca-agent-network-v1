import { expect, test } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
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

function clickHomeLibrary(pid: number) {
  return appleScript(
    pid,
    'click button "Library" of group 1 of group 2 of group 1 of UI element 1 of scroll area 1 of group 1 of group 1 of window 1',
  );
}

function clickLibraryImport(pid: number) {
  return appleScript(
    pid,
    'click button "Import" of group 1 of group 1 of group 4 of group 1 of UI element 1 of scroll area 1 of group 1 of group 1 of window 1',
  );
}

function clickCanvasClose(pid: number, title: string) {
  return appleScript(
    pid,
    `click button "Close Canvas" of group 1 of group "Canvas preview of ${appleScriptText(title)}" of group 4 of group 1 of UI element 1 of scroll area 1 of group 1 of group 1 of window 1`,
  );
}

function polyphonicChapter(heading: string) {
  const escapedHeading = appleScriptText(heading);
  return `group "${escapedHeading}" of group 1 of UI element 1 of scroll area 1 of group 1 of group 1 of window 1`;
}

function clickPolyphonicContinue(
  pid: number,
  heading: string,
  actionGroup: number,
) {
  return appleScript(
    pid,
    `click button "Continue" of group ${actionGroup} of ${polyphonicChapter(heading)}`,
  );
}

function polyphonicContinueEnabled(
  pid: number,
  heading: string,
  actionGroup: number,
) {
  return (
    appleScript(
      pid,
      `get enabled of button "Continue" of group ${actionGroup} of ${polyphonicChapter(heading)}`,
    ) === "true"
  );
}

function typePolyphonicOwnerName(pid: number, value: string) {
  const heading = "Bring your agents together.";
  const field = `text field "What should Luca call you?" of group 4 of ${polyphonicChapter(heading)}`;
  let observed = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    shell("osascript", [
      "-e",
      `tell application "System Events"
        tell first application process whose unix id is ${pid}
          set frontmost to true
          delay 0.5
          click ${field}
          delay 0.5
          keystroke "a" using command down
          keystroke "${appleScriptText(value)}"
          key code 48
        end tell
      end tell`,
    ]);
    observed = appleScript(pid, `get value of ${field}`);
    if (observed === value) return;
  }
  throw new Error(
    `Native owner-name field did not accept keyboard input: ${JSON.stringify(observed)}`,
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
  const path = `${runtimeBin}:/usr/bin:/bin:/usr/sbin:/sbin`;
  const launchEnvironment = {
    ...process.env,
    HOME: home,
    PATH: path,
    BUZZ_DEV_KEYRING_SERVICE: keyringService,
    RUST_LOG: "info",
  };
  const child = spawn(appExecutable, [], {
    detached: false,
    env: launchEnvironment,
    stdio: "ignore",
  });
  const pid = child.pid;
  if (!pid) {
    throw new Error(
      "The exact signed Artifact Security executable did not start",
    );
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
  if (liveNativePids(launch.appExecutable).includes(launch.pid)) {
    try {
      process.kill(launch.pid, "SIGKILL");
    } catch {
      // The exact test process may exit between the liveness check and signal.
    }
  }
  launches.delete(launch.pid);
}

async function completeOwnerSetup(launch: NativeLaunch) {
  await waitForText(launch.pid, "Begin setup");
  clickWebviewButton(launch.pid, "Begin setup");
  const ownerHeading = "Bring your agents together.";
  await waitForText(launch.pid, ownerHeading);
  typePolyphonicOwnerName(launch.pid, "Artifact Owner");
  await waitForTree(
    launch.pid,
    () => polyphonicContinueEnabled(launch.pid, ownerHeading, 6),
    "enabled owner onboarding action",
  );
  clickPolyphonicContinue(launch.pid, ownerHeading, 6);

  const runtimeHeading = "Choose what powers Luca";
  await waitForText(launch.pid, runtimeHeading, 45_000);
  await waitForText(launch.pid, "Codex", 45_000);
  await waitForTree(
    launch.pid,
    () => polyphonicContinueEnabled(launch.pid, runtimeHeading, 5),
    "enabled runtime onboarding action",
    45_000,
  );
  clickPolyphonicContinue(launch.pid, runtimeHeading, 5);
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
  let goToFolderOpen = false;
  for (let attempt = 0; attempt < 3 && !goToFolderOpen; attempt += 1) {
    appleScript(pid, "set frontmost to true");
    await sleep(300);
    appleScript(pid, 'keystroke "g" using {command down, shift down}');
    try {
      await waitForTree(
        pid,
        (tree) => tree.includes("sheet 1 of sheet 1 of window 1"),
        "Open panel Go to Folder sheet",
        3_000,
      );
      goToFolderOpen = true;
    } catch {
      // Native panels occasionally drop the first shortcut during activation.
    }
  }
  if (!goToFolderOpen) {
    throw new Error("Native Open panel did not open Go to Folder");
  }
  appleScript(pid, "set frontmost to true");
  appleScript(pid, `keystroke "${appleScriptText(path)}"`);
  appleScript(pid, "key code 36");
  await waitForTree(
    pid,
    (tree) =>
      tree.includes("button Open") &&
      !tree.includes("sheet 1 of sheet 1 of window 1"),
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

async function assertHtmlContained(pid: number, hits: TripwireHit[]) {
  await waitForText(pid, "INLINE_SCRIPT PASS", 45_000);
  await waitForText(pid, "PROBE_COMPLETE", 45_000);
  await sleep(2_500);
  assertNoTripwireHits(hits, "HTML Canvas");
  const tree = accessibilityTree(pid);
  expect(tree).toContain("INLINE_SCRIPT PASS");
  expect(tree).toContain("PROBE_COMPLETE");
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
    clickHomeLibrary(launch.pid);
    await waitForText(launch.pid, "Artifacts made with your residents");

    clickLibraryImport(launch.pid);
    await chooseOpenPanelFile(launch.pid, htmlFixture);
    await waitForText(
      launch.pid,
      "Canvas preview of artifact-security-probe.html",
      45_000,
    );
    await assertHtmlContained(launch.pid, tripwire.hits);
    assertNoTripwireHits(tripwire.hits, "HTML Canvas");

    clickCanvasClose(launch.pid, "artifact-security-probe.html");
    await waitForTree(
      launch.pid,
      (tree) =>
        !tree.includes("Canvas preview of artifact-security-probe.html"),
      "closed HTML Canvas",
    );
    clickLibraryImport(launch.pid);
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
