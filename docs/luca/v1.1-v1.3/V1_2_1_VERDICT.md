# Luca V1.2.1 release verdict

Status: **PASS**

Release: **Connect Your Work**

Exact product checkpoint:
`ec5ef6fbe6256dd1651280d818976b346045389d`

Evidence closure: the commit titled `Finalize V1.2.1 release evidence`.

No remote push or pull request was authorized.

## Product result

V1.2.1 turns Brain into a quiet local connection inventory for repositories,
Codex sessions, Claude Code sessions, and the existing imported-file path.
Discovery is metadata-only. Nothing connects or indexes until the owner acts
and accepts the plain-language local-index and model-egress consent.

Original repositories and history files remain authoritative. Luca stores
encrypted bindings, body-free locators, hashes, cursors, safe metadata, and a
lightweight search index. Selected excerpts are reread from the original,
hash-verified, bounded, and authorized before use. Disconnect revokes recall
and repository work immediately and removes the connected index without
modifying the original.

Current and future residents receive explicit default grants. Binding or
provider changes fail closed as `Review needed` until one reconfirm action.
Imported V1.2 Markdown/text snapshots remain compatible.

Managed Hermes and OpenClaw residents receive the same session-scoped
`luca-repositories` tools without any native configuration change:

- `repositories`, `repo_tree`, `repo_search`, `repo_read`;
- approval-gated `repo_apply_patch` and `repo_run`;
- `repo_status`, `repo_diff`, and separately approved `repo_commit`.

The broker accepts only a source ID and relative paths, denies traversal,
symlink escape, direct `.git` mutation, stale grants, and disconnected sources,
and exposes no push, remote mutation, pull-request, or credentialed Git tool.
Command execution uses an executable plus an argument array. Conversation
permission decisions bind resident, runtime, conversation, repository, and
operation fingerprint and never reach relay events, model context, indexes, or
logs.

## Implementation lineage

| Commit | Purpose |
|---|---|
| `546c5dd` | Freeze V1.2.1 Brain Connections contracts |
| `4441869` | Add connected Brain source adapters |
| `61ad808` | Add scoped repository work bridge |
| `ec5ef6f` | Simplify the Brain connection experience; exact product checkpoint |

The fifth commit contains evidence and handoff records only. No product source
changed after the formal gate.

## Installed artifact

- Application: Luca Agent Network Dev
- Bundle ID: `com.luca.agent-network.dev`
- Signature: Developer ID Application `Riley Ralmuto (WQUY4M5HYR)`
- Strict deep signature verification: pass
- Installed executable SHA-256:
  `601c182ba2678f671a1356256041801f692792c62b9e80a3c81a9720e0596254`
- Installation: atomic rebuild/replacement and successful relaunch

The exact signed product checkpoint was used for native acceptance. The
acceptance-only discovery override was then cleared, both additive synthetic
history fixtures were removed, and the exact app was relaunched against the
normal Luca profile. The relay and installed application remain running.

## Native acceptance

An isolated fixture profile discovered exactly one disposable repository, one
synthetic Codex history, and one synthetic Claude Code history. All three were
connected through the production consent flow. The repository exposed six
searchable sections; each session adapter exposed only user-visible user and
assistant text.

The filesystem watcher refreshed the repository and append-only histories after
changes. Relaunch preserved connections, explicit grants, indexes, and cursors.
Receipts were body-free and disappeared on relaunch as required by their
process-memory-only contract.

Real Hermes `default` and OpenClaw `main` residents both:

- retrieved repository-only material through normal Brain recall;
- searched and read the same repository through `luca-repositories`;
- remained healthy in ordinary DMs and their signed mixed room.

The repository-work matrix passed:

- one patch was approved and applied;
- one test command was approved and completed;
- a separate patch was rejected and produced no file;
- one local commit was separately approved and created;
- the repository remained clean afterward;
- no push or other remote mutation occurred.

Disconnect removed recall and repository tools on the next resident turns.
Reconnect restored both using newly domain-separated page lineages. A focused
regression now covers refresh, disconnect, and unchanged reconnect so a
tombstoned page or prior idempotency key cannot be revived or replayed.

The original fixture remained byte-identical and clean at commit
`72d0cab3c03bd06402a2def34bc12372dcb34af3`, tree
`5eea8ffe23aa5cd244311d886c523c904ab034c8`, with its tracked README at
SHA-256 `5af0a797d68ae7f0f3b123b8de9fb76e9153f5b0bbd11950f18d13c0e8398d8e`.
The isolated working copy finished clean at approved local commit
`ab16b5e2139d79ed07080b294ed76c33ba52b4ca`, tree
`06c9b0ed1fad1b29de2a962bde10d3a10ebb8a89`.

## Privacy and native no-write proof

The encrypted store, WAL, and shared-memory files contained no plaintext match
for the acceptance root, source name, repository/session bodies, or any fixture
canary. No plaintext absolute local path was found.

Protected native snapshots were byte-identical before and after acceptance:

| Protected native state | SHA-256 |
|---|---|
| Hermes configuration | `5b03798c7625609e78a67bd813e9104d7a69b2e80c6ef69c42b08276d262b0bd` |
| Hermes identity/workspace | `7d27c3b11b9b94534631e73fbc026c7757d3dc72940a0869917b255b6f4abb87` |
| Hermes memory | `9008276907c30f27c0f2c8fccba0cd78a3f4b0a0b35ce3d57ad5281c49499919` |
| Hermes user memory | `38fd4e88276196610e7fe3d1743ccfca6acd49e8a3930f11b97f531fbeca9b31` |
| Hermes schedule | `82b0bfd423858c90fb1f36ad4a8ae237dc44bbaf72f5dd94bfa9fcaa28fd69c6` |
| Hermes credential set | `d71d9f5c2af0c898c7c6d6a1d94ddb0aeeed00cf8a3c33a11433b7c6fd6ee926` |
| OpenClaw configuration | `f5633fc4e495e5ef6a87e35966ab6d9875bd92d0458371f0074525f386f8e2b5` |
| OpenClaw model catalog | `e61eec4152f13a2111203dcd27739833ad901d40d752874376876e2b395ecf6b` |
| OpenClaw memory/workspace tree | `2003e19074a9ae3244ae3cd05a6efa4ee2bd4167390aaddff5f237aad11cfea9` |
| OpenClaw schedule tree | `872e2a2c7e90d13d07efbc4103a57f6abf846ee2ce268dbd9028392b1af3a1ee` |
| OpenClaw credential set | `b38f624465893de78ce04cdba5f5b492f23a731519130cf3b614883d014995d8` |

No native configuration, credential, model, memory, workspace, or schedule was
changed.

## Verification

- Exact Rust formatting, strict workspace and Tauri Clippy, diff checks, and
  every desktop file-size guard: pass.
- Connected Brain protocol strictness, canonicalization, body/path redaction,
  compatibility, permission binding, and unknown-field vectors: pass.
- Metadata-only discovery, bounded traversal, repository filtering, session
  parser exclusions, watcher refresh, encryption, reconnect, stale/reconfirm,
  disconnect, new-resident, and changed-locator coverage: pass.
- Repository broker containment, capability isolation, descendant isolation,
  permission expiry, patch/command/commit approval, denial, and absence of push
  tools: pass.
- Full desktop Tauri suite: 1,782 passed, 13 ignored; three diagnostics passed.
- Desktop Biome/static checks, 3,420 unit tests, typecheck, and production build:
  pass.
- Focused Brain B26 and F03/F07 Playwright projects: 9/9 pass.
- Visual inspection of desktop, connected, and mobile Brain states: pass.
- Formal repository gate: the single `just ci` run passed on unchanged product
  checkpoint `ec5ef6fbe6256dd1651280d818976b346045389d`; mobile reported 525
  passed and one intentional skip.

## Scope boundary

V1.2.1 adds no database adapter, embedding, graph, Mnemos integration,
model-assisted ingestion, proactive behavior, native-session restoration, or
autonomous memory writing. Connected sources provide bounded recall and
approved repository work; they do not become resident identity or durable
resident memory. Resident Reflection remains the separately authorized V1.3
slice.
