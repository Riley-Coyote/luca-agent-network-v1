# Runtime Config Atlas

How each agent runtime stores an agent's configuration on disk, and what Polyphonic must do to
read and write it safely from the agent configuration page. Every runtime keeps the same two
halves — **documents** (markdown identity/instructions/memory in a directory) and **settings**
(model, provider, MCP, permissions in one structured config file) — but they disagree about what
an "agent" is: Hermes gives each agent a whole home directory, OpenClaw registers many agents in
one gateway config, and Codex and Claude Code have exactly one identity per home, so a second
agent means a second home (`CODEX_HOME`, `HOME`) or per-session injection through the ACP adapter.
Two sources ground this document: the vendor docs, cited inline and archived verbatim in
[RUNTIME_DOCS_NOTES.md](RUNTIME_DOCS_NOTES.md), and one real macOS install surveyed read-only on
2026-08-18 (8 Hermes profiles, 16 OpenClaw agents, 1 Codex home, 1 Claude Code home), referred to
below as **observed on a real install**. Where they disagree, the docs win and the observation is
noted.

| Runtime | Config root (env override) | Agent scope | Format(s) | Reload | Write hazards | Confidence |
|---|---|---|---|---|---|---|
| **Hermes** | `~/.hermes` (`HERMES_HOME`) | **Per-agent directory** — a profile *is* a home; default profile is the root itself | YAML (`config.yaml`) + Markdown + dotenv | Session start for docs/model; `compression.*` and `model.context_length` hot on next message; MCP auto-reloads on file change | YAML round-trip loses comments/order; **profiles may be symlinks — resolve before atomic rename**; `.lock` files beside memory docs; secrets belong in `.env`, not `config.yaml` | High |
| **OpenClaw** | `~/.openclaw` (`OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`, `OPENCLAW_PROFILE`) | **Many agents, one config file** — `agents.*` entries + per-agent workspace + `agentDir` | JSON5 (`openclaw.json`) + Markdown | **Hot by default** — gateway watches the file (`gateway.reload.mode: hybrid`) | JSON5 comments; **config must be a regular file, not a symlink** (atomic rename replaces the target); schema-gated — invalid writes rejected to `.rejected.*`; destructive clobbers refused; plaintext channel tokens live inline | High |
| **Codex CLI** | `~/.codex` (`CODEX_HOME`) | **One identity per home**; multi-agent = per-agent `CODEX_HOME` or `--profile` | TOML (`config.toml`) + Markdown | **No hot reload documented** — next invocation | TOML comments; project configs may not set provider/approval/sandbox/notify keys; prefer per-session `CODEX_CONFIG` over editing the file | High (paths) / Medium (reload — inferred) |
| **Claude Code** | `~/.claude` + `~/.claude.json` (**not** env-overridable) | **One identity per home**; subagents are prompts, not agents | JSON + Markdown | Settings **hot-reload** (permissions, hooks, `apiKeyHelper`); `model`/`outputStyle` read once | `~/.claude.json` is large and concurrently written — **take `~/.claude/.claude.json.lock`**; `/model` writes `~/.claude/settings.json` under you; files are watched, so write temp + atomic rename | High |
| **Polyphonic** | `<app_data_dir>/agents/managed-agents.json` | Per-resident record | JSON | App-controlled | Today: one `system_prompt` string, no document files (see §3) | High |

Sources: Hermes [`user-guide/configuration`, `profiles`](https://github.com/NousResearch/hermes-agent) · OpenClaw [gateway/configuration](https://docs.openclaw.ai/gateway/configuration), [agent-workspace](https://docs.openclaw.ai/concepts/agent-workspace) · Codex [config-reference](https://learn.chatgpt.com/docs/config-file/config-reference), [agents-md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) · Claude Code [settings](https://code.claude.com/docs/en/settings), [memory](https://code.claude.com/docs/en/memory).

---

## 1. Hermes (NousResearch)

### The four documents

| Document | Path | Notes |
|---|---|---|
| **Identity / soul** | `$HERMES_HOME/SOUL.md` | Slot #1 of the system prompt. Docs are explicit: it lives in the home, "never the working directory". Seeded on first run and **never overwritten**; scanned for prompt-injection patterns and truncated at load. |
| **Self-model** | **None — propose `$HERMES_HOME/IDENTITY.md`** | No vendor-defined self-model file. The only structured self-description is `profile.yaml` (`display_name`, `role`, `description`). Observed on a real install: 5 of 7 profiles already carry ad-hoc `IDENTITY.md` / `OPERATIONS.md`, so `IDENTITY.md` is a convention worth adopting — but it is *ours*, not Hermes'; Hermes will not read it unless we append it to SOUL.md or an `AGENTS.md`. |
| **Instructions** | Project-side only: `.hermes.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules` | **First match wins — only one loads per session.** Discovery walks up to the git root. There is no home-scoped instructions file; SOUL.md carries home-scoped guidance. |
| **Memory** | `$HERMES_HOME/memories/MEMORY.md`, `$HERMES_HOME/memories/USER.md` | Written by the agent's `memory` tool; injected as a frozen snapshot at session start. Observed: `§`-delimited fact blocks, caps in `config.yaml` (`memory.memory_char_limit`, `memory.user_char_limit`), and `.lock` files beside each. |

### Settings

Everything is **per-agent**, because everything lives in that profile's home. `config.yaml`:
`model.{default,provider,base_url,api_mode}`; per-role sub-models under `auxiliary.*`;
`mcp_servers.<name>` (stdio `command`/`args`/`env`, or HTTP `url`/`headers`, plus `enabled`,
`timeout`, `trust`, `tools.{include,exclude}`); permissions as `approvals.mode`,
`command_allowlist`, `security.tirith_*`; tools as `tools.enabled_tools` / `toolsets`;
working directory as `terminal.cwd` (separate from the profile). Credentials —
**location only** — `$HERMES_HOME/.env` (API keys, bot tokens) and `$HERMES_HOME/auth.json`
(OAuth). Machine scope is limited to the source checkout, `bin/`, `node/`, and the profiles root.

### Writing safely

1. Read-modify-write the YAML preserving unknown keys and key order (`_config_version: 27` on the
   observed install, ~530 lines — a naive dump would rewrite the user's whole file).
2. **Resolve symlinks before the atomic rename.** Hermes' own `utils.atomic_replace` deliberately
   resolves them so a `config.yaml`/`SOUL.md`/`auth.json` symlinked into a dotfiles repo survives a
   write. An external writer that renames over the link destroys it.
3. Route API keys through `hermes config set KEY VAL`, which files secrets into `.env`; never write a
   key into `config.yaml` (`native_provisioning/hermes.rs` already hard-fails on
   `key|token|secret|password|credential|auth` when copying model preferences — keep that guard).
4. Respect the `.lock` files next to `MEMORY.md` / `USER.md`; the agent writes them concurrently.
5. Prefer reading `<home>/config.yaml` directly over today's `hermes profile show` screen-scraping.

### Live vs restart

Hot on the next message: `model.context_length`, all `compression.*`, `progress_notices`. MCP
connections auto-reload when `config.yaml` changes (30s timeout — too short for interactive OAuth);
`/reload-mcp` forces it. `/model` hot-swaps the current chat; dashboard model changes apply to new
sessions only. SOUL.md, project instructions and memory snapshots are assembled at session start —
**restart the session**. API keys and tool/skill config need the normal reload path.
*Disagreement:* the docs describe MCP auto-reload on file change; no config watcher was found in the
checkout observed on the real install. Prefer the docs; promise "restart the session" in the UI.

### Gotchas (real install)

- **The default profile shares the root.** `~/.hermes/SOUL.md` *is* the default agent's soul, and the
  profiles root is anchored to the default home — a write meant for "the default agent" edits the
  same directory that holds every profile. Label this scope loudly in the UI.
- Stale absolute paths survive in `mcp_servers` (one pointed at a venv that no longer exists) —
  validate `command` before showing a server as healthy. `state.db` was 249 MB; never parse the home
  wholesale. `~/.hermes/migration/openclaw/` exists — some profiles are ex-OpenClaw agents.

**Confidence** high for documents/settings paths (both sources agree). **Open:** the admin
"managed scope" directory path (docs reference `user-guide/managed-scope`; page not fetched), and
whether the MCP watcher exists in the shipped version.

---

## 2. OpenClaw

### The four documents

All live in the agent's **workspace** (default `~/.openclaw/workspace`; per-agent override; a
non-default agent without one resolves to `<state-dir>/workspace-<agentId>`):

| Document | File | Notes |
|---|---|---|
| **Identity / soul** | `<workspace>/SOUL.md` | Persona, tone, boundaries. Loaded every session. |
| **Self-model** | `<workspace>/IDENTITY.md` | Name, vibe, emoji — written by the bootstrap ritual. The only runtime with a first-class self-model file. |
| **Instructions** | `<workspace>/AGENTS.md` | Operating instructions, loaded every session. Its `## Tools` section is guidance only and does **not** gate tools. |
| **Memory** | `<workspace>/MEMORY.md` + `<workspace>/memory/YYYY-MM-DD.md` | `MEMORY.md` is curated long-term memory, main private session only; the dated files are the daily log (57 on the observed install). |

Also `USER.md` (the owner model, its own **4,000-char budget**), `BOOT.md`, `BOOTSTRAP.md`,
`HEARTBEAT.md`, `TOOLS.md`, `skills/`, `canvas/`. Missing required files inject a "missing file"
marker and continue. Caps: `bootstrapMaxChars` (20000 default; 40000 observed),
`bootstrapTotalMaxChars` (60000 default; 80000 observed).

### Settings

One file, `~/.openclaw/openclaw.json`, holds **all agents**. Model/provider: `agents.defaults.model`
and the per-agent override, `provider/model` refs or aliases, `utilityModel`, `models.providers.<id>`
for custom base URLs, `modelPolicy.allow` as an allowlist, `params` merged
defaults → per-model → per-agent. Runtime is selected **per model**
(`models.providers.<p>.agentRuntime`); the whole-agent `agents.defaults.agentRuntime` key is legacy
and ignored. MCP: `mcp.servers.<name>` — **machine scope, not per-agent** (observed: three servers
shared by all 16 agents). Permissions/tools: `tools.profile`, sandboxing under
`agents.defaults.sandbox`, plus a separate `~/.openclaw/exec-approvals.json`. Credentials —
**location only** — per-agent `<agentDir>/auth-profiles.json` (default
`~/.openclaw/agents/<id>/agent/`), `~/.openclaw/credentials/`, and `auth.profiles` in the main
config which holds profile *names* only.

*Disagreement to resolve at runtime:* the docs show agents as a keyed map
(`agents: { entries: { alex: {…} } }`); the observed install uses an array
(`agents.list[]` with `id`). Do not hardcode either — read the live schema
(`openclaw config schema`, or the `gateway` tool's `config.schema.lookup` for one path). The
reference page says plainly that code truth beats the page.

### Writing safely

1. **Prefer the CLI**: `openclaw config set/unset`, `openclaw agents add/set-identity/delete`,
   `openclaw mcp set/unset`, `openclaw secrets store`. The existing `native_provisioning/openclaw.rs`
   already does this and gates on `openclaw config validate --json` — extend that pattern.
2. If writing the file directly: preserve JSON5 comments and trailing commas, honour `$include`
   (writes go back into the included file), and **never write through a symlink** — OpenClaw writes
   atomically via rename and forbids a symlinked config for exactly that reason.
3. Validate before writing. Invalid config is rejected and parked as `.rejected.*`; the gateway keeps
   the last good config; clobbers that drop `gateway.mode` or shrink the file by >50% are refused.
4. **The file contains plaintext channel bot tokens.** The raw-files editor must redact them and the
   app must never log or echo this file unredacted.

### Live vs restart

Hot by default: the gateway watches the config. `gateway.reload.mode: hybrid` hot-applies safe
changes and auto-restarts for critical ones; `off` disables watching. Channel changes restart only
that channel; `hooks`, `cron`, `agent.heartbeat` restart only their subsystem; `gateway.reload` and
`gateway.remote` apply with no restart. A downloaded model catalog applies on the **next gateway
restart**. Workspace documents load at session start. **Plugins may declare their own
restart-triggering prefixes**, so no static reload table is authoritative — that is the strongest
argument for `reloadSemantics()` querying the runtime rather than a hardcoded map.

### Gotchas (real install)

- `~/.clawdbot` is a symlink to `~/.openclaw` and one agent's `agentDir` still uses the legacy path —
  canonicalize before comparing, or one agent looks like two.
- The app's Agents screen showed a per-agent workspace override as the "default location" while
  `agents.defaults.workspace` was something else. Show resolved values *with* provenance.
- MCP is machine-scope: editing it from a per-agent page changes every agent. Say so in the UI.

**Confidence** high. **Open:** the `entries` vs `list[]` schema shape, and per-key reload behaviour
under the installed plugin set.

---

## 3. Codex CLI (via `codex-acp`)

### The four documents

| Document | Path | Notes |
|---|---|---|
| **Identity / soul** | **None — propose Polyphonic-owned `SOUL.md` in a per-agent `CODEX_HOME`** | Codex has no persona file. Nearest levers: the `personality` config key (observed set to `friendly`; not in the doc key list we have) and `model_instructions_file`, which **replaces** built-in instructions, with `developer_instructions` appending. |
| **Self-model** | **None — propose `IDENTITY.md`, folded into AGENTS.md** | No concept. |
| **Instructions** | `$CODEX_HOME/AGENTS.md` (and `AGENTS.override.md`), then project `AGENTS.md` walked git-root → cwd | Documented and exact: global first (override, then base), then one file per directory root-down, joined blank-line separated so deeper files win by position, capped by `project_doc_max_bytes` (32 KiB). |
| **Memory** | **None in the docs** | Observed: `~/.codex/memories/` with a 545 KB `MEMORY.md`, `raw_memories.md`, `rollout_summaries/`, and the directory is **a git repo**. This is a user/extension convention, not a Codex feature — treat it as an unmanaged path we may read but should not assume. |

Two local artefacts that the docs contradict: `~/.codex/instructions.md` exists on the install but
the docs say `instructions` is a **config key "reserved for future use"** and there is no
`instructions.md` file — so the local file is legacy and probably inert. Prefer `AGENTS.md`.

### Settings

`$CODEX_HOME/config.toml`, per-machine. Model: `model`, `model_provider`, `model_reasoning_effort`,
`model_verbosity`, `model_context_window`, `review_model`. Providers: `[model_providers.<id>]`
(`base_url`, `env_key`, `wire_api`, retries, command-backed `auth`). Permissions: `approval_policy`
(`untrusted`|`on-request`|`never`, or a granular table) × `sandbox_mode`
(`read-only`|`workspace-write`|`danger-full-access`), `sandbox_workspace_write.*`,
`default_permissions`, and `[projects."<abs path>"].trust_level`. MCP: `[mcp_servers.<id>]`, stdio or
HTTP, with `enabled_tools`/`disabled_tools` and `default_tools_approval_mode`. Credentials —
**location only** — `$CODEX_HOME/auth.json` **or** the OS keyring, selected by
`cli_auth_credentials_store` (`file`|`keyring`|`auto`).

Profiles are **separate files**: `--profile deep-review` layers
`$CODEX_HOME/deep-review.config.toml` over `config.toml`, and the docs say explicitly not to nest
keys under `[profiles.<name>]`. (The observed install defined no profiles; older `[profiles.*]`
blocks are the legacy form.)

### Writing safely

1. **Prefer not writing `config.toml` at all for a Polyphonic-spawned resident.** `codex-acp` accepts
   `CODEX_CONFIG` — a JSON object merged into the Codex session config — plus `MODEL_PROVIDER`,
   `INITIAL_AGENT_MODE` (`read-only`|`agent`|`agent-full-access`), `CODEX_PATH`, `CODEX_API_KEY` /
   `OPENAI_API_KEY`. That gives per-agent model, sandbox and approval without touching a shared file,
   and the adapter also accepts client-provided MCP servers per session.
2. For a **native** Codex agent the owner wants configured globally, edit `config.toml` with a
   comment-preserving TOML editor (`toml_edit`) — read-modify-write, unknown keys untouched.
3. Honour the **project blocklist**: a project `.codex/config.toml` may not set `model_provider`,
   `model_providers`, `openai_base_url`, `chatgpt_base_url`, `notify`, `profile`, `profiles`, `otel`,
   `sandbox_mode`, or `approval_policy`. Those must be written **user-level**.
4. Handle the documented renames on read: `experimental_instructions_file` → `model_instructions_file`,
   `features.codex_hooks` → `features.hooks`, `agents.max_threads` →
   `agents.max_concurrent_threads_per_session`.

### Live vs restart

**Next invocation.** No hot reload is documented anywhere; the only in-flight lever is
`codex -c key=value` per run. Treat every write as taking effect on the next session, and say so.
*(Inferred — the docs are silent, they do not deny it.)*

### Gotchas (real install)

`logs_2.sqlite` was 802 MB and the state writer leaks `..codex-global-state.json.tmp-*` files —
`listFiles` must be allowlist-driven, never a recursive walk. Multi-identity by `CODEX_HOME` is
already proven in the wild: OpenClaw gives every agent its own `~/.openclaw/agents/<id>/agent/codex-home/`.

**Confidence** high on paths, medium on reload (inferred). **Open:** whether the observed
`personality` key is documented in a newer reference than the one archived here; `codex-acp`
documents no cwd env var — cwd rides the ACP `session/new` parameter.

---

## 4. Claude Code (via `claude-agent-acp`)

### The four documents

| Document | Path | Notes |
|---|---|---|
| **Identity / soul** | **None — propose a `@`-imported `SOUL.md` from `~/.claude/CLAUDE.md`** | No persona concept. CLAUDE.md imports (`@path`, max four hops) are the documented composition mechanism. |
| **Self-model** | **None — propose `IDENTITY.md`, imported the same way** | No concept. |
| **Instructions** | `~/.claude/CLAUDE.md` (user), `./CLAUDE.md` or `./.claude/CLAUDE.md` (project), `./CLAUDE.local.md`, plus `.claude/rules/*.md` | Resolution walks **up** from cwd, concatenated root-down so files nearer cwd land last. Claude Code reads `CLAUDE.md`, **not** `AGENTS.md` — the documented bridge is an `@AGENTS.md` import or a symlink. |
| **Memory** | `~/.claude/projects/<project>/memory/MEMORY.md` + topic files | **Per-project, not per-agent**, and machine-local; `<project>` derives from the git repo so worktrees share a directory. `MEMORY.md`'s first 200 lines / 25 KB load each session, topics on demand. Relocatable via `autoMemoryDirectory` — that is the lever for making memory per-resident. |

### Settings

`settings.json` at user (`~/.claude/settings.json`), project, local and managed scopes, precedence
**Managed → CLI args → Local → Project → User**, with permission rules **merging** across scopes
rather than overriding. Model: `model`, `fallbackModel`, `availableModels`. Permissions:
`permissions.{allow,deny,ask,additionalDirectories,defaultMode}` — note `defaultMode: auto` takes
effect **only** from `~/.claude/settings.json`, not project or local. MCP: user and local servers in
`~/.claude.json` (local keyed by project path), project servers in `.mcp.json`, collision precedence
local > project > user with the **whole entry** from the winner (no field merging). Credentials —
**location only** — macOS **Keychain** preferred, else `~/.claude/.credentials.json`; custom auth via
`apiKeyHelper`.

### Writing safely

1. **Take `~/.claude/.claude.json.lock`** before touching `~/.claude.json` (216 KB on the observed
   install, written concurrently by every running Claude session).
2. Read-modify-write `settings.json` every time: as of v2.1.153 the in-session `/model` command
   **writes the `model` field into user settings**, so the app and the user race for the same key.
3. Claude Code **watches** its settings files, so write to a temp file and rename atomically — a
   partially written file can be picked up mid-write.
4. Never write credentials; set them through `apiKeyHelper` or leave them to `claude login`.

### Live vs restart

Documented explicitly: settings hot-reload for most keys — `permissions`, `hooks`, `apiKeyHelper` —
across user, project, local and managed scopes, with a `ConfigChange` hook firing per change. Read
once at session start: **`model`** (use `/model`) and **`outputStyle`**. CLAUDE.md is session-start
context; the project-root file is re-injected after `/compact`, nested and path-scoped rules are not.
MCP reload is **not documented** for `.mcp.json` / `~/.claude.json` — assume a new session.

### Gotchas (real install)

`~/.claude/agents/` did not exist, so every subagent came from plugins — an "agents" list read from
that directory will look empty and be correct. `~/.claude/session-env/` held 3,821 entries. One
`mcpServers` entry pointed at a `codex` binary that is not on this machine; validate commands before
reporting a server as configured.

**Confidence** high. **Open:** `~/.claude` is a fixed path with no documented env override, so
per-resident isolation means either a per-agent `HOME` or riding the ACP path — the adapter
`@agentclientprotocol/claude-agent-acp` documents only `CLAUDE_MODEL_CONFIG`, and an ACP caller's
`_meta.claudeCode.options.settings` on `sessions/create` **wins outright** and makes that env var
ignored entirely. That `_meta` channel is the real per-resident lever; approval mode, cwd and
settings-source selection are undocumented in the README and need a protocol-level spike.

---

## 5. Polyphonic-managed residents

Today a managed resident is a `ManagedAgentRecord` in `<app_data_dir>/agents/managed-agents.json`
with `system_prompt: Option<String>` plus settings (`model`, `provider`, `env_vars`,
`agent_command_override`, `start_on_app_launch`, timeouts, `persona_id`, `persona_source_version`).
One string cannot express four documents, cannot be diffed per-document, and does not match what the
same editor shows for a native agent.

**Proposal: give every managed resident an agent folder**, at
`<app_data_dir>/residents/<pubkey>/`, deliberately mirroring the OpenClaw workspace filenames because
they are the most complete of the four runtimes and already half-shared with Hermes:

```
residents/<pubkey>/
  SOUL.md          identity — what this resident is        (Hermes SOUL.md, OpenClaw SOUL.md)
  IDENTITY.md      self-model — name, register, boundaries (OpenClaw IDENTITY.md)
  AGENTS.md        instructions — how it operates          (OpenClaw AGENTS.md, Codex AGENTS.md)
  MEMORY.md        curated long-term memory                (Hermes memories/, OpenClaw MEMORY.md)
  memory/YYYY-MM-DD.md   daily log, agent-written
  USER.md          owner model — shared, symlink or copy from one owner-level file
```

The harness assembles the system prompt in a fixed slot order — SOUL → IDENTITY → USER → AGENTS →
MEMORY snapshot — with caps mirroring OpenClaw (per-file ~20k, total ~60k, USER.md 4k) and a
"missing file" marker rather than a hard failure when one is absent. That single decision buys
three things: the configuration page renders the same four editors for a managed resident and a
native one; provisioning a native agent *from* a managed one becomes a file copy rather than a
prompt-string transformation (`native_provisioning` already writes `SOUL.md` for both Hermes and
OpenClaw); and documents become diffable, backup-able and Brain-ingestible.

**What stays on the record** — everything in SETTINGS, unchanged: identity keys (`pubkey`,
`private_key_nsec` in the keyring, `auth_tag`), `name`, `avatar_url`, `relay_url`, harness wiring
(`acp_command`, `agent_command_override`, `agent_args`, `backend`), `model`, `provider`, `env_vars`,
`start_on_app_launch`, `auto_restart_on_config_change`, timeouts, `parallelism`, `persona_id`.
Add two fields: `documents_dir` (relative pointer, so the folder can move) and `documents_hash`
(content hash of the assembled documents, replacing the prompt-string basis of
`persona_source_version` for staleness detection).

**Migration.** One-way, lazy, reversible in one step:

1. On first load after upgrade, for each record with `system_prompt: Some(..)` and no
   `documents_dir`: create the folder, write the prompt **verbatim** to `SOUL.md`, leave the other
   files absent, set `documents_dir` and a `documents_version: 1` marker.
2. Stop writing `system_prompt`; keep the field for serde compatibility and treat it exactly as
   `agent_command` and `mcp_command` are treated today — a create-time snapshot that is never read at
   spawn. The harness reads the folder.
3. Persona-linked residents: the persona supplies the initial `SOUL.md` body; `persona_source_version`
   compares against `documents_hash` instead of the prompt string.
4. Rollback, if ever needed, is re-reading `SOUL.md` into `system_prompt` — no data is lost because
   step 1 is a verbatim copy.

---

## 6. Adapter plan

One typed adapter per runtime behind a single interface, so the configuration page is written once:

```ts
interface RuntimeAgentAdapter {
  readDocuments(agent): Record<DocKind, DocRef | null>   // DocKind = soul|self|instructions|memory
  writeDocument(agent, kind, content): WriteReceipt
  readSettings(agent): SettingsView                      // typed value + scope + provenance + editable
  writeSetting(agent, key, value): WriteReceipt
  listFiles(agent): FileEntry[]                          // allowlisted roots only, size-capped
  readFile(agent, relPath): string
  writeFile(agent, relPath, content): WriteReceipt
  reloadSemantics(key): 'live' | 'next-session' | 'restart-runtime' | 'unknown'
  credentialSlots(agent): CredentialSlot[]               // provider, where it is stored, set|unset — never a value
}
```

`SettingsView` must carry **scope** (`per-agent` | `per-machine` | `per-project`) as data, not as a
UI afterthought: OpenClaw MCP and Codex/Claude model are machine-wide, and a per-agent page that
hides that will get people editing sixteen agents at once. `reloadSemantics` should query the runtime
where it can (`openclaw config schema`) rather than trusting a static table.

| Order | Adapter | Effort | Why |
|---|---|---|---|
| 1 | **Codex** | **S → M** | Reading already exists (`config_bridge/codex.rs`). For Polyphonic-spawned residents everything routes through `CODEX_CONFIG` / `MODEL_PROVIDER` / `INITIAL_AGENT_MODE` env on `codex-acp` — no file writing at all, which is the S. Writing the owner's `~/.codex/config.toml` with a comment-preserving TOML round-trip plus the project blocklist is the M. |
| 2 | **Hermes** | **M** | Documents are plain files in a known home; settings are one YAML. The work is a comment-and-order-preserving YAML round-trip, symlink-resolving atomic replace, `.lock` awareness, and replacing today's `hermes profile show` text scraping with a real `config.yaml` reader. Provisioning already writes `SOUL.md`, so half the write path exists. |
| 3 | **OpenClaw** | **M → L** | M if we drive `openclaw config` / `openclaw agents` / `openclaw mcp` and gate on `openclaw config validate --json` — the pattern `native_provisioning/openclaw.rs` already uses. L if we ever write the JSON5 ourselves: comments, `$include`, symlink ban, schema validation, the live watcher, and the `entries` vs `list[]` shape question. Also needs the redaction pass before any raw-file view. |
| 4 | **Claude Code** | **L** | No agent scope at all: per-resident configuration means a per-agent `HOME` or the ACP `_meta.claudeCode.options.settings` channel, and that channel is undocumented in the adapter README. Plus the `~/.claude.json` lock, the `/model` write race, watched files, and four documents that do not exist as files (CLAUDE.md imports would have to synthesize them). |

**Risks**

- **Clobbering the user.** Claude Code and OpenClaw both watch *and* write their own config, and
  Claude's `/model` writes the exact key our model picker writes. Read-modify-write every time; never
  cache a parsed config across writes.
- **Format destruction.** TOML and JSON5 carry comments, YAML carries order. A naive parse-and-dump
  silently deletes a user's annotations — the fastest way to lose trust here.
- **Scope confusion.** A per-agent page silently editing machine-scope values (OpenClaw MCP; Codex and
  Claude model).
- **Secrets met while reading.** `openclaw.json` holds plaintext channel bot tokens; a Hermes config
  held a dashboard password hash. The raw-files editor needs redaction, a refusal list, and no
  verbatim logging.
- **Symlinks, opposite rules.** Hermes profiles symlinked into dotfiles must be *preserved*;
  OpenClaw's config symlink must be *refused*. Same mechanism, inverted requirement.
- **Size landmines and schema drift.** 802 MB Codex logs, 249 MB Hermes state DB → `listFiles` is
  allowlist-and-cap driven, never a walk. And OpenClaw says outright that code truth beats its page.

---

## 7. What changes for the existing docs

Several docs in `docs/luca` currently say native runtime configuration is read-only and stays that
way. That is no longer the product decision. The owner has decided **native runtime agents are fully
editable from inside the app**; the only inviolable rule that survives is **never copy credentials
into the app** — Polyphonic may *set* a credential into a runtime's own store (Hermes `.env` via
`hermes config set`, OpenClaw `openclaw secrets store`, Codex keyring or `auth.json` via its own
login, Claude Code Keychain or `apiKeyHelper`) but never displays, caches, holds, or transports the
value; the UI shows only set / not-set and where it lives.

Docs that state or imply the old rule and will need revision (not edited here):

- `CLAUDE.md:13` — "Native Hermes/OpenClaw configuration is read-only".
- `docs/luca/functional-beta/NATIVE_PARITY_CONTRACT.md:22-24` — "adds no native configuration writer";
  `functional-beta/DECISION_LEDGER.md` D02 — "native-owned and read-only to Luca".
- `docs/luca/settings-agent-system/SETTINGS_AGENT_CONFIGURATION_SPEC.md` lines 58, 375, 689, 710, 789
  (native imports and native-discovered MCP shown read-only); `settings-agent-system/HANDOFF.md:22`.
- `docs/luca/continuity-g2/00_START_HERE.md:46` and `TASK_GRAPH.yaml:51`;
  `program-control/PROGRAM_CHARTER.md:59`, `INTERFACE_FREEZES.md:30`, `RISK_REGISTER.md` R-06;
  `program-status/MASTER_STATUS.md:52`; `unified-brain/RECONCILIATION.md:25`;
  `agent-library/00_START_HERE.md:43`.

Two consequences worth deciding before those edits land. **Discovery stays read-only** — nothing is
written until the owner edits something, so the "import is a binding, not a migration" principle
survives intact. And the **protected-state hash checks change meaning**: from "these files must not
change" to "these files may only change through a recorded in-app write", which means the evidence
model needs a write journal rather than a no-write proof.
