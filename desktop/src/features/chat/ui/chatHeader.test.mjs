import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("conversation presence reflows with container width and root type scale", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("./ChatHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("./chatHeader.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /luca-chat-header__presence-wide/);
  assert.match(source, /luca-chat-header__presence-stacked/);
  assert.doesNotMatch(source, /min-\[56rem\]/);
  assert.match(styles, /container-type:\s*inline-size/);
  assert.match(styles, /@container luca-chat-header \(min-width:\s*56em\)/);
});
