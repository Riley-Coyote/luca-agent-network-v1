import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("presence marks keep a 22px glyph inside a 32px control", async () => {
  const source = await readFile(
    new URL("./ConversationPresenceRail.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /className="flex size-8 items-center justify-center/);
  assert.match(source, /size=\{22\}/);
});
