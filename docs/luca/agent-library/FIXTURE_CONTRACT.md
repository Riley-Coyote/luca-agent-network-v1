# Agent Library fixture and evidence contract

Status: required for implementation and visual review

## Why this exists

The current browser preview is activated by
`?e2e=mock&notebookDemo=1`. It mixes upstream relay fixtures, managed-resident
fixtures, and intentionally incomplete Tauri mocks. It is useful for component
development but is not evidence of native product behavior.

No future reviewer should have to guess what is real.

## Surface labels

When `e2e=mock` is active in a development build:

- show a quiet `DEMO DATA` or `MOCK DATA` marker in development-only chrome;
- never show that marker in production or installed native builds;
- do not present unsupported mocked-command errors as product-state errors;
- mock-only error states must be deliberately enabled by a named fixture.

## Canonical fixture set

Use a small Luca-specific fixture set instead of the broad upstream community:

| Fixture | Class | Runtime/source | Purpose |
|---|---|---|---|
| Luca | managed native | Hermes | running resident with Notebook |
| Mara | managed native | OpenClaw | idle resident with Notebook |
| Sol | managed Luca | Codex | offline/degraded resident state |
| Alice | external agent | external/relay | truthful limited profile |
| Riley | person/owner | none | owner identity |

Fixtures may use synthetic keys and content, but the class and availability
rules must match production behavior.

Do not seed Luca with `agent_command: goose` or rely on a generic fallback that
returns Goose metadata for unknown keys.

## Conversation fixtures

Keep only the conversations needed to prove the shell:

- one Luca DM;
- one Mara DM;
- one mixed Luca/Mara room;
- one room containing external Alice;
- one long-history room for pagination;
- one empty/new conversation state.

Legacy channels may remain for upstream regression suites, but the dedicated
Agent Library preview must not flood the rail with unrelated community data.

## Evidence levels

Every screenshot, receipt, and checklist item must identify its level:

1. **Mock browser** — deterministic layout and interaction proof only.
2. **Native development app** — real Tauri commands and local state.
3. **Installed signed app** — packaged product behavior.
4. **Real runtime** — Hermes/OpenClaw/Codex/Claude Code behavior with exact
   versions recorded.

Mock browser evidence cannot prove discovery, native binding, runtime status,
Notebook encryption, key custody, or installed-app behavior.

## Fixture acceptance

- A development marker is visible only under the explicit mock bridge.
- Luca, Mara, Sol, Alice, and Riley render their correct classes.
- Managed residents expose full workspace data; Alice exposes only external data.
- No fixture leaks Goose, Buzz Agent, Fizz, Honey, Bumble, community, workspace,
  or organization-first product language.
- No unsupported generic command error appears in the default design preview.
- Fixture identifiers and content are deterministic across reloads.
