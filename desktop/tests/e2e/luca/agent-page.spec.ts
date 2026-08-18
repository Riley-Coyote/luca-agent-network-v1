import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

/**
 * A resident's page is a status strip and three sections — Documents,
 * Notebook, Settings. Documents is the agent folder: one row per document,
 * who writes it on the row, an editor that saves atomically and tells you
 * when the resident is running an older version.
 */

const RESIDENT = TEST_IDENTITIES.alice.pubkey;
const SOUL =
  "# alice\n\nYou are alice, a careful reader who answers plainly.\n";

async function openAlice(page: import("@playwright/test").Page) {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["alice-tyler"],
        name: "alice",
        pubkey: RESIDENT,
        status: "running",
      },
    ],
    residentDocuments: {
      [RESIDENT]: {
        "soul.md": SOUL,
        "notes/reading-list.md": "- The Left Hand of Darkness\n",
      },
    },
    searchProfiles: [{ displayName: "alice", isAgent: true, pubkey: RESIDENT }],
  });
  await page.goto("/?e2e=mock#/agents");
  await page.getByTestId(`agent-library-row-${RESIDENT}`).click();
  await expect(page.getByRole("heading", { name: "alice" })).toBeVisible();
}

test("the page lands on Documents and shows the folder by kind", async ({
  page,
}) => {
  await openAlice(page);

  const nav = page.getByRole("navigation", { name: "Agent workspace" });
  await expect(nav.getByRole("button", { name: "Documents" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("agent-strip-state")).toContainText("Ready");
  await expect(page.getByTestId("agent-strip-model")).toBeVisible();

  const documents = page.getByTestId("resident-documents");
  await expect(documents.getByTestId("resident-document-soul")).toContainText(
    "You write this",
  );
  await expect(
    documents.getByTestId("resident-document-soul-status"),
  ).toContainText(/B · edited/);
  await expect(
    documents.getByTestId("resident-document-selfModel"),
  ).toContainText("alice writes this");
  await expect(
    documents.getByTestId("resident-document-selfModel-status"),
  ).toHaveText("Not written yet");
  await expect(
    documents.getByTestId("resident-extra-file-notes/reading-list.md"),
  ).toBeVisible();
});

test("editing soul.md saves through the folder and asks for a restart", async ({
  page,
}) => {
  await openAlice(page);
  await page.getByTestId("resident-document-soul").click();

  const editor = page.getByTestId("resident-document-editor");
  const textarea = editor.getByTestId("resident-document-textarea");
  await expect(textarea).toHaveValue(SOUL);
  await expect(editor.getByTestId("resident-document-save")).toBeDisabled();

  await textarea.fill(`${SOUL}\nAnd you keep your promises.\n`);
  await expect(editor.getByTestId("resident-document-status")).toHaveText(
    "Unsaved changes",
  );
  await editor.getByTestId("resident-document-save").click();
  await expect(editor.getByTestId("resident-document-status")).toContainText(
    "Saved",
  );
  // The mock flips needs-restart on write, like the drift hash does live;
  // the note then says either that they restart on their own (auto-restart
  // on, the mock's default) or that they are still on the previous version.
  await expect(
    editor.getByTestId("resident-document-restart-note"),
  ).toContainText(/restarts on their own|still running the previous version/);

  await editor.getByTestId("resident-document-back").click();
  await expect(page.getByTestId("resident-document-soul-status")).toContainText(
    /B · edited/,
  );
});

test("a new file opens in the editor and lands under More files", async ({
  page,
}) => {
  await openAlice(page);
  await page.getByTestId("resident-new-file").click();
  await page.getByTestId("resident-new-file-path").fill("../escape.md");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByText("can't climb out of the folder")).toBeVisible();

  await page.getByTestId("resident-new-file-path").fill("notes/todo.md");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  const editor = page.getByTestId("resident-document-editor");
  await expect(editor).toContainText("notes/todo.md");
  await editor
    .getByTestId("resident-document-textarea")
    .fill("- ship chunk 1\n");
  await editor.getByTestId("resident-document-save").click();
  await expect(editor.getByTestId("resident-document-status")).toContainText(
    "Saved",
  );
  await editor.getByTestId("resident-document-back").click();
  await expect(
    page.getByTestId("resident-extra-file-notes/todo.md"),
  ).toBeVisible();
});

test("the strip opens logs; Settings carries the model and lifecycle switches", async ({
  page,
}) => {
  await openAlice(page);
  await page.getByTestId("agent-strip-logs").click();
  await expect(page.getByTestId("agent-logs-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("agent-logs-sheet")).toHaveCount(0);

  await page.getByTestId("agent-tab-settings").click();
  await expect(page.getByTestId("agent-settings-model")).toBeVisible();
  await expect(page.getByTestId("agent-settings-auto-restart")).toBeVisible();
  await expect(page.getByTestId("agent-settings-advanced")).toBeVisible();
});

test("the conversation drawer's Open lands on Documents", async ({ page }) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["alice-tyler"],
        name: "alice",
        pubkey: RESIDENT,
        status: "running",
      },
    ],
    residentDocuments: { [RESIDENT]: { "soul.md": SOUL } },
    searchProfiles: [{ displayName: "alice", isAgent: true, pubkey: RESIDENT }],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-alice-tyler").click();
  await page.getByRole("button", { name: "Open conversation details" }).click();
  await page.getByTestId("resident-drawer-open-agent").click();
  await expect(page.getByTestId("resident-documents")).toBeVisible();
  await expect(page.getByTestId("resident-document-soul")).toBeVisible();
});
