# G2 task receipts

Create one `<task-id>.md` receipt per task using the template below. A task is
not terminal until its receipt names the exact commit, checks, evidence, review,
and repair count.

```text
# <task-id> — <title>

Status: pending | running | passed | failed | blocked
Gate:
Lane:
Owner:
Reviewer:
Depends on:
Owned files:
Forbidden files/decisions:
Commit:
Repair count: 0

## Acceptance
- [ ] criterion

## Checks
- `command` — result

## Evidence
- `evidence/G2/...`

## Review findings
- none

## Known limits
- none
```
