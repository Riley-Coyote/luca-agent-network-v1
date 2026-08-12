import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFileSizeCheck } from "../../scripts/check-file-sizes-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const MAX_LINES = 1000;

const rules = [
  {
    root: "lib",
    extensions: new Set([".dart"]),
    maxLines: MAX_LINES,
  },
];

// Informational per-file ratchets for historically oversized files. Keep these
// thresholds honest, but split only when architecture, cohesion, or security
// review supports a substantive extraction—not to satisfy line count alone.
const overrides = new Map([
]);

await runFileSizeCheck({
  projectRoot,
  rules,
  overrides,
  label: "Mobile",
  scriptPath: "mobile/scripts/check-file-sizes.mjs",
});
