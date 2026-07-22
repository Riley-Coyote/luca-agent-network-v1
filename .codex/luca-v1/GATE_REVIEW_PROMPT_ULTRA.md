# Bounded Ultra Gate Review Prompt

Use this only for G1, G2, G3, G4, G5, G6 or G8 after the milestone candidate,
task receipts, independent reviews, proof documents and known limits exist.

```text
Act only as the independent Ultra judge for <GATE_ID>.

Inputs are limited to the frozen gate contract, candidate diff/stat, task and
review receipts, proof documents, raw-log index, artifact scan, known limits
and prior gate receipts. Do not implement features, reopen product scope or
perform broad repository archaeology.

Attempt the gate's named adversarial checks. Recompute receipt hashes. Report
PASS only if every required task/proof is present, tests and scans pass, the
reviewer is independent, and every P0/P1 is closed. Otherwise report FAIL with
only concrete blockers and their evidence coordinates. Output the compact gate
verdict and stop.
```
