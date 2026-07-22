# Implementation Roadmap

## Build sequence

```text
G0 source truth
  -> M1 personal agent home
       -> M2 cryptographic Capsule -----------+
       -> M3 universal brain -----------------+--> M5 post-turn continuity
       -> M4 guarded rooms -------------------+
                                                -> M6 identity backup/restore
                                                -> M8 installed V1 candidate
```

M2 and the foundations of M3 may overlap after G1. M4's causal guard can begin
after G1, but per-responder memory proof waits for the M3 turn hook. M5 waits for
the Capsule signer, current-pointer and Continuity Service proposal contracts.
M6 begins its file-format/dependency work after G2 and performs the clean proof
only after G3/G5.

## Milestone outcomes

| Milestone | Tasks excluding the milestone gate | User-visible outcome | Gate |
|---|---:|---|---|
| M1 | 19 | Luca-branded personal home with three real residents, persistent registry, safe diagnostics and key-safe live ACP proof | P1 and conversation shell |
| M2 | 16 | Six semantic Capsule segments, structured signing, protected local archive and managed conditional commits | P2/P3 |
| M3 | 24 | Packaged brain sidecar, governed immutable recall, policy overlay and fail-soft chat | P6/S1 |
| M4 | 10 | Three residents communicate directly under atomic local causal limits | P7 |
| M5 | 13 | Bounded post-turn digest/threads checkpoint with managed commit and recovery | P4 |
| M6 | 11 | Protected same-owner identity backup/restore with exact signed events | P5 |
| M8 | 12 | Installed, reviewed design-partner candidate and evidence bundle, including two post-G8 release/human tasks | P1-P7/S1-S6 |

The graph has 113 small tasks including eight explicit gates because authority,
crypto, deployment, failure and evidence work are deliberately separated. They
are not 113 independent agent sessions. After completed G0, the cost-optimized
schedule uses 20 compact lane sessions plus seven short Ultra gate sessions.
Each lane session can complete multiple dependency-released task capsules while
retaining every task's acceptance and evidence boundary.

## First implementation wave

After the Sol-high lead begins:

1. F01 creates the separate exact-baseline fork; F02 installs instructions,
   evidence and CI ownership.
2. The lead freezes shared protocol/canonicalization vectors and implements the
   desktop signing-broker boundary before any live identity proof.
3. Three disjoint lanes begin:
   - shell flags/branding/navigation;
   - deterministic resident fixtures and messaging regression;
   - evidence/native quality harness.
4. The integrator merges in dependency order and runs G1.

No Mnemos schema, Capsule protocol or product autonomy work is mixed into the
first fork/rebrand task. This keeps upstream behavior bisectable.

## Critical files owned only by the lead/integrator role

- workspace/root manifests and lockfiles;
- database migrations;
- Nostr event-kind/registry changes;
- Continuity Service protocol types shared across languages;
- visibility/egress schema;
- resident signing-broker API and ACP client;
- managed Capsule coordinator schema/API;
- checkpoint receipt/outbox schema;
- causal envelope schema;
- public bundle identifiers and release signing configuration.

Only the named architecture or single-writer migration integrator may commit
these boundaries. Workers may propose a patch, but it is evidence input—not an
owned-file change—until that integrator reviews and applies it.

## Definition of done for a task

A task is complete only when:

- its dependency gate is present;
- the diff stays inside owned scope;
- focused tests pass and raw output is stored;
- required security/failure fixtures pass;
- evidence references the exact commit;
- no default artifact leaks protected data;
- an independent reviewer closes every P0/P1 for high/critical tasks;
- the integrator reruns the relevant smoke set after merge.

## Stop conditions

The lead stops and records a decision delta if implementation would:

- reintroduce a conductor;
- make talk depend on continuity;
- widen memory or provider egress;
- require custom cryptography;
- bypass the managed coordinator or describe generic relay writes as atomic;
- import Polyphonic infrastructure;
- add background/recurring autonomy;
- modify the source Luca, Mnemos or Polyphonic repositories;
- overstate ordinary-room encryption or at-rest protection.
