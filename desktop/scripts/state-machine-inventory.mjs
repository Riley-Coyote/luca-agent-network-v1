#!/usr/bin/env node
/** Source signals, not a proof that every signal is a machine or a defect. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const lifecycleName =
  /state|status|phase|step|stage|pending|busy|generation|epoch|inflight|running|cancel|mounted|visible|loading/i;

function hookName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (
    ts.isPropertyAccessExpression(node) &&
    node.expression.getText() === "React"
  )
    return node.name.text;
  return null;
}

function ownerOf(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!ts.isFunctionLike(parent)) continue;
    if (parent.name && ts.isIdentifier(parent.name)) return parent.name.text;
    if (ts.isVariableDeclaration(parent.parent))
      return parent.parent.name.getText();
  }
  return "module";
}

/** Find structural React lifecycle signals without copying initializer bodies. */
export function typescriptSignals(source, filename = "fixture.tsx") {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const signals = [];
  const add = (node, kind, name, extra = {}) =>
    signals.push({
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      owner: ownerOf(node),
      kind,
      name,
      ...extra,
    });
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const hook = hookName(node.expression);
      const declaration = ts.isVariableDeclaration(node.parent)
        ? node.parent
        : null;
      const name = declaration
        ? ts.isArrayBindingPattern(declaration.name)
          ? (declaration.name.elements[0]?.name?.getText(file) ?? "anonymous")
          : declaration.name.getText(file)
        : "anonymous";
      if (hook === "useState") {
        const initial = node.arguments[0];
        const declared = node.typeArguments?.[0];
        const boolean =
          declared?.kind === ts.SyntaxKind.BooleanKeyword ||
          initial?.kind === ts.SyntaxKind.TrueKeyword ||
          initial?.kind === ts.SyntaxKind.FalseKeyword;
        add(node, "state", name, { boolean });
      } else if (hook === "useReducer" || hook === "useSyncExternalStore") {
        add(node, hook === "useReducer" ? "reducer" : "external-store", name);
      } else if (hook === "useRef" && lifecycleName.test(name)) {
        add(node, "lifecycle-ref", name);
      }
    }
    if (
      ts.isTypeAliasDeclaration(node) &&
      ts.isUnionTypeNode(node.type) &&
      lifecycleName.test(node.name.text)
    ) {
      const values = node.type.types.flatMap((member) => {
        if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal))
          return [member.literal.text];
        if (!ts.isTypeLiteralNode(member)) return [];
        return member.members.flatMap((field) =>
          ts.isPropertySignature(field) &&
          lifecycleName.test(field.name.getText(file)) &&
          field.type &&
          ts.isLiteralTypeNode(field.type) &&
          ts.isStringLiteral(field.type.literal)
            ? [field.type.literal.text]
            : [],
        );
      });
      if (values.length > 1)
        add(node, "state-union", node.name.text, { values });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return {
    signals,
    parseErrors: file.parseDiagnostics.map((diagnostic) => diagnostic.code),
  };
}

/** Lexical Rust search hints, deliberately not a transition/authority parser. */
export function rustSignals(source) {
  const signals = [];
  // Rust has no parser dependency here. These are deliberately only search
  // signals; inline test modules and comments can occur in the same source.
  source.split("\n").forEach((line, index) => {
    const enumeration = line.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)/);
    const boolean = line.match(
      /^\s*(?:pub(?:\([^)]*\))?\s+)?(\w+)\s*:\s*(AtomicBool|bool)\b/,
    );
    if (enumeration && lifecycleName.test(enumeration[1])) {
      signals.push({
        line: index + 1,
        kind: "rust-state-enum",
        name: enumeration[1],
      });
    } else if (boolean && lifecycleName.test(boolean[1])) {
      signals.push({
        line: index + 1,
        kind: "rust-lifecycle-flag",
        name: boolean[1],
      });
    }
  });
  return signals;
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      ["testing", "tests", "__tests__", "node_modules", "target"].includes(
        entry.name,
      )
    )
      return [];
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(name);
    if (
      !entry.isFile() ||
      !/\.(tsx?|rs)$/.test(name) ||
      /(?:\.test\.|\.spec\.|_tests\.rs$)/.test(name)
    )
      return [];
    return [name]; // Never follow a symlink onto external storage.
  });
}

/** Read the selected source roots only; return a reproducible, body-free index. */
export function inventory() {
  const files = ["desktop/src", "desktop/src-tauri/src", "crates"]
    .flatMap((relative) => filesUnder(path.join(root, relative)))
    .sort()
    .map((filename) => {
      const source = readFileSync(filename, "utf8");
      const result = filename.endsWith(".rs")
        ? { signals: rustSignals(source), parseErrors: [] }
        : typescriptSignals(source, filename);
      return { file: path.relative(root, filename), ...result };
    });
  const counts = {};
  for (const file of files)
    for (const signal of file.signals)
      counts[signal.kind] = (counts[signal.kind] ?? 0) + 1;
  return {
    schema: "polyphonic.state-signals.v1",
    scope:
      "Shipping desktop TypeScript, native Rust and shared crates; no design labs, website, dependency or test files; no symlink traversal.",
    limitations: [
      "Signals are candidates, not machines, bugs or verified transition graphs.",
      "TypeScript hook aliases and state hidden in dependencies, ordinary fields, closures, SQL or wire protocols are not exhaustively detected.",
      "Rust signals are lexical and can include inline tests or comments. Inspect authority and transition guards manually.",
      "Independent booleans can be legitimate orthogonal state; do not combine them without proving mutual exclusion.",
    ],
    summary: {
      filesScanned: files.length,
      filesWithSignals: files.filter((file) => file.signals.length > 0).length,
      counts,
    },
    files: files.filter(
      (file) => file.signals.length > 0 || file.parseErrors.length > 0,
    ),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = inventory();
  if (process.argv.includes("--json"))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
    process.stdout.write(
      "\nSource signals only. Use --json for file, line and owning function. See plans/2026-11-09-state-machines.md for reviewed flows and decisions.\n",
    );
  }
}
