import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../bundle-sidecars.sh', import.meta.url));
const names = ['buzz-acp', 'buzz-agent', 'buzz-dev-mcp', 'git-credential-nostr', 'buzz', 'buzz-relay'];
for (const explicitTarget of [false, true]) {
  test(`sidecars use configured target with explicit triple=${explicitTarget}`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'polyphonic-sidecars-'));
    try {
      const cache = path.join(root, 'internal cache');
      const triple = 'aarch64-apple-darwin';
      const binDir = path.join(root, 'tools');
      mkdirSync(binDir);
      writeFileSync(path.join(binDir, 'rustc'), `#!/bin/sh\nprintf 'host: ${triple}\\n'\n`, { mode: 0o755 });
      const source = path.join(cache, ...(explicitTarget ? [triple] : []), 'release');
      mkdirSync(source, { recursive: true });
      for (const name of names) writeFileSync(path.join(source, name), `current-${name}`);
      const result = spawnSync('bash', [script, ...(explicitTarget ? [triple] : [])], {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, CARGO_TARGET_DIR: cache, PATH: `${binDir}:${process.env.PATH}` },
      });
      assert.equal(result.status, 0, result.stderr);
      for (const name of names) assert.equal(readFileSync(path.join(root, 'desktop/src-tauri/binaries', `${name}-${triple}`), 'utf8'), `current-${name}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
