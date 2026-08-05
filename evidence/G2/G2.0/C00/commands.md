# C00 command evidence

Date: 2026-08-04

```text
git worktree add -b agent/continuity-g2 <isolated-path> 4781dca6
HEAD is now at 4781dca6 Document continuity source audit

git push -u origin agent/continuity-g2
new branch agent/continuity-g2 -> agent/continuity-g2

git rev-parse HEAD
4781dca6a74a1dd42fe1ea6e799a8b1700865bb6

git rev-parse origin/agent/continuity-g2
4781dca6a74a1dd42fe1ea6e799a8b1700865bb6
```

The source checkout's untracked M1 evidence and Python caches were observed and
were not copied, staged, edited, or removed.
