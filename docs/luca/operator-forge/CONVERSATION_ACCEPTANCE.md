# Polyphonic conversation reliability acceptance

Date: 2026-08-10

## Exact product checkpoint

- Branch: `codex/luca-operator-native-forge`
- Product commit: `4df383309b750311d796be9bee72f3969231e001`
- Evidence commit: the commit titled `Finalize installed messaging acceptance evidence`
- Bundle identifier: `com.luca.agent-network.dev.codex-luca-operator-native-forge`
- Installed executable SHA-256:
  `d04ad90e504235a13542c4a4a8fbfea865ec617c196863152ce08d05391b2d2e`
- Signing identity: Developer ID Application, team `WQUY4M5HYR`
- Strict deep signature verification: pass
- Remote publication: not authorized

The exact signed application was exercised against the isolated local relay on
port 3030. The final application and relay were left running.

## Installed conversation matrix

| Scenario | Result |
|---|---|
| Direct Codex message | PASS — one signed `CODEX READY` final |
| Direct Claude Code message | PASS — working phases followed by one signed `CLAUDE READY` final |
| Direct Hermes message | PASS — the imported `default` resident entered a working phase and completed |
| Direct OpenClaw message | PASS — the imported `main` resident entered working/writing phases and completed |
| Five-resident group message | PASS — independent provisional rows and one linear final per resident |
| Directed reply to Claude Code | PASS — only Claude Code activated; the owner quote appeared once |
| Codex and Luca mentions | PASS — only the mentioned subset activated and replied |
| Explicit Codex thread | PASS — only Codex activated and its final remained off the room timeline |
| Stop one resident | PASS — Codex stopped while the other four residents continued |
| Stop the conversation | PASS — every remaining active resident stopped |
| Relaunch | PASS — transcript, signed finals, residents, and room presentation persisted |

OpenClaw completed the correct resident/runtime route but declined the requested
verbatim readiness phrase. That was model-authored content, not a dispatch or
publication failure.

The final relaunch showed all five residents as present. The room timeline
contained no explicit-thread final, no internal `!cancel` control row, no
runtime skill-budget notice, no persistent handoff banner, and no synthetic
reply summary for linear resident finals.

## Security and native boundary

- Delivery visibility and managed activation are separate. Directed dispatches
  retain room delivery while storing only their validated resident audience.
- Presentation frames are process-memory-only, sequence checked, epoch bound,
  body-free outside the renderer, and absent from relay events and durable
  outboxes.
- Model and tool descendants receive neither the presentation capability nor
  desktop execution authority.
- The installed messaging exercise invoked no Hermes or OpenClaw provisioning,
  configuration, credential, memory, workspace, model, or schedule mutation.
- The current Hermes configuration, identity, memory, user-memory, and schedule
  hashes and the current OpenClaw configuration and model-catalog hashes still
  match the previously accepted protected snapshots recorded in
  `V1_2_1_VERDICT.md`.

One packaging preflight initially launched a manually relabeled bundle with the
default compile-time application identifier. It read the default app namespace
while using the isolated acceptance keyring service and temporarily recorded
missing-key status text for the acceptance residents. The bundle was discarded,
the app was rebuilt with the identifier supplied at compile time, and the
default application cleared those status fields through its normal startup
reconciliation. No credential or native runtime configuration was edited.

## Automated verification

- conversation-reliability Playwright: 4/4 passed;
- desktop renderer unit suite: 3,457 passed;
- TypeScript typecheck and production desktop build: passed;
- strict `luca-protocol` and desktop Tauri Clippy: passed;
- protocol, connected-source, continuity, handoff, and relay-auth vectors:
  passed;
- formatting, file-size, pixel-text, public-key, Biome, and diff gates: passed;
- formal `just ci` on the unchanged product checkpoint: passed, including
  workspace Rust, desktop Tauri, web, mobile, and production-build gates.

No product source changed after the passing formal gate. This file and its
companion verdict are evidence-only closure.
