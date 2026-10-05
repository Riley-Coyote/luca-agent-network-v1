import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(repository, "scripts/build-companion-delegation-candidate.sh");
const overlay = join(repository, "desktop/src-tauri/tauri.companion-delegation-candidate.conf.json");
const identity = "chat.polyphonic.desktop.companion-delegation.dev";
const product = "Polyphonic Companion Delegation Candidate";
const scheme = "polyphonic-companion-delegation";
const source = "a".repeat(40);
const sidecars = ["buzz-acp", "buzz-agent", "buzz-dev-mcp", "git-credential-nostr", "buzz", "buzz-relay"];
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function shell(code, args = []) {
  return spawnSync("bash", ["-c", `source ${quote(script)}\n${code}`, "fixture", ...args], {
    encoding: "utf8",
    cwd: repository,
    timeout: 10_000,
  });
}

function temporary(run) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "companion-candidate-fixture-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("candidate shell syntax and static overlay contract are valid", () => {
  assert.equal(spawnSync("bash", ["-n", script]).status, 0);
  const result = shell("json config \"$1\" \"$BUNDLE_ID\" \"$PRODUCT_NAME\" \"$URL_SCHEME\"", [overlay]);
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(readFileSync(overlay, "utf8"));
  assert.equal(config.identifier, identity);
  assert.deepEqual(config.bundle.targets, ["app"]);
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.deepEqual(config.plugins["deep-link"].desktop.schemes, [scheme]);
  assert.equal(config.build, undefined);
  assert.equal(config.app, undefined);
});

test("updater, identity, scheme, and inherited build widening fail closed", () => {
  temporary((root) => {
    const original = JSON.parse(readFileSync(overlay, "utf8"));
    for (const mutate of [
      (c) => { c.identifier = "chat.polyphonic.desktop"; },
      (c) => { c.plugins.updater.endpoints = ["https://example.invalid/update"]; },
      (c) => { c.plugins["deep-link"].desktop.schemes = ["luca"]; },
      (c) => { c.bundle.createUpdaterArtifacts = true; },
      (c) => { c.bundle.targets = ["app", "dmg"]; },
      (c) => { c.build = { beforeBuildCommand: "unexpected" }; },
      (c) => { c.bundle.externalBin = []; },
    ]) {
      const config = structuredClone(original);
      mutate(config);
      const file = join(root, "invalid.json");
      writeFileSync(file, JSON.stringify(config));
      const result = shell('json config "$1" "$BUNDLE_ID" "$PRODUCT_NAME" "$URL_SCHEME"', [file]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /metadata validation failed/);
      assert.doesNotMatch(result.stderr, /example\.invalid|unexpected/);
    }
  });
});

test("prospective dedicated paths are read-only and reject traversal, broad, personal and linked paths", () => {
  temporary((root) => {
    const unused = join(root, "does-not-exist", "target");
    assert.equal(shell('validate_directory "$1"', [unused]).status, 0);
    assert.equal(existsSync(unused), false);
    symlinkSync(root, join(root, "linked"), "dir");
    for (const path of ["relative", "/", "/private/tmp", "/Volumes/LaCie", "/Users", "/Applications/Polyphonic.app", process.env.HOME,
      join(process.env.HOME, ".codex", "config"), join(process.env.HOME, "Library/Caches/luca-build/cargo-target"),
      `${root}/../target`, `${root}/./target`, `${root}//target`, `${root}/control\npath`, join(root, "linked", "target")]) {
      assert.notEqual(shell('validate_directory "$1"', [path]).status, 0, path);
    }
  });
});

test("clean-source helper rejects every nonignored status without writing outputs", () => {
  for (const status of [" M owned.rs", "?? untracked-output.log", "A  staged.rs"]) {
    // Use an explicit shell argument instead of introducing a production bypass.
    const checked = shell('FIXTURE_STATUS="$1"; git() { printf "%s" "$FIXTURE_STATUS"; }; assert_clean_source "$REPO_ROOT"', [status]);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /source is dirty/);
  }
  assert.equal(shell('git() { return 0; }; assert_clean_source "$REPO_ROOT"').status, 0);
  const failure = shell('git() { return 1; }; assert_clean_source "$REPO_ROOT"');
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /cannot verify/);
});

test("candidate env scrub removes identity/build injection without changing native HOME/profile", () => {
  const result = shell(`
    before_home="$HOME"
    export BUZZ_PRIVATE_KEY=fixture-secret BUZZ_SHARE_IDENTITY=1 LUCA_TEST=fixture-secret
    export VITE_TEST=fixture-secret TAURI_CONFIG=fixture-secret APPLE_PASSWORD=fixture-secret
    export CODEX_HOME=/fixture/native-codex CLAUDE_CONFIG_DIR=/fixture/native-claude
    clear_candidate_environment
    [[ "$HOME" == "$before_home" && "$CODEX_HOME" == /fixture/native-codex && "$CLAUDE_CONFIG_DIR" == /fixture/native-claude ]]
    [[ -z "\${BUZZ_PRIVATE_KEY+x}" && -z "\${BUZZ_SHARE_IDENTITY+x}" && -z "\${LUCA_TEST+x}" && -z "\${VITE_TEST+x}" && -z "\${TAURI_CONFIG+x}" && -z "\${APPLE_PASSWORD+x}" ]]
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret/);
});

test("native Node capture keeps the existing absolute executable and validates probe arguments", () => {
  temporary((root) => {
    const executable = join(root, "existing Node");
    writeFileSync(executable, "fixture-only-executable", { mode: 0o700 });
    const result = shell(`
      FIXTURE_NATIVE_NODE="$1"
      node() {
        [[ "$#" == 2 && "$1" == -p && "$2" == process.execPath ]]
        printf '%s\\n' "$FIXTURE_NATIVE_NODE"
      }
      capture_native_node
    `, [executable]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${executable}\n`);
  });
});

test("native Node capture fails closed for invalid or unavailable executables", () => {
  temporary((root) => {
    const zero = join(root, "zero");
    const nonexecutable = join(root, "nonexecutable");
    const executable = join(root, "executable");
    const linked = join(root, "linked");
    writeFileSync(zero, "", { mode: 0o700 });
    writeFileSync(nonexecutable, "fixture-only", { mode: 0o600 });
    writeFileSync(executable, "fixture-only", { mode: 0o700 });
    symlinkSync(executable, linked);
    for (const path of ["", "relative-node", `${root}/control\npath`, root, join(root, "missing"), zero, nonexecutable, linked]) {
      const result = shell('FIXTURE_NATIVE_NODE="$1"; node() { printf "%s" "$FIXTURE_NATIVE_NODE"; }; capture_native_node', [path]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /existing absolute executable/);
      assert.equal(result.stdout, "");
    }
    const unavailable = shell('node() { return 17; }; capture_native_node');
    assert.notEqual(unavailable.status, 0);
    assert.match(unavailable.stderr, /cannot resolve/);
  });
});

test("Tauri invocation bypasses poisoned Hermit shims and preserves exact pinned Cargo arguments and environment", () => {
  temporary((root) => {
    const nativeNode = join(root, "native Node");
    const rustBin = join(root, "pinned Rust bin");
    const cargoHome = join(root, "user Cargo cache");
    const target = join(root, "dedicated target");
    const poisoned = join(root, "poisoned shims");
    mkdirSync(poisoned);
    for (const name of ["node", "pnpm", "cargo", "tauri"]) {
      writeFileSync(join(poisoned, name), '#!/bin/bash\nprintf "unexpected poisoned shim\\n" >&2\nexit 91\n', { mode: 0o700 });
    }
    const capture = `process.stdout.write(JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(1), cargoHome: process.env.CARGO_HOME, target: process.env.CARGO_TARGET_DIR, rustc: process.env.RUSTC, rustdoc: process.env.RUSTDOC, offline: process.env.CARGO_NET_OFFLINE, path: process.env.PATH }));`;
    writeFileSync(nativeNode, `#!/bin/bash\nexec ${quote(process.execPath)} -e ${quote(capture)} -- "$@"\n`, { mode: 0o700 });
    const result = shell(`
      export PATH="$4:$5:/usr/bin:/bin" CARGO_HOME="$2" CARGO_TARGET_DIR="$3"
      export RUSTC="$4/rustc" RUSTDOC="$4/rustdoc" CARGO_NET_OFFLINE=true
      build_tauri_candidate "$1" "$4"
    `, [nativeNode, cargoHome, target, rustBin, poisoned]);
    assert.equal(result.status, 0, result.stderr);
    const invoked = JSON.parse(result.stdout);
    assert.deepEqual(invoked, {
      cwd: join(repository, "desktop"),
      argv: ["./node_modules/@tauri-apps/cli/tauri.js", "build", "--runner", join(rustBin, "cargo"), "--debug", "--bundles", "app", "--config", overlay, "--ci", "--no-sign", "--", "--offline", "--locked"],
      cargoHome,
      target,
      rustc: join(rustBin, "rustc"),
      rustdoc: join(rustBin, "rustdoc"),
      offline: "true",
      path: `${rustBin}:${poisoned}:/usr/bin:/bin`,
    });
    assert.equal(existsSync(target), false);
    assert.equal(existsSync(cargoHome), false);
  });
});

test("source receipt includes all six fresh helper hashes and exact source/isolation, not env bodies", () => {
  temporary((root) => {
    const target = join(root, "target");
    mkdirSync(join(target, "debug"), { recursive: true });
    for (const name of sidecars) writeFileSync(join(target, "debug", name), `fixture-only-${name}`);
    const entitlements = join(repository, "desktop/src-tauri/Entitlements.plist");
    const receipt = join(root, "source.json");
    const common = [receipt, "polyphonic.companion-delegation-candidate.v1", source, "b".repeat(40), "fixture-branch", identity, product, join(root, "instance"), "buzz-desktop-dev.fixture", overlay, entitlements];
    assert.equal(shell('json receipt "$@"', [...common, target, "fixture-public-signing", ...sidecars]).status, 0);
    assert.equal(shell('json verify-receipt "$@"', [...common, ...sidecars]).status, 0);
    const value = JSON.parse(readFileSync(receipt, "utf8"));
    assert.deepEqual(value.sidecars.map((v) => v.name), sidecars);
    assert.deepEqual(value.features, ["default", "system-keyring"]);
    assert.equal(value.notarized, false);
    const mismatch = [...common];
    mismatch[2] = "c".repeat(40);
    assert.notEqual(shell('json verify-receipt "$@"', [...mismatch, ...sidecars]).status, 0);
    assert.equal(value.environment, undefined);
  });
});

test("external manifest detects executable mutation after final receipt", () => {
  temporary((root) => {
    const bundle = join(root, "Fixture.app");
    mkdirSync(join(bundle, "Contents/MacOS"), { recursive: true });
    mkdirSync(join(bundle, "Contents/Resources"));
    writeFileSync(join(bundle, "Contents/Info.plist"), "fixture-plist");
    writeFileSync(join(bundle, "Contents/Resources/companion-delegation-source.json"), "fixture-receipt");
    for (const name of ["buzz-desktop", ...sidecars]) writeFileSync(join(bundle, "Contents/MacOS", name), `fixture-${name}`);
    const args = [join(root, "signed.json"), bundle, "fixture-protocol", source, "buzz-desktop", ...sidecars];
    assert.equal(shell('json manifest "$@"', args).status, 0);
    assert.equal(shell('json verify-manifest "$@"', args).status, 0);
    writeFileSync(join(bundle, "Contents/MacOS/buzz-relay"), "changed");
    assert.notEqual(shell('json verify-manifest "$@"', args).status, 0);
  });
});

test("pid metadata and exact start/path binding reject another process without signals", () => {
  temporary((root) => {
    const file = join(root, "owned.json");
    const executable = "/fixture/Candidate.app/Contents/MacOS/buzz-desktop";
    assert.equal(shell('json pid-write "$@"', [file, "42", "fixture-start", executable, source]).status, 0);
    assert.equal(shell('json pid-read "$@"', [file, executable]).stdout, "42\nfixture-start\n");
    assert.notEqual(shell('json pid-read "$@"', [file, "/other/app"]).status, 0);
    const match = (path, start) => shell(`
      APP_EXECUTABLE="$1"
      kill() { [[ "$1" == -0 ]]; }
      ps() { if [[ "$4" == lstart= ]]; then printf '%s\\n' fixture-start; else printf '%s\\n' "$APP_EXECUTABLE"; fi; }
      process_matches 42 "$2"
    `, [path, start]);
    assert.equal(match(executable, "fixture-start").status, 0);
    assert.notEqual(match(executable, "different-start").status, 0);
    writeFileSync(file, JSON.stringify({ pid: 1, started: "fixture-start", executable, sourceRevision: source }));
    assert.notEqual(shell('json pid-read "$@"', [file, executable]).status, 0);
  });
});

test("unowned nonempty state and a stale lock cannot be adopted or removed", () => {
  temporary((root) => {
    const instance = join(root, "unowned-instance");
    mkdirSync(instance);
    writeFileSync(join(instance, "retain.txt"), "retained-fixture");
    const unowned = shell('TARGET_DIR="$1"; INSTANCE_ROOT="$2"; prepare_paths; lock_instance', [join(root, "target"), instance]);
    assert.notEqual(unowned.status, 0);
    assert.match(unowned.stderr, /nonempty unowned/);
    assert.equal(readFileSync(join(instance, "retain.txt"), "utf8"), "retained-fixture");
    assert.equal(existsSync(join(instance, "control")), false);

    const owned = join(root, "owned-instance");
    const args = [join(root, "target"), owned];
    const created = shell('TARGET_DIR="$1"; INSTANCE_ROOT="$2"; prepare_paths; lock_instance', args);
    assert.equal(created.status, 0, created.stderr);
    const lock = join(owned, "control/operation.lock");
    assert.equal(existsSync(lock), false);
    mkdirSync(lock);
    const locked = shell('TARGET_DIR="$1"; INSTANCE_ROOT="$2"; prepare_paths; lock_instance', args);
    assert.notEqual(locked.status, 0);
    assert.match(locked.stderr, /already locked/);
    assert.equal(existsSync(lock), true);
  });
});

test("stop refuses a changed PID identity before locking or signalling it", () => {
  temporary((root) => {
    const result = shell(`
      TARGET_DIR="$1"; INSTANCE_ROOT="$2"; prepare_paths
      mkdir -p "$CONTROL_DIR"
      json pid-write "$PID_FILE" 42 previous-start "$APP_EXECUTABLE" "$3"
      kill() { [[ "$1" == -0 ]] || { printf '%s\\n' UNSAFE_SIGNAL; return 99; }; }
      ps() { printf '%s\\n' different-start; }
      stop_candidate
    `, [join(root, "target"), join(root, "instance"), source]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no signal sent/);
    assert.doesNotMatch(result.stdout, /UNSAFE_SIGNAL/);
    assert.equal(existsSync(join(root, "instance/control/operation.lock")), false);
  });
});

test("failed-start cleanup never signals a reused PID or a child outside this shell's live jobs", () => {
  for (const [job, started] of [["42", "different-start"], ["", "fixture-start"], ["43", "fixture-start"]]) {
    const result = shell(`
      FIXTURE_JOB="$1"
      process_started() { printf '%s\\n' fixture-start; }
      jobs() { printf '%s\\n' "$FIXTURE_JOB"; }
      wait() { return 0; }
      kill() { printf '%s\\n' UNSAFE_SIGNAL; return 99; }
      cleanup_new_child 42 "$2"
    `, [job, started]);
    assert.equal(result.status, job === "42" ? 1 : 0, result.stderr);
    assert.doesNotMatch(result.stdout, /UNSAFE_SIGNAL/);
  }
});

test("failed-start cleanup is bounded and signals only its captured live child before reap", () => {
  const result = shell(`
    live=1
    process_started() { printf '%s\\n' fixture-start; }
    jobs() { [[ "$live" == 1 ]] && printf '%s\\n' 42 || true; }
    sleep() { return 0; }
    kill() {
      [[ "$2" == 42 ]]
      printf '%s\\n' "$1"
      [[ "$1" != -KILL ]] || live=0
    }
    wait() { [[ "$1" == 42 ]]; printf '%s\\n' REAPED; }
    cleanup_new_child 42 fixture-start
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "-TERM\n-KILL\nREAPED\n");
});

test("missing, zero-byte, nonexecutable and symlink helpers are never package evidence", () => {
  temporary((root) => {
    const zero = join(root, "zero");
    const text = join(root, "text");
    const link = join(root, "link");
    writeFileSync(zero, "");
    writeFileSync(text, "fixture-not-executable");
    symlinkSync(text, link);
    for (const file of [join(root, "missing"), zero, text, link]) {
      const result = shell('verify_executable "$1"', [file]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /required executable/);
    }
  });
});

test("script has no automatic build/launch and no global kill or profile rewrite path", () => {
  const text = readFileSync(script, "utf8");
  assert.doesNotMatch(text, /pkill|killall|osascript|lsregister|ensure-luca-dev-relay|\bopen -[an]|export HOME=|--features mesh-llm|cargo update|--last|--fork/);
  assert.match(text, /cargo build --offline --locked.*-p buzz-relay/);
  assert.match(text, /"\$native_node" \.\/node_modules\/@tauri-apps\/cli\/tauri\.js build --runner "\$rust_bin\/cargo"/);
  assert.match(text, /--debug --bundles app.*--no-sign -- --offline --locked/);
  assert.doesNotMatch(text, /pnpm exec tauri/);
  assert.match(text, /if \[\[ "\$\{BASH_SOURCE\[0\]\}" == "\$0" \]\]; then main/);
  const result = spawnSync("bash", [script], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /check\|build\|run\|stop/);
});
