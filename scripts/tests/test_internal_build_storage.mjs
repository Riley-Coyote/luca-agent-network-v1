import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(repository, "scripts/with-internal-build-cache.sh");
const cacheRoot = join(homedir(), "Library/Caches/luca-build");
const target = join(cacheRoot, "cargo-target");
const macOnly = { skip: process.platform !== "darwin" };

function run(args, overrides = {}) {
  return spawnSync("bash", [script, ...args], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      CARGO_TARGET_DIR: target,
      CARGO_HOME: join(homedir(), ".cargo"),
      POLYPHONIC_BUILD_RESERVE_GIB: "20",
      ...overrides,
    },
    timeout: 10_000,
  });
}

test("build helper has valid shell syntax and disables dev/test incremental snapshots", () => {
  assert.equal(spawnSync("bash", ["-n", script]).status, 0);
  const config = readFileSync(join(repository, ".cargo/config.toml"), "utf8");
  for (const profile of ["dev", "test"]) {
    assert.match(
      config,
      new RegExp(`\\[profile\\.${profile}\\][^\\[]*incremental = false`),
    );
  }
});

test(
  "preflight reports the internal reusable target without invoking a compiler",
  macOnly,
  () => {
    const result = run(["--check"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Incremental snapshots: disabled/);
    assert.ok(result.stdout.includes(target));
    assert.match(result.stdout, /preflight reserve: 20 GiB/);
  },
);

test(
  "command arguments are preserved and incremental overrides cannot repopulate snapshots",
  macOnly,
  () => {
    const result = run(
      [
        process.execPath,
        "-e",
        "process.stdout.write(JSON.stringify({args:process.argv.slice(1),target:process.env.CARGO_TARGET_DIR,incremental:process.env.CARGO_INCREMENTAL}))",
        "--",
        "an argument with spaces",
        "--literal-flag",
      ],
      { CARGO_INCREMENTAL: "1" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      args: ["an argument with spaces", "--literal-flag"],
      target,
      incremental: "0",
    });
  },
);

test(
  "external, broad, relative and traversal targets are refused before execution",
  macOnly,
  () => {
    for (const badTarget of [
      "/Volumes/LaCie/build",
      homedir(),
      "target",
      `${target}/../other`,
      `${target}//child`,
    ]) {
      const result = run(
        [process.execPath, "-e", "process.stdout.write('should-not-run')"],
        { CARGO_TARGET_DIR: badTarget },
      );
      assert.notEqual(result.status, 0, badTarget);
      assert.equal(result.stdout, "");
    }
  },
);

test(
  "a target symlink into the mounted-volume namespace is refused",
  macOnly,
  () => {
    const fixture = mkdtempSync(join(cacheRoot, "storage-preflight-fixture-"));
    try {
      const linked = join(fixture, "linked");
      symlinkSync("/Volumes", linked, "dir");
      const result = run(["--check"], { CARGO_TARGET_DIR: linked });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /internal data volume/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);

test(
  "unmet or malformed reserves stop before starting the command",
  macOnly,
  () => {
    for (const reserve of ["0", "7", "many", "99999", "100000"]) {
      const result = run(
        [process.execPath, "-e", "process.stdout.write('should-not-run')"],
        { POLYPHONIC_BUILD_RESERVE_GIB: reserve },
      );
      assert.notEqual(result.status, 0, reserve);
      assert.equal(result.stdout, "");
    }
  },
);

test("command failures propagate without cleanup or retries", macOnly, () => {
  assert.equal(run([process.execPath, "-e", "process.exit(42)"]).status, 42);
});
