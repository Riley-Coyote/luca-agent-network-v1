# Continuity spine installed acceptance

Status: bounded installed technical smoke passed for source commit `dcdf5d6bb`

Date: 2026-08-29

Authority: [`BUILD_SPEC.md`](BUILD_SPEC.md)

## Candidate identity

- Source commit: `dcdf5d6bb` (`fix(continuity): preserve isolated wake fallbacks`).
- Installed application: `/Users/rileycoyote/Applications/Luca Agent Network Dev.app`.
- Bundle identifier: `com.luca.agent-network.dev`.
- Signature: `Developer ID Application: Riley Ralmuto (WQUY4M5HYR)`.
- Existing development bundle and profile were replaced in place; no additional
  application, profile, runtime account, or runtime configuration was created.
- The installed `buzz-desktop` process and managed ACP runtime processes were
  running after launch.

## Directly observed smoke

The installed app opened an existing Luca direct conversation and retained the
existing configured Codex resident runtime. A single synthetic, low-impact open
thread was sent through the ordinary composer:

> Continuity spine smoke: please acknowledge this explicit open thread-return
> to the continuity integration check after relaunch.

Luca published one response through the normal managed-resident path:

> Open thread acknowledged: return to the continuity integration check after
> relaunch.

The conversation inspector opened without interrupting the conversation. Its
resident surface showed the existing model and instructions. No control labelled
Continuity, Wake, correction, or Forget was visible in the current conversation
drawer, so this smoke does not claim that those internal operations have a
dedicated installed UI.

## Deliberately not claimed

This bounded technical smoke does not substitute for Riley's experiential
walkthrough. It does not claim installed verification of:

- post-relaunch natural continuation from the synthetic handoff;
- correction presentation or Forget across relaunch;
- two-resident qualitative canary isolation;
- Disabled-mode UI behavior;
- same-profile Native, Dossier, and Wake comparison;
- felt continuity quality or Riley acceptance.

Those behaviors have deterministic source coverage where applicable. The
remaining installed interactions are reserved for Riley's broad walkthrough so
that the implementation pass does not silently expand into a lengthy simulated
user session.

## Verdict

The exact source candidate was built, signed, installed, launched, and exercised
through one ordinary managed-resident send/response. The continuity spine is
source-tested and has passed this bounded installed technical smoke. It remains
separate from reflection, metabolism, the full Mnemos engine, and Riley's final
experiential acceptance.
