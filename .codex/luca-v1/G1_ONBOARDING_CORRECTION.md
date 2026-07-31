# G1 Clean-Profile Onboarding Correction

Status: approved G1 correction after native development launch on 2026-07-31

## Observed failure

A genuinely fresh `just dev` launch generated the owner identity successfully,
then blocked the owner behind Buzz community/workspace setup before the Luca
home was usable. The prior F06 PASS used the synthetic browser bridge and did
not exercise this native clean-profile transition. It therefore cannot close
the G1 no-organization-first-blocker claim.

## Required V1 behavior

The owner must never configure, create, join, or understand a Buzz community in
order to use Luca. A community may remain an internal relay tenancy boundary,
but the app must provision or select the personal-home tenancy automatically.

The only public first-run sequence is:

1. create or recover the Luca owner identity;
2. add or choose resident agents;
3. enter the personal agent home.

No first-run surface may show Buzz branding or ask for a workspace,
organization, community, team, relay URL, invite, or hosted-community account.
Advanced relay connection may return later as an explicitly advanced Settings
surface; it is not part of the V1 happy path.

If automatic personal-home provisioning fails, show a Luca-owned retry/error
state. Do not fall back to Buzz community onboarding.

## Repair ownership and order

- Reopen F03 only for the app-level gate and deferred-surface policy in
  `desktop/src/app/**`.
- Reopen F06 for owner-onboarding behavior in
  `desktop/src/features/onboarding/**` and its focused E2E.
- Keep F15 responsible for resident registry and resident selection/setup.
- F11 independently verifies the complete native clean-profile transition.

F03 precedes F06, and both use the existing `desktop_product` mutex. This is a
repair of previously owned surfaces, not authorization for concurrent edits or
a new product feature.

## Evidence correction

The existing F03 and F06 receipts remain historical evidence for their original
candidate commits, but are superseded for G1. Neither task is current again
until a new candidate-bound receipt includes the newly declared output.

F11 must launch the real Tauri app with an isolated empty app-data directory and
empty development keyring service. Browser-only or synthetic-bridge evidence is
insufficient for this claim. The proof must show:

- owner identity creation or recovery;
- automatic internal personal-home tenancy selection/provisioning;
- no public Buzz/workspace/organization/community setup or branding;
- arrival at resident setup or the Luca home without shell/database help;
- relaunch returning to the same personal home;
- a Luca-owned failure state when provisioning is forced to fail;
- screenshots, accessibility state and console/runtime logs.

## Scope boundary

Preserve Buzz's relay, signed chronology, chat layout and messaging behavior.
This correction removes product-facing infrastructure concepts; it does not
replace the messaging UI, add a conductor, introduce multi-user collaboration,
or begin Capsule/Mnemos work.
