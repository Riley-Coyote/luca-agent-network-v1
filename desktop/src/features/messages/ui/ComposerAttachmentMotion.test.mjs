import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("./ComposerAttachments.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "ComposerAttachments.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findAll(root, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

test("tray presence stays mounted and propagates the final attachment exit", () => {
  const boundary = findAll(
    ast,
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(ast) === "AnimatePresence" &&
      node.openingElement.attributes.getText(ast).includes("initial={false}"),
  )[0];
  assert.ok(boundary, "persistent tray presence boundary");
  assert.match(boundary.getText(ast), /hasAttachments &&/);
  assert.match(boundary.getText(ast), /key="attachment-tray"/);
  assert.match(source, /const isPresent = useIsPresent\(\)/);
  assert.match(source, /inert=\{!isPresent\}/);
  assert.match(source, /aria-hidden=\{!isPresent \|\| undefined\}/);
  assert.match(
    boundary.getText(ast),
    /<AnimatePresence mode="popLayout" propagate>/,
  );
  assert.doesNotMatch(source, /if \(attachments.length === 0.*return null/);
  for (const relative of [
    "./MessageComposer.tsx",
    "../../forum/ui/ForumComposerMediaStatus.tsx",
  ]) {
    const owner = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.doesNotMatch(
      owner,
      /pendingImeta.length > 0 \|\| media.isUploading/,
    );
    assert.match(owner, /<ComposerAttachments\s+className="mb-2"/);
  }
});

test("attachment spatial targets/layout have local reduced-motion alternatives", () => {
  const motionRoots = findAll(
    ast,
    (node) =>
      ts.isJsxOpeningElement(node) &&
      node.tagName.getText(ast) === "motion.div",
  );
  assert.equal(motionRoots.length, 5);
  for (const node of motionRoots) {
    const attributes = node.attributes.getText(ast);
    assert.match(attributes, /layout=\{!reduceMotion\}/);
    for (const attribute of node.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      if (
        ["animate", "initial", "exit"].includes(attribute.name.getText(ast)) &&
        attribute.initializer?.getText(ast).includes("scale:")
      ) {
        assert.match(
          attribute.initializer.getText(ast),
          /reduceMotion\s+\? \{ opacity: [01] \}\s+:/,
        );
      }
    }
  }
});

test("removal restores editor focus only when the removed control owns it", () => {
  const helper = ast.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "focusEditorBeforeRemoval",
  );
  assert.ok(helper);
  const javascript = ts.transpileModule(helper.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const restoreFocus = vm.runInNewContext(
    `${javascript}; focusEditorBeforeRemoval`,
  );
  let focused = 0;
  let searched = 0;
  const editor = {
    focus(options) {
      assert.equal(options.preventScroll, true);
      focused++;
    },
  };
  const button = {
    ownerDocument: { activeElement: null },
    closest(selector) {
      assert.equal(selector, "form");
      searched++;
      return {
        querySelector(selector) {
          assert.equal(selector, '[contenteditable="true"], textarea');
          return editor;
        },
      };
    },
  };
  restoreFocus({ currentTarget: button });
  assert.equal(focused, 0);
  assert.equal(searched, 0);
  button.ownerDocument.activeElement = button;
  restoreFocus({ currentTarget: button });
  assert.equal(focused, 1);
  button.closest = () => null;
  assert.doesNotThrow(() => restoreFocus({ currentTarget: button }));
});

test("tooltip and annotation entry keep fades but gate spatial CSS", () => {
  const tooltip = readFileSync(
    new URL("../../../shared/ui/tooltip.tsx", import.meta.url),
    "utf8",
  );
  assert.match(tooltip, /animate-in fade-in-0/);
  for (const token of tooltip.match(
    /[^\s"]*(?:zoom|slide)-(?:in|out)[^\s"]*/g,
  ) ?? []) {
    assert.ok(token.startsWith("motion-safe:"), token);
  }
  const toolbar = readFileSync(
    new URL("./ComposerImageEditor.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    toolbar,
    /animate-in fade-in motion-safe:slide-in-from-right-12/,
  );
});

test("shared tabs do not interpolate typography or geometry", () => {
  const tabs = readFileSync(
    new URL("../../../shared/ui/tabs.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(tabs, /transition-all/);
  assert.match(tabs, /transition-\[color,background-color,box-shadow\]/);
  const projectTabs = readFileSync(
    new URL("../../projects/ui/ProjectWorkspaceTabList.tsx", import.meta.url),
    "utf8",
  );
  assert.match(projectTabs, /invisible.*font-semibold/);
});
