import assert from "node:assert/strict";
import test from "node:test";

let sequence = 0;
for (const stored of [
  null,
  { version: 1, visible: true, style: "sphere" },
  { version: 1, visible: true, style: "glyph", composerVisible: true },
]) {
  test(`composer sphere defaults off without changing the chosen identity style: ${JSON.stringify(stored)}`, async () => {
    let saved;
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => (stored ? JSON.stringify(stored) : null),
        setItem: (_key, value) => {
          saved = JSON.parse(value);
        },
      },
    });
    try {
      const { setChatMarkAppearance } = await import(
        `./chatMarkAppearancePreference.ts?test=${sequence++}`
      );
      const composerVisible = stored?.composerVisible === true;
      setChatMarkAppearance("a".repeat(64), { visible: false });
      assert.equal(saved.composerVisible, composerVisible);
      assert.equal(saved.style, stored?.style ?? "sphere");
      setChatMarkAppearance("a".repeat(64), {
        composerVisible: !composerVisible,
      });
      assert.equal(saved.composerVisible, !composerVisible);
      assert.equal(saved.visible, false);
    } finally {
      if (descriptor)
        Object.defineProperty(globalThis, "localStorage", descriptor);
      else delete globalThis.localStorage;
    }
  });
}
