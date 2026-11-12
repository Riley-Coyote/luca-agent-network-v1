import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RuntimeTaskConfirmationCard,
  privateAskAccessSelection,
} from "./RuntimeTaskConfirmationCard.tsx";
import { runtimeTaskProposalDefaultResponse } from "./RuntimeTaskProposalConfirmation.tsx";

const draft = {
  conversationId: "private-chat",
  residentPubkey: "resident",
  residentName: "Luca",
  runtimeFamily: "claude_code",
  summary: "Write a poem",
  prompt: "Write a poem",
  options: { purpose: "ask", model: "claude-bound-model" },
  targetWorkingFolder: "/private/owner-only-scratch",
  workingFolder: "/private/owner-only-scratch",
};

function render(fields = {}) {
  const client = new QueryClient();
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(RuntimeTaskConfirmationCard, {
        draft: { ...draft, ...fields },
        onCancel() {},
        onConfirm: async () => {},
        onConfirmed() {},
      }),
    ),
  );
}

test("API access needs host eligibility plus explicit selection; remember alone never switches accounts", () => {
  for (const canRememberPrivateAsk of [undefined, false]) {
    assert.deepEqual(
      privateAskAccessSelection(
        { ...draft, canRememberPrivateAsk },
        true,
        true,
      ),
      {},
    );
  }
  const eligible = { ...draft, canRememberPrivateAsk: true };
  assert.deepEqual(privateAskAccessSelection(eligible, false, true), {});
  assert.deepEqual(privateAskAccessSelection(eligible, true, false), {
    useClaudeApi: true,
    rememberAccess: false,
    runtimeFamily: "claude_code",
    permissionMode: "normal",
    workingFolder: draft.targetWorkingFolder,
  });
  assert.equal(
    privateAskAccessSelection(eligible, true, true).rememberAccess,
    true,
  );
});

test("API selection cannot carry an alternate runtime, full access, or a selected project folder", () => {
  const selection = privateAskAccessSelection(
    {
      ...draft,
      canRememberPrivateAsk: true,
      runtimeFamily: "codex",
      workingFolder: "/project/secret",
    },
    true,
    true,
  );
  assert.equal(selection.runtimeFamily, "claude_code");
  assert.equal(selection.permissionMode, "normal");
  assert.equal(selection.workingFolder, draft.targetWorkingFolder);
});

test("new review starts unchecked and discloses billing, budget and no project tools", () => {
  for (const summary of ["Write a poem", "Write another poem"]) {
    const html = render({ canRememberPrivateAsk: true, summary });
    assert.match(html, /Use the connected Claude API account for this answer/);
    assert.match(html, /\$0\.25 task budget/);
    assert.match(html, /Final charges come from Anthropic/);
    assert.match(html, /No project files or tools/);
    assert.match(html, /Only your current message goes to/);
    assert.match(html, /claude-bound-model/);
    assert.doesNotMatch(html, /Synthetic writing only/);
    assert.doesNotMatch(html, /checked=""/);
    assert.doesNotMatch(html, /Remember for matching asks/);
    assert.match(html, /type="checkbox"/);
    assert.match(html, /aria-describedby=/);
  }
});

test("shared Needs-you and Activity Run never selects API or remembers access implicitly", () => {
  const proposal = {
    ...draft,
    proposalId: "proposal",
    canRememberPrivateAsk: true,
  };
  assert.deepEqual(
    runtimeTaskProposalDefaultResponse(proposal, "/scratch", true),
    {
      approved: true,
      permissionMode: "normal",
      proposalId: "proposal",
      runtimeFamily: "claude_code",
      workingFolder: "/scratch",
    },
  );
  assert.deepEqual(
    runtimeTaskProposalDefaultResponse(proposal, "/scratch", false),
    {
      approved: false,
      proposalId: "proposal",
    },
  );
  for (const folder of [null, "   "]) {
    assert.throws(
      () => runtimeTaskProposalDefaultResponse(proposal, folder, true),
      /Nothing was started/,
    );
  }
});

test("ineligible proposals keep the existing native review without API controls", () => {
  const html = render();
  assert.doesNotMatch(html, /connected Claude API account/);
  assert.match(html, /Working folder/);
  assert.match(html, /Permission mode/);
});

test("the compact review cannot send to a folder or label instead of the exact native session", () => {
  const proposal = {
    ...draft,
    proposalId: "native",
    operation: "send_message",
    sourceId: "source",
    sessionId: "session",
    targetWorkingFolder: "/exact",
  };
  for (const changed of [
    { sourceId: "" },
    { sessionId: " " },
    { targetWorkingFolder: null },
  ]) {
    assert.throws(
      () =>
        runtimeTaskProposalDefaultResponse(
          { ...proposal, ...changed },
          "/exact",
          true,
        ),
      /Nothing was sent/,
    );
  }
  assert.throws(
    () => runtimeTaskProposalDefaultResponse(proposal, "/previous", true),
    /Nothing was sent/,
  );
  assert.equal(
    runtimeTaskProposalDefaultResponse(proposal, "/exact", true).approved,
    true,
  );
  assert.equal(
    runtimeTaskProposalDefaultResponse(
      { ...proposal, sourceId: null },
      null,
      false,
    ).approved,
    false,
  );
});
