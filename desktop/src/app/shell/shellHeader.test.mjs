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
    assert.match(lip, /ref=\{setLipSlot\}/);
    assert.match(lip, /setShellLipActionsSlot\(element\)/);
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
    assert.match(
      header,
      /\.luca-lip-actions \{[^}]*right: calc\(8px \+ var\(--lip-pane-right, 0px\)\);/,
    );
  });

  it("fixes the reading area's top padding at the study's 22", async () => {
    const layout = await read("../../shared/layout/chromeLayout.ts");
    assert.match(layout, /SHELL_FRAME_CHANNEL_CONTENT_TOP_PADDING = "22px"/);
  });

  it("leaves the day's label where the timeline parks it", async () => {
    const header = await read("./shell-header.css");
    assert.doesNotMatch(header, /message-timeline-day-divider"\]\s*\{/);
  });

  it("gives the lip's name the conversation's description", async () => {
    const lip = await read("./ShellLip.tsx");
    assert.match(lip, /title=\{named \? getChannelDescription\(named\)/);
  });

  it("names nothing over an empty focused pane (WP-04b)", async () => {
    const lip = await read("./ShellLip.tsx");
    assert.match(lip, /const named = focusedPaneEmpty \? null : channel;/);
    assert.match(
      lip,
      /workspaceSlot\(workspace\.layout, workspace\.layout\.focusedSlotId\)/,
    );
  });

  it("fades every lip button over 120 ms, past the shell's blanket 150 (WP-04b)", async () => {
    const header = await read("./shell-header.css");
    assert.match(
      header,
      /:root\[data-luca-frame="solid"\]\s+\.luca-lip\s+:is\(\.luca-lip-button, \[data-testid="workspace-layout-menu"\]\) \{\s+transition:\s+color 120ms,\s+background-color 120ms;/,
    );
  });

  it("keeps the name clear of a wider slot, on the focused pane's axis", async () => {
    const [lip, header] = await Promise.all([
      read("./ShellLip.tsx"),
      read("./shell-header.css"),
    ]);
    assert.match(lip, /--lip-name-room/);
    assert.match(lip, /--lip-pane-left/);
    assert.match(lip, /--lip-pane-right/);
    assert.match(header, /\.luca-lip-card > \.luca-lip-name \{/);
    assert.match(header, /var\(--lip-name-room, 100px\)/);
  });

  it("draws the lip's presence in fixed points", async () => {
    const screen = await read(
      "../../features/channels/ui/ChannelScreenHeader.tsx",
    );
    assert.match(screen, /sizeUnit="px"/);
    assert.match(screen, /data-testid="shell-pane-name"/);
  });
});
