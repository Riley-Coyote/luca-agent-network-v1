import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extendModelCatalog,
  installModelBridge,
  VERSION_MODELS,
} from "./claude_model_bridge.mjs";

function session(settings = {}) {
  return {
    settingsManager: { getSettings: () => settings },
    modelInfos: [{ value: "opus[1m]", displayName: "Opus" }],
    models: {
      currentModelId: "opus[1m]",
      availableModels: [{ modelId: "opus[1m]" }],
    },
    configOptions: [
      {
        category: "model",
        id: "model",
        currentValue: "opus[1m]",
        options: [{ value: "opus[1m]", name: "Opus" }],
      },
    ],
  };
}
test("all documented versions are exact pins, aliases remain, no duplicate rows", () => {
  const s = session();
  extendModelCatalog(s);
  extendModelCatalog(s);
  assert.equal(s.modelInfos.length, VERSION_MODELS.length + 1);
  assert.equal(s.models.currentModelId, "opus[1m]");
  for (const [value, name] of VERSION_MODELS) {
    assert.equal(
      s.configOptions[0].options.find((o) => o.value === value).name,
      name,
    );
    assert.equal(
      s.modelInfos.find((o) => o.value === value).resolvedModel,
      value,
    );
  }
  assert(!s.modelInfos.some((m) => m.value === "claude-sonnet-5-1"));
});
test("explicit restrictions including an empty allowlist are never widened", () => {
  for (const availableModels of [[], ["opus"]]) {
    const s = session({ availableModels });
    extendModelCatalog(s);
    assert.equal(s.modelInfos.length, 1);
  }
});
test("custom endpoints and cloud providers keep native catalogs", () => {
  for (const env of [
    { ANTHROPIC_BASE_URL: "https://example.test" },
    { CLAUDE_CODE_USE_BEDROCK: "1" },
    { CLAUDE_CODE_USE_VERTEX: "1" },
    { CLAUDE_CODE_USE_FOUNDRY: "1" },
  ]) {
    const s = session({ env });
    extendModelCatalog(s);
    assert.equal(s.modelInfos.length, 1);
  }
});
test("session bridge makes exact IDs selectable without changing selected model", async () => {
  class FakeAgent {
    sessions = { abc: session() };
    async createSession() {
      return {
        sessionId: "abc",
        configOptions: this.sessions.abc.configOptions,
      };
    }
  }
  installModelBridge(FakeAgent);
  const agent = new FakeAgent();
  const result = await agent.createSession();
  assert(
    result.configOptions[0].options.some((o) => o.value === "claude-opus-4-6"),
  );
  assert.equal(agent.sessions.abc.models.currentModelId, "opus[1m]");
});
test("an incompatible adapter fails explicitly", () => {
  assert.throws(
    () => installModelBridge(class {}),
    /Unsupported Claude model adapter/,
  );
});
