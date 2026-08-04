# Luca Dev — Design punch-list (post-G1 polish)

Visual/UX issues observed while driving the app for G1 verification. Riley + Codex
**intentionally deferred most design work** to get the app functional first.

Capture log, not a work order — log issues as encountered; triage and fix as a batch.

---

## RESOLVED — onboarding readability pass (branding-strip damage)

Root cause: the Buzz→Luca strip (commit `265c3543`) flipped the onboarding surface
dark but left paired foreground/surface tokens light → white-on-white text + a
blown-out white card glow. Fixes verified in-browser via the mock bridge
(`?e2e=mock&machineOnboarding=1`) at vite `:50873`; typecheck + biome clean.

- [x] **Primary CTA white-on-white** (Next/Finish on backup, setup, config). Fixed
      systemically: dropped the broken `--buzz-onboarding-cta-label` override in
      `OnboardingChrome.tsx` so the Button's correctly-paired `text-primary-foreground`
      wins. Verified: computed `rgb(16,17,20)` on `rgb(240,240,240)` (~17:1).
- [x] **Runtime-card white radial glow** (setup). Switched the two Luca-path cards
      (`SetupStep.tsx`, `NostrKeyImportForm.tsx`) from the baked-white `textured`
      Card variant to flat dark `default` (hairline border). Verified: glow gone.
- [x] **SetupStep white-on-white surfaces** — READY/INSTALLING badges (`bg-[#EBEFEF]`,
      `bg-white/60`) and near-invisible action chips (`chartreuse/30`) → flat
      `bg-foreground/10` chips; empty-state panel `bg-white/70` → dark panel + border.
- [x] **DefaultConfigStep inputs** — changed `bg-white` → dark surface
      (`bg-foreground/[0.06]` + hairline). NOTE: confirmed on the real app that the
      config inputs already render dark (the `bg-white` was overridden by the select
      component and never visible), so this was a harmless defensive correction, not a
      real-bug fix. Config was never part of the white-on-white damage.
- [x] **Misleading step dots** — chrome showed 7 dots for a ~4-step flow; plumbed an
      explicit `total={4}`. Verified: `dotCount === 4`.

## OPEN — deferred (not the strip damage / bigger decisions)

- [ ] **Backup primary button overlaps the "Never share a private key…" caption** at
      shorter window heights (OnboardingFooter docks the buttons over the footer note).
      Likely viewport-height dependent; check at the real app's window size.
- [ ] **Legacy Buzz community onboarding** (`communities/ui/WelcomeSetup.tsx`,
      `HostedCommunityOnboarding.tsx`, `onboarding/ui/InviteRedeemForm.tsx`) has the same
      token bug + textured glow, but is outside the Luca personal-home path. Fix if ever
      surfaced.
- [ ] **`textured` powder-card variant** is fundamentally a light-theme surface (baked
      white PNG), used in ~11 spots. Decide whether it belongs anywhere in dark Luca.
- [ ] Full bespoke onboarding visual polish beyond readability/coherence.

## Tooling / tech-debt (found in passing)

- [ ] **Onboarding e2e specs are stale.** ~10 specs + helpers predate the Buzz→Luca UI
      rename: `onboarding-docked-cta-screenshots.spec.ts` looks for "Use an existing key" /
      "Create a new identity key" (now "Connect an existing identity" / "Create owner
      identity") and asserts the 96px textured border-image on the key-import card (now
      flat); `helpers/onboarding.ts:passThroughBackupStep` waits for an `nsec-value` the
      redesigned backup step no longer shows; the mock harness doesn't cleanly reach the
      machine-onboarding gate. Needs a pass to re-align selectors + mock setup.
- [ ] **"Luca Agent Network Dev.app" embeds a frozen frontend.** It's a
      production/embedded build (not vite/HMR), so frontend changes don't appear until the
      bundle is rebuilt + re-signed. For live iteration, run via `just dev` (HMR) instead.
