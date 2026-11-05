# Buzz Nest

Your persistent workspace. Created once by the Buzz desktop app. The static content above the managed-section markers is regenerated on upgrades — add custom notes below the markers or in separate files.

## Directory Layout

| Dir | Purpose |
|-----|---------|
| `GUIDES/` | Actionable runbooks synthesized from research |
| `PLANS/` | Planning documents for work in progress |
| `RESEARCH/` | Findings, notes, and reference material |
| `WORK_LOGS/` | Session logs — what was tried, learned, decided |
| `OUTBOX/` | Shareable docs for external readers (no frontmatter) |
| `REPOS/` | Source checkouts. Work in an existing local checkout when one exists; clone here only when none does |
| `.scratch/` | Temporary working files — treat as disposable between sessions |

Filenames: `ALL_CAPS_WITH_UNDERSCORES.md` (e.g., `OAUTH_FLOW_NOTES.md`).

## Choose the session's real tools

In Polyphonic, managed residents use the scoped tools advertised by the current
runtime. The `buzz-cli` skill contains the operating guide and a separately
marked legacy CLI reference. Tool availability and receipts take precedence over
examples in this workspace; a directory entry is not a permission grant.

- Use `polyphonic_status` for relevant setup and resident state, and
  `polyphonic_open` to open a supported review surface. Opening is not saving.
- For an authorized request to contact a named resident, use the verified
  directory's exact supported `@Name` in your ordinary reply with a concrete
  question or bounded task. The host routes that exchange. Use the plain name
  without `@` for discussion and final synthesis. Do not guess aliases or send
  a duplicate message through the CLI. The old `communications_*` broker is
  retired in this desktop; definitions in source do not enable it.
- Reuse suitable residents. `list_resident_runtimes` and `propose_resident` are
  the persistent-specialist path; `propose_runtime_task` is the reviewed,
  temporary Codex/Claude Code task path. Report each operation's actual state.
- Your ordinary response is published by the host. Managed residents receive
  no `BUZZ_PRIVATE_KEY` or `BUZZ_AUTH_TAG`. Never obtain credentials or use the
  CLI to work around a missing scoped tool.

Only a separately provisioned legacy Buzz session uses the CLI relay commands
below the skill's legacy heading. An installed CLI does not make this such a
session. Native shell/file tools remain available for authorized project work
under their own policies; connected Brain sources are a different access path.

## Knowledge File Conventions

Files in `GUIDES/`, `PLANS/`, `RESEARCH/`, `WORK_LOGS/` should include YAML frontmatter:

```yaml
---
title: "Always Quoted Title"
tags: [lowercase-hyphenated]
status: active
created: 2026-01-15
---
```

**Status values:** `active` | `superseded` | `stale` | `draft`

> ⚠️ Title **must** be quoted — unquoted colons can break YAML parsing.

## Core Guidelines

- **Local first** — check `RESEARCH/`, `GUIDES/`, `PLANS/` before external searches
- **Write findings down** — if you research something, save it to `RESEARCH/`
- **Cite sources** — no claim without a path, link, or reference
- **Don't overwrite** — append or create new files; don't silently clobber existing work
- **`.scratch/` is disposable** — don't rely on it across sessions
- **Stay on task** — only stage files relevant to your current work
- **Keep personal context scoped** — this Nest is a shared workspace, not a
  resident's private memory store. Do not place private conversations, user
  profiles, resident self-models, or credentials in these shared folders.

## Git Commit Identity

The human operator signs off for accountability.

- **Human sign-off (required):** every commit MUST include a `Signed-off-by` trailer for the human operator who is responsible for the agent's work. Add via `git commit --trailer "Signed-off-by: Human Name <human@email>"`. One blank line must separate trailers from the commit body.
- **Human credit (`Co-authored-by`):** every commit MUST also include a `Co-authored-by` trailer for the same human operator, with identical name and email to the `Signed-off-by` line. GitHub parses `Co-authored-by` for contribution-graph credit; `Signed-off-by` alone does not grant it. Add via `git commit --trailer "Co-authored-by: Human Name <human@email>"`. Place `Co-authored-by` before `Signed-off-by` in the trailer block.
- **Discovering the human's identity:** read `git config user.name` and `git config user.email` from the working repository. These reflect the human operator's configured identity for that repo (which may differ from their global config). Use these exact values for both trailers. Do NOT hardcode, guess, or prompt for the email — the repo config is the source of truth. If `git config user.email` returns empty, STOP and ask the human operator for their name and email before committing.
- **Signing:** if the agent has a registered signing key, sign commits. If not, commits will land unverified — this is acceptable until agent SSH keys are provisioned. Do NOT use the human's signing key.
- **Verify before pushing:** `git log -1` should show the human's `Signed-off-by` trailer.

<!-- BEGIN BUZZ MANAGED — regenerated automatically, do not edit below -->
## Active Agents

*(No agents deployed yet. Add agents in the Buzz desktop app.)*

<!-- END BUZZ MANAGED -->
