# Luca Settings and Agent System Verdict

Verdict: **PASS for the scoped Settings and agent-system foundation**

The installed Luca development application now provides:

- Luca-native Settings navigation with only supported product surfaces;
- one shared agent configuration model across Settings and Agent Library;
- honest Polyphonic, Hermes, and OpenClaw origin and authority labels;
- runtime health for Claude Code, Codex, Hermes, and OpenClaw;
- Luca-owned local stdio MCP connections with Keychain-backed secret values;
- per-agent MCP grants delivered only through the trusted local managed-runtime
  boundary;
- real companion pairing through the existing secure protocol;
- Luca-owned security, backup, diagnostics, update, and About surfaces;
- required upstream attribution only inside third-party notices.

## Security boundary

MCP secret values are not persisted in registry metadata, renderer fixtures,
relay events, prompts, command arguments, native runtime configuration, or
process-global environment variables. They are resolved from Keychain only for
an authorized resident session and cross an anonymous inherited descriptor.
The existing permission system still gates tool use. Continuity cognition does
not receive managed MCP tools.

## Deliberately deferred

- new Polyphonic Agent creation;
- native Hermes or OpenClaw creation/editing;
- direct-provider execution and provider-key storage;
- HTTP or SSE MCP transports;
- persistent paired-device administration;
- cloud synchronization and mobile administration.

These omissions are explicit product boundaries, not hidden or simulated
capabilities.
