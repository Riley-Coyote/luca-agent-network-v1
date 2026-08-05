# C01 command evidence

Date: 2026-08-04

```text
python3 scripts/luca/validate_g2_control.py
G2 control validation: PASS

git diff --check
PASS (no output)
```

The validator checks required files, exact baseline ancestry, exhaustive gate
membership, unique tasks, known lanes, dependency references, DAG acyclicity,
interface presence, parallel-lane limit, and immutable audit checksums.
