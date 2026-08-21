# Polyphonic resident capability-parity contract

Status: implementation contract

Updated: 2026-08-21

## Product rule

Polyphonic is additive. A resident keeps the practical tools of its selected
Codex, Claude Code, Hermes, OpenClaw, or future runtime while Polyphonic adds a
stable identity, conversation, continuity, local authority, and truthful
receipts. Polyphonic must not reduce an otherwise capable runtime to chat.

The rule applies to every owned resident, including Luca. Luca is the included
concierge, not a privileged conductor or the only resident allowed to operate
the owner's machine.

## Owner authority

The household default is `standard`. Each resident has one local access level:

- `restricted`: ask before reading filesystem bodies, running commands,
  writing, using the network, or changing a harness;
- `standard`: inspect already granted roots, but ask before a new write,
  command, network, installation, or harness-management scope;
- `full`: perform routine work available to the owner's account without
  repeated prompts, while still confirming ambiguous or recursive deletion,
  credential disclosure, financial actions, publication, and messages to
  other people.

An owner may make a conversation stricter with Plan or Ask mode. Broadening a
conversation beyond the resident's access level requires owner approval.

Permission choices are `Allow once`, `Always allow`, and `Deny`. An
`Always allow` grant is local-only, belongs to the stable resident identity and
the exact capability/resource scope, survives relaunch and runtime changes,
and remains revocable. Household-wide grants require a separate explicit
owner action.

## Execution boundary

The desktop remains the authority broker. Model and tool descendants receive
only resident- and conversation-scoped capabilities; they never receive owner
or resident signing keys, a master capability, recovery material, or copied
provider credentials.

Passive discovery and import remain read-only. After an explicit owner request,
a resident may change a native harness through the following transaction:

1. inspect the installed runtime and current state;
2. describe the intended operation and affected scope;
3. obtain any required owner permission;
4. prefer the harness's supported CLI or API;
5. validate through the harness's own status, doctor, or validator;
6. roll back a partial change when supported;
7. report a redacted committed, cancelled, failed, or rolled-back receipt.

Direct configuration-file edits are fallback-only. They require a protected
backup, atomic replacement, preservation of unknown fields, native validation,
and restoration on validation failure.

Native authentication remains native-owned. Polyphonic may initiate or explain
login and secure-entry flows, but secret values never enter model context,
relay events, receipts, or default logs.

## Runtime parity

Runtime adapters report observed capabilities and preserve native project
instructions, tools, skills, plugins, MCP servers, hooks, subagents, memory,
schedules, working directories, sandboxes, and permission modes when the
runtime supports them. Polyphonic-provided operator tools are additive and use
names that do not shadow native tools.

If the runtime cannot perform a requested action, the resident states the
specific runtime limitation. The application must not describe a limitation
introduced by Polyphonic as a limitation of the underlying runtime.

## Conversational behavior

The existing first-run onboarding remains the default entry. Later setup is an
ordinary conversation plus reviewed product actions, not a second wizard.

- inspect status before asking;
- advance the current task before optional setup;
- ask at most one setup question in a turn;
- do not repeat declined suggestions insistently;
- never claim success before validation and commit;
- return the result to the source conversation.

## Non-goals for this slice

This contract does not add mobile-hosted runtimes, voice, the public Ledger,
network federation, the notch, or identity-glyph redesign. It does not change
Buzz conversation transport or give Luca privileged routing authority.
