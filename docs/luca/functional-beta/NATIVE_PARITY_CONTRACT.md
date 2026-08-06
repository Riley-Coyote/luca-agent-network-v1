# Native agent parity contract

## What Luca preserves

Luca imports a stable semantic identity, not a copy of the native agent. Hermes
identity is the canonical Hermes home plus exact profile name. OpenClaw identity
is the configured gateway identity plus exact agent ID. Runtime executable,
version, workspace, and connection details are replaceable binding data, so a
binding refresh cannot create a new resident key.

At launch Luca resolves only the persisted binding:

- Hermes runs the exact imported executable with `acp`, the canonical
  `HERMES_HOME`, and its configured workspace.
- OpenClaw runs the exact imported executable with `acp`, the persisted gateway
  reference, exact `LUCA_OPENCLAW_AGENT_ID`, and configured workspace.
- Native binding variables are applied after editable resident environment, so
  user configuration cannot redirect the imported profile or agent.
- Luca and provider secrets, signing authority, and owner keys are removed from
  the child environment. Credential resolution remains native.

Discovery is read-only. Historical G1 before/after hashes prove Luca did not
change the tested Hermes or OpenClaw configuration trees. This beta continues
that no-write contract and adds no native configuration writer.

## Honest limitations

The executable, profile home, agent, gateway identity, and workspace are checked
before use. A missing or changed value produces a degraded/failed resident with
a specific reason. Luca never substitutes a different profile, agent, runtime,
or directory. A capability the native ACP runtime does not expose remains
unsupported; Luca does not simulate it.

## Verification split

Deterministic source fixtures prove identity stability, exact resolution,
workspace validation, and secret exclusion. The installed V1B.4 gate owns the
claims that require real runtime behavior: native-only memory recall, workspace
file access, permission-gated tools, OpenClaw duplicate import and post-relaunch
recall, DMs, and mixed Hermes/OpenClaw attribution.
