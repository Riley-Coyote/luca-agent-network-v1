import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  getShellLipActionsSlot,
  setShellLipActionsSlot,
} from "./lipActionsSlot.ts";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

describe("the lip's right-hand slot (WP-04)", () => {
  it("holds the element the lip mounts, and lets it go", () => {
    assert.equal(getShellLipActionsSlot(), null);
    const element = { nodeName: "DIV" };
    setShellLipActionsSlot(element);
    assert.equal(getShellLipActionsSlot(), element);
    setShellLipActionsSlot(null);
    assert.equal(getShellLipActionsSlot(), null);
  });

  it("is drawn inside the lip's part over the card, after the name", async () => {
    const lip = await read("./ShellLip.tsx");
    const card = lip.indexOf('className="luca-lip-card"');
    const name = lip.indexOf('data-testid="shell-lip-name"');
    const slot = lip.indexOf('data-testid="shell-lip-actions"');
    assert.ok(card > 0 && name > card && slot > name);
    assert.match(lip, /ref=\{setShellLipActionsSlot\}/);
  });

  it("keeps the header's styles in its own stylesheet, after the frame's", async () => {
    const [globals, frame, header] = await Promise.all([
      read("../../shared/styles/globals.css"),
      read("../../shared/styles/globals/shell-frame.css"),
      read("./shell-header.css"),
    ]);
    const frameImport = globals.indexOf('@import "./globals/shell-frame.css";');
    const headerImport = globals.indexOf(
      '@import "../../app/shell/shell-header.css";',
    );
    assert.ok(frameImport > 0 && headerImport > frameImport);
    assert.doesNotMatch(frame, /chat-title/);
    assert.match(header, /\[data-testid="chat-title"\]/);
    assert.match(header, /\.luca-lip-actions \{[^}]*right: 8px;/);
  });

  it("fixes the reading area's top padding at the study's 22", async () => {
    const layout = await read("../../shared/layout/chromeLayout.ts");
    assert.match(layout, /SHELL_FRAME_CHANNEL_CONTENT_TOP_PADDING = "22px"/);
  });
});
