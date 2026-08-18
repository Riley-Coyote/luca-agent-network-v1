/**
 * Bundle entry for the standalone lab page.
 *
 * The lab is built to a single self-contained HTML file rather than served by
 * the dev server on purpose: the repo can have more than one vite instance bound
 * to the same port across worktrees (one on IPv4, one on IPv6), and which one
 * `localhost` resolves to is not something a design tool should depend on.
 */

import { labProbe, mountLab } from "./lab-ui";

function start(): void {
  const root = document.getElementById("lab-root");
  if (!root) throw new Error("dot-lab: #lab-root missing");
  mountLab(root);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}

// Read by the headless verification pass.
(window as unknown as Record<string, unknown>).__labProbe = labProbe;
