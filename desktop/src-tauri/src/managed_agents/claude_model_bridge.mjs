// App-owned compatibility bridge for claude-agent-acp 0.61.x. The upstream
// package is never modified. All execution/permissions remain in its SDK.
// Version IDs: https://platform.claude.com/docs/en/about-claude/model-deprecations
// Reviewed 2026-09-15. These are documented active versions, NOT an entitlement
// claim. Claude validates account/provider access when executing the request.
export const VERSION_MODELS = [
  ["claude-fable-5-1", "Fable 5.1"],
  ["claude-fable-5", "Fable 5"],
  ["claude-opus-5", "Opus 5"],
  ["claude-opus-4-8", "Opus 4.8"],
  ["claude-opus-4-7", "Opus 4.7"],
  ["claude-opus-4-6", "Opus 4.6"],
  ["claude-opus-4-5-20251101", "Opus 4.5"],
  ["claude-sonnet-5", "Sonnet 5"],
  ["claude-sonnet-4-6", "Sonnet 4.6"],
  ["claude-sonnet-4-5-20250929", "Sonnet 4.5"],
  ["claude-haiku-4-5-20251001", "Haiku 4.5"],
];

export function extendModelCatalog(session) {
  const settings = session.settingsManager.getSettings();
  // Never widen a user's or administrator's explicit model restriction.
  if (Array.isArray(settings.availableModels)) return;
  // Provider aliases/ARNs must remain provider-owned. Only extend the ordinary
  // Anthropic catalog; do not guess mappings for a custom gateway or cloud.
  const env = { ...process.env, ...settings.env };
  if (
    env.CLAUDE_CODE_USE_BEDROCK === "1" ||
    env.CLAUDE_CODE_USE_VERTEX === "1" ||
    env.CLAUDE_CODE_USE_FOUNDRY === "1" ||
    (env.ANTHROPIC_BASE_URL &&
      env.ANTHROPIC_BASE_URL.replace(/\/$/, "") !== "https://api.anthropic.com")
  )
    return;
  const option = session.configOptions.find((o) => o.category === "model");
  if (
    !option ||
    !Array.isArray(option.options) ||
    !Array.isArray(session.modelInfos) ||
    !Array.isArray(session.models?.availableModels)
  ) {
    throw new Error(
      "Claude model adapter changed. Update the Polyphonic runtime integration before selecting a model.",
    );
  }
  const seen = new Set(session.modelInfos.map((m) => m.value));
  for (const [value, displayName] of VERSION_MODELS) {
    if (seen.has(value)) continue;
    const description =
      "Pinned version · availability depends on your Claude account";
    // Do not copy capabilities from a newer alias onto an older version.
    session.modelInfos.push({
      value,
      displayName,
      description,
      resolvedModel: value,
    });
    session.models.availableModels.push({
      modelId: value,
      name: displayName,
      description,
    });
    option.options.push({ value, name: displayName, description });
    seen.add(value);
  }
}

export function installModelBridge(ClaudeAcpAgent) {
  const original = ClaudeAcpAgent.prototype.createSession;
  if (typeof original !== "function")
    throw new Error(
      "Unsupported Claude model adapter. Reinstall the Claude Code connection in Polyphonic.",
    );
  ClaudeAcpAgent.prototype.createSession = async function (...args) {
    if (process.env.LUCA_CLAUDE_API_AUTH === "1") {
      if (!process.env.ANTHROPIC_API_KEY)
        throw new Error(
          "Claude API key is unavailable. Reconnect in Settings.",
        );
      if (this.resolveProviderConfig?.())
        throw new Error(
          "Claude API billing cannot be combined with another provider route.",
        );
      args[0] = apiKeySessionParams(args[0], process.env);
    }
    const result = await original.apply(this, args);
    const session = this.sessions[result.sessionId];
    if (process.env.LUCA_CLAUDE_API_AUTH === "1") {
      try {
        await verifyApiKeySession(session, process.env);
      } catch (error) {
        session.query.close();
        delete this.sessions[result.sessionId];
        throw error;
      }
    }
    extendModelCatalog(session);
    result.configOptions = session.configOptions;
    return result;
  };
}

export async function verifyApiKeySession(session, env) {
  // Native/project env can outrank SDK options.env in some CLI versions.
  // Respect those files, but refuse to execute on a different billing route.
  const configured = session.settingsManager.getSettings().env ?? {};
  const required = apiKeySessionParams({}, env)._meta.claudeCode.options.env;
  for (const name of Object.keys(required)) {
    const value = configured[name];
    if (value && value !== required[name])
      throw new Error(
        "Claude settings select another API credential or provider. Resolve that conflict before using this Polyphonic API connection.",
      );
  }
  const { account } = await session.query.initializationResult();
  if (
    account?.apiProvider !== "firstParty" ||
    account?.apiKeySource !== "ANTHROPIC_API_KEY"
  )
    throw new Error(
      "Claude did not confirm direct API-key billing. Polyphonic stopped before sending your message; no subscription fallback was used.",
    );
}

// Credentials stay in the SDK child environment, never --settings argv, model
// catalogs, transcript bodies or ACP replies. Per-session env cannot redirect
// a selected direct Anthropic connection back to OAuth/a cloud provider.
export function apiKeySessionParams(params = {}, env) {
  const claude = params._meta?.claudeCode ?? {};
  const options = claude.options ?? {};
  return {
    ...params,
    _meta: {
      ...params._meta,
      claudeCode: {
        ...claude,
        options: {
          ...options,
          settings: { ...options.settings, apiKeyHelper: "" },
          env: {
            ...options.env,
            ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
            ANTHROPIC_BASE_URL: "https://api.anthropic.com",
            ANTHROPIC_AUTH_TOKEN: "",
            CLAUDE_CODE_OAUTH_TOKEN: "",
            CLAUDE_CODE_USE_BEDROCK: "0",
            CLAUDE_CODE_USE_VERTEX: "0",
            CLAUDE_CODE_USE_FOUNDRY: "0",
          },
        },
      },
    },
  };
}
