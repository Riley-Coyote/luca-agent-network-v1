import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runFileSizeCheck } from "./check-file-sizes-core.mjs";

test("oversized files warn for review without rejecting the check", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "file-size-warning-"));
  const sourceRoot = path.join(projectRoot, "src");
  const warnings = [];
  const originalWarn = console.warn;

  try {
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "large.ts"), "one\ntwo\nthree\n");
    console.warn = (...values) => warnings.push(values.join(" "));

    const violations = await runFileSizeCheck({
      projectRoot,
      rules: [{ root: "src", extensions: new Set([".ts"]), maxLines: 2 }],
      label: "Test",
      scriptPath: "scripts/check-file-sizes.mjs",
    });

    assert.deepEqual(violations, [
      { limit: 2, lineCount: 4, relativePath: path.join("src", "large.ts") },
    ]);
    assert.match(warnings.join("\n"), /file size review warnings/);
    assert.match(warnings.join("\n"), /large\.ts: 4 lines \(limit 2\)/);
  } finally {
    console.warn = originalWarn;
    await rm(projectRoot, { force: true, recursive: true });
  }
});

test("checker configuration defects still reject normally", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "file-size-error-"));
  const sourceRoot = path.join(projectRoot, "src");

  try {
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "file.ts"), "content\n");

    await assert.rejects(
      runFileSizeCheck({
        projectRoot,
        rules: [{ root: "src", extensions: null, maxLines: 2 }],
        label: "Test",
        scriptPath: "scripts/check-file-sizes.mjs",
      }),
      TypeError,
    );
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
});
