# Agent runtime on-disk configuration — official sources

Researched 2026-08-18. All facts from vendor docs or vendor GitHub repos; blogs used only to locate official pages. Confidence: **documented** (stated officially) or **inferred**.

**Doc hosts moved.** `github.com/openai/codex/docs/*.md` are now one-line pointer stubs; `developers.openai.com/codex/*` 308-redirects to `learn.chatgpt.com/docs/*`. `docs.anthropic.com/en/docs/claude-code/*` 301-redirects to `code.claude.com/docs/en/*`. Both new hosts serve raw `.md` (append `.md` to any page URL) — usable for automated ingestion.

---

## 1. OpenAI Codex CLI

Sources: [config-reference](https://learn.chatgpt.com/docs/config-file/config-reference) (JSON Schema: https://developers.openai.com/codex/config-schema.json) · [config-basic](https://learn.chatgpt.com/docs/config-file/config-basic) · [config-advanced](https://learn.chatgpt.com/docs/config-file/config-advanced) · [agents-md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) · [auth](https://learn.chatgpt.com/docs/auth) · [openai/codex docs/config.md](https://github.com/openai/codex/blob/main/docs/config.md)

**Format TOML. Base dir `$CODEX_HOME`, default `~/.codex`.**

Precedence per config-basic, highest first: CLI flags / `-c`,`--config` → project `.codex/config.toml` (closest to cwd wins, **trusted projects only**) → profile file (`--profile`) → user `~/.codex/config.toml` → system `/etc/codex/config.toml` (Unix) → defaults. config-reference gives a partly different managed ladder: cloud requirements → admin `requirements.toml` → project → user → defaults. **Flagged ambiguous** — the two pages overlap; safe reading is that user config is the writable layer and project/managed layers can override it.

Keys a project `.codex/config.toml` may **not** set: `openai_base_url`, `chatgpt_base_url`, `model_provider`, `model_providers`, `notify`, `profile`, `profiles`, `experimental_realtime_ws_base_url`, `otel`, `sandbox_mode`, `approval_policy`. A management UI writing provider or approval settings must write **user-level** config.

**Profiles are separate files**, not inline tables. `--profile deep-review` loads `~/.codex/config.toml` then overlays `~/.codex/deep-review.config.toml`. Docs say explicitly: "Use top-level config keys in the profile file; don't nest them under `[profiles.profile-name]`." Names: letters, numbers, hyphens, underscores. One active per session.

### Top-level keys for an agent-management UI

| Key | Type / values |
|---|---|
| `model` | string (e.g. `gpt-5.5`); `review_model` overrides for `/review` |
| `model_provider` | id from `model_providers`; default `openai` |
| `model_reasoning_effort` | `minimal`\|`low`\|`medium`\|`high`\|`xhigh` (`plan_mode_reasoning_effort` adds `none`) |
| `model_reasoning_summary` / `model_verbosity` | `auto`\|`concise`\|`detailed`\|`none` / `low`\|`medium`\|`high` |
| `model_context_window`, `model_catalog_json` (path), `oss_provider` (`lmstudio`\|`ollama`) | |
| `approval_policy` | `untrusted`\|`on-request`\|`never`, or granular table (`sandbox_approval`, `rules`, `mcp_elicitations`, `request_permissions`, `skill_approval`). `on-failure` deprecated |
| `approvals_reviewer` | `user`\|`auto_review` (default `user`) |
| `sandbox_mode` | `read-only`\|`workspace-write`\|`danger-full-access` |
| `sandbox_workspace_write.*` | `writable_roots`, `network_access`, `exclude_tmpdir_env_var`, `exclude_slash_tmp` |
| `default_permissions` | `:read-only`, `:workspace`, `:danger-full-access`, or a `[permissions.<name>]` table |
| `notify` | array\<string\> — command invoked for notifications, receives JSON payload |
| `history.persistence` / `history.max_bytes` | `save-all`\|`none` → `history.jsonl` |
| `instructions` | string — **"Reserved for future use"**; prefer `model_instructions_file` or `AGENTS.md` |
| `model_instructions_file` | path — replaces built-in instructions (not AGENTS.md); `developer_instructions` appends |
| `project_doc_max_bytes` | cap on combined AGENTS.md bytes, default 32 KiB; `project_doc_fallback_filenames`, `project_root_markers` |
| `web_search` | `disabled`\|`cached`(default)\|`indexed`\|`live`; `tools.web_search`, `tools.view_image` |
| `cli_auth_credentials_store` | `file`\|`keyring`\|`auto` |
| `mcp_oauth_credentials_store` / `mcp_oauth_callback_port` / `mcp_oauth_callback_url` | |

Deprecated renames to handle on read: `experimental_instructions_file` → `model_instructions_file`; `features.codex_hooks` → `features.hooks`; `agents.max_threads` → `agents.max_concurrent_threads_per_session`.

**`[mcp_servers.<id>]` schema.** stdio: `command`, `args`, `env` (map), `env_vars` (array of string|object with `source = "local"|"remote"`), `cwd`. HTTP: `url`, `auth` (`oauth`|`chatgpt`), `bearer_token_env_var`, `http_headers`, `env_http_headers`, `scopes`, `oauth_resource`. Both: `enabled`, `required`, `startup_timeout_sec` (10s default) / `startup_timeout_ms`, `tool_timeout_sec` (60s), `enabled_tools`, `disabled_tools`, `default_tools_approval_mode` (`auto`|`prompt`|`writes`|`approve`), `tools.<tool>.approval_mode`, `experimental_environment` (`local`|`remote`).

**`[model_providers.<id>]`**: `name`, `base_url`, `env_key`, `wire_api` (only `responses`), `http_headers`, `env_http_headers`, `request_max_retries` (4), `stream_max_retries` (5), `stream_idle_timeout_ms` (300000), command-backed `auth` table (`command`, `args`, `timeout_ms` 5000, `refresh_interval_ms` 300000, `cwd`). Ids `openai`, `ollama`, `lmstudio` reserved.

### AGENTS.md discovery (documented, exact)

1. **Global first:** `~/.codex/AGENTS.override.md`, then `~/.codex/AGENTS.md`.
2. **Project second:** walk from the git root **down** to cwd; per directory check `AGENTS.override.md`, then `AGENTS.md`, then `project_doc_fallback_filenames`. At most one file per directory.
3. Concatenated root-down joined by blank lines, so deeper files land later and win by position.
4. `project_doc_max_bytes` (32 KiB default) caps the total; Codex stops adding files once reached.

A global `~/.codex/AGENTS.md` is documented and real. There is no `instructions.md` file — `instructions` is a reserved config key.

**Credentials.** "Codex caches login details locally in a plaintext file at `~/.codex/auth.json` or in your OS-specific credential store." Stored under `CODEX_HOME`; behavior set by `cli_auth_credentials_store` (`file`|`keyring`|`auto`). Env: `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN` (enterprise automation), `CODEX_CA_CERTIFICATE`. ChatGPT-login tokens auto-refresh in-session.

**Reload: no hot-reload is documented anywhere.** Config is startup layering with a per-invocation escape hatch (`codex --config model='"gpt-5.6-terra"'`). Treat every change as applying to the next invocation — *inferred*, docs are silent.

### ACP adapter — `@agentclientprotocol/codex-acp`

Repo: https://github.com/agentclientprotocol/codex-acp. Env vars: `CODEX_API_KEY` (beats `OPENAI_API_KEY`), `OPENAI_API_KEY`, `CODEX_PATH` (alternate Codex executable), **`CODEX_CONFIG` (JSON object merged into the Codex session config — the hook for model/approval/sandbox)**, `MODEL_PROVIDER`, `INITIAL_AGENT_MODE` (`read-only`|`agent`|`agent-full-access`), `DEFAULT_AUTH_REQUEST`, `NO_BROWSER=1`, `APP_SERVER_LOGS`, `CODEX_LOG_FILE`. **No documented env var for model or cwd directly** — model goes through `CODEX_CONFIG`, cwd through the ACP `session/new` parameter. **Flagged: README documents no cwd/session handling.**

### Table — Codex CLI

| Setting | File | Format | Scope | Reload | Confidence |
|---|---|---|---|---|---|
| model, reasoning effort, verbosity | `~/.codex/config.toml` | TOML | per-machine | next invocation | documented path / inferred reload |
| model_provider(s) | `~/.codex/config.toml` | TOML | per-machine only (blocked in project) | next invocation | documented |
| approval_policy, sandbox_mode | `~/.codex/config.toml` or `requirements.toml` | TOML | user or admin; blocked in project | next invocation | documented |
| profile layer | `$CODEX_HOME/<name>.config.toml` | TOML | per-machine, per-profile | selected per invocation | documented |
| mcp_servers | `~/.codex/config.toml` or `.codex/config.toml` | TOML | user or project | next invocation | documented |
| notify, history | `~/.codex/config.toml` | TOML | per-machine (`notify` blocked in project) | next invocation | documented |
| global instructions | `~/.codex/AGENTS.md`, `AGENTS.override.md` | Markdown | per-machine | session start | documented |
| project instructions | `<gitroot..cwd>/AGENTS.md` | Markdown | per-project, per-directory | session start | documented |
| project config | `<project>/.codex/config.toml` | TOML | per-project, trusted only | next invocation | documented |
| credentials | `~/.codex/auth.json` **or** OS keyring | JSON | per-machine | refreshed in-session | documented |
| admin policy | `requirements.toml` | TOML | per-machine, admin | next invocation | documented |

---

## 2. Claude Code

Sources: [settings](https://code.claude.com/docs/en/settings) · [memory](https://code.claude.com/docs/en/memory) · [mcp](https://code.claude.com/docs/en/mcp) · [model-config](https://code.claude.com/docs/en/model-config) · [agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)

### settings.json locations

| Scope | Path |
|---|---|
| User | `~/.claude/settings.json` (Windows `%USERPROFILE%\.claude\settings.json`) |
| Project | `<repo>/.claude/settings.json` (git-tracked) |
| Local | `<repo>/.claude/settings.local.json` (gitignored) |
| Managed (file) | macOS `/Library/Application Support/ClaudeCode/managed-settings.json`; Linux/WSL `/etc/claude-code/managed-settings.json`; Windows `C:\Program Files\ClaudeCode\managed-settings.json` — each with a `managed-settings.d/*.json` drop-in dir merged alphabetically over the base |
| Managed (MDM) | macOS plist domain `com.anthropic.claudecode`; Windows `HKLM\SOFTWARE\Policies\ClaudeCode`, `HKCU\...` at lowest policy priority |
| Managed (server) | delivered at sign-in from the admin console or a self-hosted Claude apps gateway |

**Precedence, highest first: Managed → CLI args → Local → Project → User.** Permission rules **merge across scopes** instead of overriding. Legacy Windows `C:\ProgramData\ClaudeCode\` unsupported as of v2.1.75.

`~/.claude.json` holds the OAuth session, user- and local-scope MCP servers, per-project state (allowed tools, trust) and caches. Claude Code keeps five timestamped config backups.

**Keys.** Model: `model`, `fallbackModel`, `advisorModel`, `availableModels`, `enforceAvailableModels`, `alwaysThinkingEnabled`, `agent`. Auth/env: `env` (object), `apiKeyHelper` (shell command producing an auth value, sent as `X-Api-Key` and `Authorization: Bearer`; TTL via `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`), `awsCredentialExport`, `awsAuthRefresh`, `forceLoginMethod`, `forceLoginOrgUUID`. Permissions: `permissions.allow`/`.deny`/`.ask`/`.additionalDirectories`/`.defaultMode`. **Valid `defaultMode` values are `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`, and `manual` (alias for `default`)** — and `auto` does **not** take effect from project or local settings, only `~/.claude/settings.json`. Managed-only: `allowManagedPermissionRulesOnly`, `allowedMcpServers`, `deniedMcpServers`, `allowManagedMcpServersOnly`, `permissions.disableAutoMode`, `claudeMd`. MCP: `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers`, `disableClaudeAiConnectors`. Hooks: `hooks`, `allowManagedHooksOnly`, `allowedHttpHookUrls`, `disableAllHooks`. Memory: `claudeMdExcludes` (globs; arrays merge across layers), `autoMemoryEnabled`, `autoMemoryDirectory`, `autoCompactEnabled`, `autoCompactWindow`. Misc: `outputStyle`, `cleanupPeriodDays` (default 30), `statusLine`, `attribution`, `autoUpdatesChannel`, `requiredMinimumVersion`.

### CLAUDE.md memory

Load order, broadest → most specific (project text lands after user text):

| Scope | Location |
|---|---|
| Managed policy | macOS `/Library/Application Support/ClaudeCode/CLAUDE.md`; Linux/WSL `/etc/claude-code/CLAUDE.md`; Windows `C:\Program Files\ClaudeCode\CLAUDE.md` |
| User | `~/.claude/CLAUDE.md` |
| Project | `./CLAUDE.md` **or** `./.claude/CLAUDE.md` |
| Local | `./CLAUDE.local.md` |

Resolution: walks **up** from cwd loading `CLAUDE.md` + `CLAUDE.local.md` at each level, concatenated filesystem-root-down so files nearer cwd are read last; within a directory `CLAUDE.local.md` is appended after `CLAUDE.md`. Files in **subdirectories below cwd** are discovered but load lazily, when Claude reads a file there.

Imports: `@path/to/file`, relative paths resolve against the importing file, **max depth four hops**; imports inside code spans/fences are skipped. A project-file import resolving outside the working directory triggers a one-time approval dialog; user-scope imports load without it. Managed-policy CLAUDE.md cannot be excluded by `claudeMdExcludes`.

Rules: `.claude/rules/*.md` (recursive) and `~/.claude/rules/*.md`. Rules with no `paths:` frontmatter load at launch at the same priority as `.claude/CLAUDE.md`; user rules load before project rules. Path-scoped rules load when Claude reads a matching file.

**Claude Code reads `CLAUDE.md`, not `AGENTS.md`.** Documented bridge: a `@AGENTS.md` import inside CLAUDE.md, or a symlink.

Auto memory: `~/.claude/projects/<project>/memory/` with `MEMORY.md` index (first 200 lines or 25 KB loaded per session) plus topic files loaded on demand. `<project>` derives from the git repo, so worktrees share one directory. Machine-local. Relocatable via `autoMemoryDirectory` (absolute or `~/`-prefixed).

### MCP

| Scope | Stored in | Shared |
|---|---|---|
| Local (default) | `~/.claude.json`, under that project's path entry | no |
| Project | `.mcp.json` at repo root | yes, via git |
| User | `~/.claude.json` (top level) | no |

`claude mcp add --scope local|project|user`. Collision precedence **local > project > user**, and the *whole* entry from the winner is used — fields are not merged across scopes. `.mcp.json` shape: `{"mcpServers": {"<name>": {"type": "http", "url": "..."}}}`; `type` accepts `streamable-http` as an alias for `http`. Project servers need interactive approval (`claude mcp reset-project-choices` resets); approvals only count from non-checked-in settings files until the workspace is trusted. Per-server `timeout` (ms) overrides `MCP_TOOL_TIMEOUT`. Env expansion works in `.mcp.json`; `${CLAUDE_PROJECT_DIR}` needs a default like `${CLAUDE_PROJECT_DIR:-.}` outside plugin configs. Per-project on/off toggles land in `~/.claude.json` as `disabledMcpServers`/`enabledMcpServers` (distinct from the `*Mcpjson*` approval keys).

### Model selection

Documented priority: `/model <alias|name>` in-session → `claude --model` → `ANTHROPIC_MODEL` env → `model` in settings. **As of v2.1.153 `/model` writes the `model` field into user settings** as the new default (`s` in the picker = session only; `-p` non-interactive is always session-only). Project and managed settings still win on next launch. `--model` and `ANTHROPIC_MODEL` apply only to the session they launch. Alias env vars: `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL`. Subagents: `CLAUDE_CODE_SUBAGENT_MODEL`.

**Caution for an external UI:** `/model` writes `~/.claude/settings.json`, so an app writing that file can be clobbered by an in-session model switch and vice versa. Always read-modify-write.

**Credentials.** macOS: **Keychain** (preferred). Linux/Windows: `~/.claude/.credentials.json`. Sensitive plugin `userConfig` values go to Keychain, or `~/.claude/.credentials.json` where no keychain exists. Custom auth via `apiKeyHelper`.

**Reload (documented explicitly):** "Claude Code watches your settings files and reloads them when they change, so edits to most keys apply to the running session without a restart. This includes `permissions`, `hooks`, and credential helpers like `apiKeyHelper`. The reload covers user, project, local, and managed settings, and the `ConfigChange` hook fires for each detected change." Read once at session start: **`model`** (use `/model`) and **`outputStyle`** (rebuilt on `/clear` or restart). CLAUDE.md is session-start context; project-root CLAUDE.md is re-injected after `/compact`, nested and path-scoped rules are not. Verify with `/status` (Setting sources), `/context` (Memory files), `claude doctor`.

**ACP adapter.** The Zed repo now serves the README for **`@agentclientprotocol/claude-agent-acp`** (repo `agentclientprotocol/claude-agent-acp`), built on the Claude Agent SDK. Only one env var is documented: `CLAUDE_MODEL_CONFIG`, a JSON string with `modelOverrides` (`Record<anthropicModelId, providerModelId>`) and `availableModels` (aliases, prefixes, or full IDs), both mapping to the SDK `Settings` type. Precedence: an ACP caller's `_meta.claudeCode.options.settings` on `sessions/create` wins outright and makes `CLAUDE_MODEL_CONFIG` ignored entirely. Bedrock example adds `CLAUDE_CODE_USE_BEDROCK=1` + `AWS_REGION`. **Flagged: approval mode, cwd, and settings-source selection are not documented in the README** — they ride the ACP protocol, not env.

### Table — Claude Code

| Setting | File | Format | Scope | Reload | Confidence |
|---|---|---|---|---|---|
| permissions, hooks, env, apiKeyHelper | `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json` | JSON | machine / project / project-local | **hot-reload** | documented |
| model | same settings files | JSON | same | **restart** (or `/model`) | documented |
| outputStyle | same settings files | JSON | same | restart or `/clear` | documented |
| managed policy | `managed-settings.json` + `.d/`, plist, registry, server | JSON/plist/REG | machine or org | hot-reload (watched) | documented |
| user memory | `~/.claude/CLAUDE.md` | Markdown | per-machine | session start | documented |
| project memory | `./CLAUDE.md` or `./.claude/CLAUDE.md` + ancestors | Markdown | project / per-directory | session start (root re-injected on `/compact`) | documented |
| local memory | `./CLAUDE.local.md` | Markdown | project-local | session start | documented |
| rules | `.claude/rules/*.md`, `~/.claude/rules/*.md` | Markdown + YAML frontmatter | project / machine | session start or matching file read | documented |
| auto memory | `~/.claude/projects/<project>/memory/MEMORY.md` | Markdown | per-repo, machine-local | session start (index), on demand (topics) | documented |
| MCP user + local | `~/.claude.json` | JSON | machine (local keyed by project path) | not documented | documented path / inferred reload |
| MCP project | `.mcp.json` | JSON | per-project | approval required; reload not documented | documented path |
| subagents | `~/.claude/agents/`, `.claude/agents/` | Markdown + frontmatter | machine / project | not documented | documented path |
| credentials | macOS Keychain; else `~/.claude/.credentials.json` | JSON | per-machine | n/a | documented |

---

## 3. Hermes Agent (Nous Research)

Sources — all under [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) `website/docs/` (also the published docs site): `user-guide/which-file-does-what`, `user-guide/configuration`, `user-guide/profiles`, `user-guide/configuring-models`, `user-guide/features/{personality,memory,mcp,acp}`, `reference/{mcp-config-reference,environment-variables}`, `user-guide/secrets/index`.

**Install layout (verbatim from `user-guide/configuration`):**

```
~/.hermes/
├── config.yaml     # Settings (model, terminal, TTS, compression, etc.)
├── .env            # API keys and secrets
├── auth.json       # OAuth provider credentials (Nous Portal, etc.)
├── SOUL.md         # Primary agent identity (slot #1 in system prompt)
├── memories/       # Persistent memory (MEMORY.md, USER.md)
├── skills/         # Agent-created skills
├── cron/           # Scheduled jobs
├── sessions/       # Gateway sessions
└── logs/           # Logs (errors.log, gateway.log — secrets auto-redacted)
```

Format **YAML**. Base dir `$HERMES_HOME`, default `~/.hermes`; `HERMES_HOME` "also scopes the gateway PID file and systemd service name, so multiple installations can run concurrently."

Precedence, highest first: CLI args → `config.yaml` → `.env` → built-in defaults. Secrets go in `.env`, everything else in `config.yaml`; `hermes config set KEY VAL` routes automatically (API keys to `.env`). Admins can pin values via a system-level managed directory (`user-guide/managed-scope`). `${VAR}` and Cursor-style `${env:VAR}` substitution work in `config.yaml`; `${file:}`/`${vault:}` SecretRefs are **not** resolved inline. CLI: `hermes config get|set|unset|edit|check|migrate`.

### Identity / instruction files (documented, exact)

| File | Who writes | Where | When seen |
|---|---|---|---|
| `SOUL.md` | you (seeded on first run, never overwritten) | `$HERMES_HOME/SOUL.md` — "never the working directory" | slot #1 of the system prompt, at session start |
| `USER.md` | the agent, via the `memory` tool | `~/.hermes/memories/` | frozen snapshot injected at session start |
| `MEMORY.md` | the agent, via the `memory` tool | `~/.hermes/memories/` | frozen snapshot injected at session start |
| `AGENTS.md` | you | project cwd + subdirs | loaded at startup; nested copies discovered progressively |
| `.hermes.md` / `HERMES.md` | you | project; discovery walks up to git root | highest-priority project context |

**Only one project context type loads per session, first match wins:** `.hermes.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules`. `SOUL.md` always loads independently and is not in that chain. At start SOUL.md is scanned for prompt-injection patterns and truncated if needed; if missing or unloadable, Hermes falls back to a built-in default identity.

### Multi-agent / profiles

"A profile is a separate Hermes home directory." Each gets its own `config.yaml`, `.env`, `SOUL.md`, memories, sessions, skills, cron jobs and state DB, at `~/.hermes/profiles/<name>/`. The default profile *is* `~/.hermes`. Mechanism: the generated `~/.local/bin/<name>` wrapper sets `HERMES_HOME=~/.hermes/profiles/<name>`; equivalently `hermes -p <name>` or sticky `hermes profile use <name>`. Commands: `hermes profile create|list|show|rename|delete|export|import|install|update`. `display_name` in `~/.hermes/profile.yaml` renames the default profile presentationally only.

Docs warn explicitly: **never point two agent processes at the same profile** — both write memory and load each other's writes. Each profile runs its own gateway process, its own bot tokens in its `.env`, its own `hermes-gateway-<name>` service, with token-collision locks.

Working directory is separate from the profile: `terminal.cwd` in that profile's `config.yaml`. Tool subprocesses keep the real OS `HOME` by default; `terminal.home_mode: profile` switches them to `{HERMES_HOME}/home` (with `HERMES_REAL_HOME` exposed).

**Model config.** `model:` is a mapping with `provider`, `default`, `base_url`, `api_mode`. A brand-new install has the sentinel `model: ""` until `hermes setup`/`hermes model` upgrades it in place. `hermes config set model.default anthropic/claude-sonnet-4`. Auxiliary slots (compression, vision, page summarization, approval scoring, MCP routing, session titles, skill search) live under `auxiliary:`. `HERMES_MODEL` overrides at process level (docs prefer `config.yaml`). Dashboard model switches apply to **new sessions only**; `/model` hot-swaps the current chat.

**MCP.** Root key `mcp_servers:` in `config.yaml`. stdio: `command`, `args`, `env`. HTTP: `url`, `headers`, `transport: sse`, `ssl_verify`, `client_cert`, `client_key`, `auth: oauth`, `skip_preflight`. Both: `enabled`, `timeout` (300s), `connect_timeout` (60s), `protocol` (`auto`|`stateless`|`legacy`), `keepalive_interval` (180s), `supports_parallel_tool_calls`, `tools.{include,exclude,resources,prompts}`, `sampling`, `elicitation`, `trust` (`full` default | `untrusted`, forcing approval on every non-`readOnlyHint` tool). stdio-only: `idle_timeout_seconds`, `max_lifetime_seconds`.

**ACP.** `hermes acp` / `hermes-acp` / `python -m acp_adapter` run Hermes as an **ACP server over stdio** (stderr logs, stdout reserved for JSON-RPC). Requires the extra: `cd ~/.hermes/hermes-agent && uv pip install -e '.[acp]'`. Runs a curated `hermes-acp` toolset (file, terminal, web/browser, memory, todo, session search, skills, execute_code, delegate_task, vision), excluding messaging delivery and cron. `hermes acp --version|--check` for non-interactive checks. ACP mode keeps the profile's identity, providers, memory, skills, tools.

**Credentials.** `$HERMES_HOME/.env` (API keys, bot tokens) and `$HERMES_HOME/auth.json` (OAuth provider credentials, e.g. Nous Portal). Per-profile copies at `~/.hermes/profiles/<name>/.env`. External managers (Bitwarden, 1Password, command helper) inject into the environment at process start via the `secrets:` block; `secrets.preserve_existing` and `secrets.profile_alias` govern shared vaults across profiles. `hermes profile export` strips API keys.

**Reload — mixed, documented per subsystem.** Session context (SOUL.md, AGENTS.md, memory snapshots) is assembled at session start: "restart the session to pick up changes"; memory writes hit disk immediately but only enter the system prompt next session. `model.context_length` and any `compression.*` key **hot-reload** on a running gateway — "takes effect on the next message — no gateway restart, no `/reset`" (same for `progress_notices`, `hygiene_hard_message_limit`). "API keys and tool/skill config still require the usual reload paths." MCP: the CLI auto-reloads MCP connections when `config.yaml` changes (30s timeout, too short for interactive OAuth); `/reload-mcp` forces it; servers can push `notifications/tools/list_changed`.

### Table — Hermes Agent

| Setting | File | Format | Scope | Reload | Confidence |
|---|---|---|---|---|---|
| model, provider, auxiliary models | `$HERMES_HOME/config.yaml` | YAML | per-agent (profile) | new sessions; `/model` hot-swaps current chat | documented |
| terminal backend + cwd | `$HERMES_HOME/config.yaml` (`terminal.*`) | YAML | per-agent | restart session | documented |
| compression / context length | `$HERMES_HOME/config.yaml` | YAML | per-agent | **hot, next message** | documented |
| mcp_servers | `$HERMES_HOME/config.yaml` | YAML | per-agent | auto-reload on file change; `/reload-mcp` | documented |
| identity / persona | `$HERMES_HOME/SOUL.md` | Markdown | per-agent | session start | documented |
| user profile / agent notes | `$HERMES_HOME/memories/USER.md`, `MEMORY.md` | Markdown | per-agent | session start (frozen snapshot) | documented |
| project instructions | `.hermes.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules` | Markdown | per-project (first match only) | session start | documented |
| secrets / API keys | `$HERMES_HOME/.env` | dotenv | per-agent | restart | documented |
| OAuth credentials | `$HERMES_HOME/auth.json` | JSON | per-agent | n/a | documented |
| profile roster | `~/.hermes/profiles/<name>/` + `~/.local/bin/<name>` | dirs + shell wrapper | per-machine | n/a | documented |
| admin-pinned config | system-level managed directory | not stated on pages read | per-machine | not stated | **ambiguous** — exact path in `user-guide/managed-scope`, not fetched |

---

## 4. OpenClaw

Sources — all [docs.openclaw.ai](https://docs.openclaw.ai) (every page also serves `.md`, plus an `llms.txt` index): `/gateway/configuration`, `/gateway/configuration-reference`, `/gateway/config-agents`, `/concepts/agent-workspace`, `/concepts/multi-agent`, `/concepts/models`, `/gateway/authentication`, `/gateway/multiple-gateways`.

**Config file: `~/.openclaw/openclaw.json`, format JSON5** (comments + trailing commas). All fields optional. Must be a **regular file, not a symlink** — OpenClaw writes atomically via rename, so a symlinked config gets its target replaced. `OPENCLAW_CONFIG_PATH` points at a config outside the state dir. `$include` splits sections into separate files (`agents: { $include: "./agents.json5" }`) and OpenClaw writes back into the included file.

**Authoritative schema at runtime:** `openclaw config schema` prints the live JSON Schema used for validation and the Control UI; agents can call the `gateway` tool action `config.schema.lookup` for one path-scoped node. The reference page states plainly: "Code truth beats this page."

Non-workspace state (explicitly not to be committed with the workspace): `~/.openclaw/state/openclaw.sqlite` (shared setup state); `~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite` (auth profiles, routing state, session rows, transcripts); `~/.openclaw/agents/<agentId>/agent/codex-home/` (per-agent Codex runtime); `~/.openclaw/credentials/` (channel/provider state + legacy OAuth imports); `~/.openclaw/skills/` (managed skills); `~/.openclaw/sandboxes/`.

### Workspace layout

Default `~/.openclaw/workspace`. If `OPENCLAW_PROFILE` is set and not `default` → `~/.openclaw-<profile>/workspace`. `OPENCLAW_WORKSPACE_DIR` overrides both. A non-default `OPENCLAW_STATE_DIR` puts it at `<state-dir>/workspace`. Non-default agents without an explicit workspace resolve to `<state-dir>/workspace-<agentId>`. Config overrides: `agents.defaults.workspace`, per-agent `agents.entries.<id>.workspace`.

| File | Purpose |
|---|---|
| `AGENTS.md` | operating instructions; loaded every session (its `## Tools` section is guidance only, not tool gating) |
| `SOUL.md` | persona, tone, boundaries; loaded every session |
| `USER.md` | directive-based user model; loaded every session with a **separate 4,000-char budget** |
| `IDENTITY.md` | agent name, vibe, emoji; created/updated in the bootstrap ritual |
| `BOOT.md` | optional startup checklist, run on gateway restart when internal hooks are enabled |
| `BOOTSTRAP.md` | one-time first-run ritual, only for a brand-new workspace |
| `memory/YYYY-MM-DD.md` | daily memory log |
| `MEMORY.md` | optional curated long-term memory; main private session only |
| `skills/` | workspace skills — highest-precedence skill location |
| `canvas/` | Canvas UI files |

Missing required bootstrap files inject a "missing file" marker and continue; optional `USER.md`/`MEMORY.md` are omitted when absent. Truncation: `agents.defaults.bootstrapMaxChars` (20000), `agents.defaults.bootstrapTotalMaxChars` (60000), `USER.md` capped separately at 4000. `agents.defaults.skipBootstrap: true` disables seeding. `openclaw onboard|configure|setup` create the workspace and seed files. **The workspace is a default cwd, not a sandbox** — absolute paths still reach the host unless `agents.defaults.sandbox` is enabled.

### Registering agents

```json5
{
  agents: { entries: {
    alex: { default: true, workspace: "~/.openclaw/workspace-alex" },
    mia:  { workspace: "~/.openclaw/workspace-mia" },
  } },
  bindings: [
    { agentId: "alex", match: { channel: "whatsapp", peer: { kind: "direct", id: "+1555..." } } },
  ],
}
```

Each agent gets a workspace, a state dir (`agentDir`, default `~/.openclaw/agents/<agentId>/agent`, overridable via `agents.entries.*.agentDir`), and a SQLite session store. `bindings` route inbound channel messages to an agent. **Never reuse `agentDir` across agents** — auth/session collisions. Most `agents.defaults.*` keys have an `agents.entries.*` per-agent override (model, params, modelPolicy, skills, contextInjection, bootstrap caps, heartbeat, fastModeDefault, reasoningDefault, toolProgressDetail, utilityModel, sandbox).

**Model/provider.** `agents.defaults.model` and `agents.entries.*.model` take `provider/model` refs or aliases; `utilityModel` handles short internal tasks; `agents.defaults.models` is the per-model metadata/params map. `modelPolicy.allow` is an allowlist accepting aliases, exact refs, and trailing wildcards (`openai/*`); empty/omitted = allow any. `models.mode` (`merge`|`replace`), `models.providers.<id>` for custom providers/base URLs, `models.providers.*.localService` for on-demand local servers, `models.catalogRefresh.enabled` (default `true`) / `.url` — a downloaded catalog **applies on the next Gateway restart**. `params` merge order: `agents.defaults.params` → `agents.defaults.models[ref].params` → `agents.entries.*.params`. Whole-agent runtime keys (`agents.defaults.agentRuntime`, `OPENCLAW_AGENT_RUNTIME`) are **legacy and ignored**; runtime is selected per model via `models.providers.<p>.agentRuntime` or `...models[ref].agentRuntime`.

**Gateway.** `gateway: { mode: "local"|"remote", port: 18789, bind: "loopback", publicOrigin, auth: { mode: "none"|"token"|"password"|"trusted-proxy", token, allowTailscale, identityScopes, rateLimit }, tailscale: { mode: "off"|"serve"|"funnel" }, controlUi: { enabled, basePath }, tls: { enabled, autoGenerate, certPath, keyPath, caPath }, reload: { mode: "hybrid"|"off" } }`. Default port **18789**. Multi-instance: `OPENCLAW_CONFIG_PATH=... OPENCLAW_STATE_DIR=~/.openclaw-a openclaw gateway --port 19001`, or `--dev` (`~/.openclaw-dev`, port 19001) / `--profile <name>` (`~/.openclaw-<name>`).

**MCP.** `mcp.servers.<name>`: stdio (`command`, `args`) or remote (`url`, `transport: "streamable-http"|"sse"`, `requestTimeoutMs`, `connectionTimeoutMs`, `supportsParallelToolCalls`, `headers` with `${VAR}` substitution). Managed with `openclaw mcp list|show|set|unset` (no connection made during config edits).

**ACP.** `acp: { enabled, dispatch.enabled, backend, fallbacks, defaultAgent, allowedAgents, stream: { repeatSuppression, deliveryMode: "live"|"final_only", tagVisibility }, runtime.installCommand }`. `backend` must match a registered ACP runtime plugin (install it, and include its id in `plugins.allow` if that list is set).

**Credentials.** `auth.profiles.<id>` = `{ provider, mode: "api_key"|"oauth"|... }`, with `auth.order.<provider>` for rotation. **Per-agent profiles are stored at `<agentDir>/auth-profiles.json`**, supporting value-level refs (`keyRef`, `tokenRef`) for static modes; OAuth-mode profiles do not support SecretRef. Legacy OAuth imports from `~/.openclaw/credentials/oauth.json`. Channel/provider state under `~/.openclaw/credentials/`. CLI: `openclaw secrets store|reload|audit|configure|apply`.

**Reload (documented explicitly).** "The Gateway watches `~/.openclaw/openclaw.json` and applies changes automatically — no manual restart needed for most settings." `gateway.reload.mode`: `hybrid` (default — hot-applies safe changes, restarts automatically for critical ones) or `off` (no watching; next manual restart). Retired `hot`/`restart` values are mapped to `hybrid` by `openclaw doctor --fix`. Channel changes restart only that channel; `hooks`, `cron`, `agent.heartbeat` restart only that subsystem; `gateway.reload` and `gateway.remote` are exceptions under `gateway.*` and trigger no restart. **Plugins may declare their own restart-triggering config prefixes**, so actual behavior depends on which plugins are loaded. Invalid config fails validation and the Gateway keeps the last good config.

### Table — OpenClaw

| Setting | File | Format | Scope | Reload | Confidence |
|---|---|---|---|---|---|
| gateway port / bind / auth / TLS | `~/.openclaw/openclaw.json` (`gateway.*`) | JSON5 | per-machine (per gateway instance) | restart (hybrid restarts automatically) | documented |
| `gateway.reload`, `gateway.remote` | same | JSON5 | per-machine | hot, no restart | documented |
| agent roster + routing | same (`agents.entries.*`, `bindings`) | JSON5 | per-machine, defines per-agent | hot-reload (watched) | documented |
| model / provider / modelPolicy | same (`agents.defaults.model`, `agents.entries.*.model`, `models.*`) | JSON5 | per-agent (defaults per-machine) | hot-reload; catalog needs restart | documented |
| MCP servers | same (`mcp.servers.*`) | JSON5 | per-machine, consumed per-agent | hot-reload (watched) | documented |
| ACP backend / allowed agents | same (`acp.*`) | JSON5 | per-machine | hot-reload (watched) | documented |
| channels | same (`channels.*`) | JSON5 | per-machine | hot (restarts that channel) | documented |
| persona / instructions / user model / identity | `<workspace>/SOUL.md`, `AGENTS.md`, `USER.md`, `IDENTITY.md` | Markdown | per-agent | session start | documented |
| memory | `<workspace>/MEMORY.md`, `<workspace>/memory/YYYY-MM-DD.md` | Markdown | per-agent | on demand / session start | documented |
| skills | `<workspace>/skills/` (highest), `~/.openclaw/skills/` (managed) | dirs | per-agent / per-machine | not stated | documented paths |
| auth profiles | `<agentDir>/auth-profiles.json` (default `~/.openclaw/agents/<id>/agent/`) | JSON | **per-agent** | not stated | documented path / inferred reload |
| channel + legacy OAuth credentials | `~/.openclaw/credentials/` | mixed | per-machine | not stated | documented path |
| sessions | `~/.openclaw/agents/<id>/agent/openclaw-agent.sqlite` | SQLite | per-agent | n/a | documented |

---

## Cross-cutting notes for an app reading/writing these

1. **Every runtime resolves its root from an env var — never hardcode `~`.** `CODEX_HOME` (→ `~/.codex`), `HERMES_HOME` (→ `~/.hermes`), `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` / `OPENCLAW_PROFILE` / `OPENCLAW_WORKSPACE_DIR` (→ `~/.openclaw`). Claude Code is the exception: `~/.claude` and `~/.claude.json` are fixed, resolving to `%USERPROFILE%\.claude` on Windows.
2. **Multi-agent models differ fundamentally.** Codex and Claude Code: one per-user config plus per-project overlays. Hermes: each agent gets its own *home directory* (profile), switched via `HERMES_HOME`. OpenClaw: many agents in **one** gateway process, one config file, per-agent `agents.entries` + workspaces + `agentDir`.
3. **Formats:** TOML / JSON / YAML / JSON5. TOML and JSON5 permit comments — naive parse-and-rewrite destroys user comments in Codex and OpenClaw configs. OpenClaw also rewrites atomically and forbids symlinked configs.
4. **Writes race the user.** Claude Code's `/model` writes `~/.claude/settings.json`; Claude Code and OpenClaw both *watch* their config files. Read-modify-write on every change, never cache.
5. **Don't write secrets.** Codex prefers keyring (`cli_auth_credentials_store`), Claude Code prefers macOS Keychain, Hermes routes keys to `.env` via `hermes config set`, OpenClaw has a `secrets` subsystem plus per-agent `auth-profiles.json` with value refs.

## Gaps and ambiguities (flagged)

- **Codex reload semantics are not documented at all** — treat as per-invocation (inferred).
- **Codex layering** — config-basic and config-reference give overlapping precedence lists; `/etc/codex/config.toml` appears only in config-basic, `requirements.toml` only in config-reference.
- **codex-acp** documents no cwd/model/approval env vars beyond `CODEX_CONFIG` (JSON merged into session config) and `INITIAL_AGENT_MODE`.
- **claude-agent-acp** documents only `CLAUDE_MODEL_CONFIG`; everything else arrives via ACP `_meta.claudeCode.options.settings`. The old `@zed-industries/claude-code-acp` name now resolves to `@agentclientprotocol/claude-agent-acp` — verify which package a given install actually uses.
- **Hermes managed/admin scope** — docs reference a "system-level managed directory" (`/user-guide/managed-scope`) but I did not fetch that page; the exact path is unverified here.
- **Claude Code MCP reload** — nothing in the MCP doc says whether `.mcp.json` / `~/.claude.json` changes hot-reload. The settings doc's "most keys" hot-reload statement covers `settings.json`, not these files.
- **OpenClaw per-key reload depends on loaded plugins** (stated in the docs), so no static table is fully authoritative — query `openclaw config schema` at runtime.
