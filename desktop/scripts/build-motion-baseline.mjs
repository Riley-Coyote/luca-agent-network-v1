/** Build a recorded frontend revision without replacing anyone's working files.
 * Uses the normal checkout, dependencies and dist; never another native cache.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { build, loadConfigFromFile, mergeConfig } from "vite";

const ref = process.argv[2];
if (!ref || !/^[a-f0-9]{7,40}$/.test(ref)) {
  throw new Error("Supply the recorded baseline commit hash.");
}
const root = path.resolve(import.meta.dirname, "../..");
const revision = execFileSync(
  "git",
  ["rev-parse", "--verify", `${ref}^{commit}`],
  {
    cwd: root,
    encoding: "utf8",
  },
).trim();
const originals = new Map();
const sourceFiles = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", revision, "desktop/src"],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split("\n");
// Read all original text in one Git process, so edits during the build cannot
// leak into the baseline. No checkout or node_modules link is created.
const modules = sourceFiles.filter((file) =>
  /\.(?:[cm]?[jt]sx?|css|json)$/.test(file),
);
const blobs = execFileSync("git", ["cat-file", "--batch"], {
  cwd: root,
  input: modules.map((file) => `${revision}:${file}\n`).join(""),
  maxBuffer: 64 * 1024 * 1024,
});
let offset = 0;
for (const file of modules) {
  const end = blobs.indexOf(10, offset);
  const header = blobs.subarray(offset, end).toString("utf8");
  const match = /^[a-f0-9]+ blob (\d+)$/.exec(header);
  if (!match) throw new Error(`Unexpected Git object for ${file}`);
  const size = Number(match[1]);
  offset = end + 1;
  originals.set(
    path.join(root, file),
    blobs.subarray(offset, offset + size).toString("utf8"),
  );
  offset += size + 1;
}
const config = await loadConfigFromFile(
  { command: "build", mode: "e2e" },
  path.join(root, "desktop/vite.config.ts"),
);
if (!config) throw new Error("The existing Vite config could not be loaded.");
console.log(`Motion baseline ${revision}; ${originals.size} source overrides`);
await build(
  mergeConfig(config.config, {
    configFile: false,
    root: path.join(root, "desktop"),
    mode: "e2e",
    plugins: [
      {
        name: "recorded-motion-baseline",
        enforce: "pre",
        load(id) {
          if (id.includes("?")) return;
          return originals.get(id);
        },
      },
    ],
  }),
);
