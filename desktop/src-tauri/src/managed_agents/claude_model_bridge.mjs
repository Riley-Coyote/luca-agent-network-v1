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
    const result = await original.apply(this, args);
    const session = this.sessions[result.sessionId];
    extendModelCatalog(session);
    result.configOptions = session.configOptions;
    return result;
  };
}
