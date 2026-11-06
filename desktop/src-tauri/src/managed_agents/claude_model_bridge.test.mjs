import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extendModelCatalog,
  installModelBridge,
  VERSION_MODELS,
  apiKeySessionParams,
  verifyApiKeySession,
} from "./claude_model_bridge.mjs";

test("API execution requires native confirmation and rejects conflicting native auth", async () => {
  const env = { ANTHROPIC_API_KEY: "test-only-key" };
  const fixture = (account, configured = {}) => ({
    settingsManager: { getSettings: () => ({ env: configured }) },
    query: { initializationResult: async () => ({ account }) },
  });
  await verifyApiKeySession(
    fixture({ apiProvider: "firstParty", apiKeySource: "ANTHROPIC_API_KEY" }),
    env,
  );
  for (const account of [
    undefined,
    { apiProvider: "gateway", apiKeySource: "ANTHROPIC_API_KEY" },
    { apiProvider: "firstParty", apiKeySource: "oauth" },
  ]) {
    await assert.rejects(
      () => verifyApiKeySession(fixture(account), env),
      /did not confirm direct API-key billing/,
    );
  }
  for (const configured of [
    { ANTHROPIC_API_KEY: "different" },
    { ANTHROPIC_AUTH_TOKEN: "native-token" },
    { CLAUDE_CODE_USE_VERTEX: "1" },
  ]) {
    await assert.rejects(
      () => verifyApiKeySession(fixture({}, configured), env),
      /another API credential or provider/,
    );
  }
});

test("API credentials stay in SDK env, not settings argv; unrelated options survive", () => {
  const original = {
    cwd: "/project",
    _meta: {
      claudeCode: {
        options: {
          tools: ["Read"],
          settings: { availableModels: ["sonnet"] },
          env: {
            ANTHROPIC_API_KEY: "wrong",
            ANTHROPIC_AUTH_TOKEN: "other",
            KEEP: "yes",
          },
        },
      },
    },
  };
  const params = apiKeySessionParams(original, {
    ANTHROPIC_API_KEY: "test-only-key",
  });
  const options = params._meta.claudeCode.options;
  assert.equal(options.env.ANTHROPIC_API_KEY, "test-only-key");
  assert.equal(options.env.ANTHROPIC_AUTH_TOKEN, "");
  assert.equal(options.env.CLAUDE_CODE_OAUTH_TOKEN, "");
  assert.equal(options.env.CLAUDE_CODE_USE_BEDROCK, "0");
  assert.equal(options.env.KEEP, "yes");
  assert.deepEqual(options.tools, ["Read"]);
  assert.deepEqual(options.settings.availableModels, ["sonnet"]);
  assert(!JSON.stringify(options.settings).includes("test-only-key"));
  assert.equal(
    original._meta.claudeCode.options.env.ANTHROPIC_API_KEY,
    "wrong",
  );
});

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
