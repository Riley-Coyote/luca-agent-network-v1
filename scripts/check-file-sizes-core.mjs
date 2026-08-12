import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Shared file-size review used by the desktop, web, and mobile workspaces.
 *
 * Each app supplies its own `rules` (which roots/extensions to scan) and an
 * optional `overrides` map of per-file informational thresholds. Everything
 * else — the walk, the line count, and the review warning — lives here so the
 * apps can never drift. Size findings are intentionally advisory; operational
 * checker failures still reject through normal thrown errors.
 */

async function walkFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(fullPath);
      }

      return [fullPath];
    }),
  );

  return files.flat();
}

function findRule(rules, relativePath) {
  return rules.find((rule) => {
    const normalizedRoot = `${rule.root}${path.sep}`;
    return relativePath.startsWith(normalizedRoot);
  });
}

function countLines(content) {
  if (content.length === 0) {
    return 0;
  }

  return content.split(/\r?\n/).length;
}

/**
 * @param {object} options
 * @param {string} options.projectRoot Absolute path the rule roots resolve against.
 * @param {Array<{root: string, extensions: Set<string>, maxLines: number}>} options.rules
 * @param {string} options.label Human label for the warning header (e.g. "Desktop").
 * @param {Map<string, number>} [options.overrides] Per-file informational thresholds, keyed by path relative to projectRoot.
 * @param {string} options.scriptPath Path mentioned in the review hint where thresholds live.
 */
export async function runFileSizeCheck({
  projectRoot,
  rules,
  label,
  overrides = new Map(),
  scriptPath,
}) {
  const candidateFiles = (
    await Promise.all(
      rules.map((rule) => {
        const dir = path.join(projectRoot, rule.root);
        return fs
          .access(dir)
          .then(() => walkFiles(dir))
          .catch(() => []);
      }),
    )
  ).flat();

  const violations = [];

  for (const filePath of candidateFiles) {
    const relativePath = path.relative(projectRoot, filePath);
    const rule = findRule(rules, relativePath);
    if (!rule) {
      continue;
    }

    const extension = path.extname(relativePath);
    if (!rule.extensions.has(extension)) {
      continue;
    }

    const limit = overrides.get(relativePath) ?? rule.maxLines;
    const content = await fs.readFile(filePath, "utf8");
    const lineCount = countLines(content);
    if (lineCount > limit) {
      violations.push({ limit, lineCount, relativePath });
    }
  }

  if (violations.length > 0) {
    console.warn(`${label} file size review warnings:`);
    for (const violation of violations) {
      console.warn(
        `- ${violation.relativePath}: ${violation.lineCount} lines (limit ${violation.limit})`,
      );
    }
    console.warn(
      `Review cohesion and complexity; update the informational threshold in \`${scriptPath}\` only when the larger file is intentional.`,
    );
  }

  return violations;
}
