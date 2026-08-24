/**
 * The theme system's single vocabulary.
 *
 * Three lists, three consumers, one source of truth:
 *
 * - Builders in `adaptive-theme.ts` may emit ONLY keys from
 *   `MN_ROLE_VARS` and `SIGNAL_VARS`. Semantic tokens (`--background`,
 *   `--card`, `--sidebar-*`, …) are owned by the stylesheet mapping in
 *   `conversation-shell.css` and derived from the roles — a builder that
 *   writes one inline shadows the whole semantic layer for every theme
 *   that follows it. `adaptive-theme.test.mjs` asserts the contract.
 * - `ThemeProvider.applyTheme` clears `THEME_CLEAR_VARS` from the root's
 *   inline style before applying a palette, so no theme can leak values
 *   into the next one. Because the clear list is derived from the same
 *   registry the builders are checked against, it can never fall behind
 *   the emitters again.
 * - The Settings preview tiles derive their swatches from builder output
 *   keyed by these names instead of keeping hand-copied palettes.
 */

/** The shell scale — the surface/ink roles every palette must supply. */
export const MN_ROLE_VARS = [
  "--mn-floor",
  "--mn-surface",
  "--mn-raised",
  "--mn-hover",
  "--mn-glass",
  "--mn-recess",
  "--mn-border",
  "--mn-border-strong",
  "--mn-ink",
  "--mn-ink-muted",
  "--mn-ink-faint",
  "--mn-ink-ghost",
  "--mn-focus",
] as const;
export type MnRoleVar = (typeof MN_ROLE_VARS)[number];

/**
 * Signal tokens builders own: semantic MEANINGS (destructive, git status,
 * warnings, the huddle's video canvas) rather than surface roles, restated
 * per palette because a lightness that carries on a dark canvas fails on
 * paper. Paper also restates the primary pairs — on paper the "light end of
 * the ramp" is the ink end, a decision, not a derivation.
 */
export const SIGNAL_VARS = [
  "--destructive",
  "--destructive-foreground",
  "--status-added",
  "--status-deleted",
  "--status-modified",
  "--ui-warning",
  "--ui-warning-bg",
  "--huddle-drawer-surface",
  "--huddle-control-surface",
  "--huddle-control-hover-surface",
  "--huddle-control-chevron-surface",
  "--huddle-control-chevron-hover-surface",
  "--huddle-control-foreground",
  "--huddle-popover-surface",
  "--huddle-popover-border",
  "--huddle-tooltip-surface",
  "--huddle-tooltip-foreground",
  "--primary",
  "--primary-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
] as const;
export type SignalVar = (typeof SIGNAL_VARS)[number];

/**
 * One migration generation: keys older builds wrote as root inline styles.
 * Derived syntax themes used to emit the entire semantic layer inline, and
 * the old clear list never removed those keys — switching themes left the
 * previous palette's `--background`/`--sidebar-background`/… pinned on the
 * root forever (the frozen-rail bug). Cleared on every theme apply so a
 * root styled by the old code heals on first switch. Safe to delete a
 * release after no build emits them.
 */
export const LEGACY_INLINE_VARS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--secondary",
  "--secondary-foreground",
  "--border",
  "--input",
  "--ring",
  "--sidebar-background",
  "--sidebar-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--mn-navigator",
  "--mn-surface-raised",
  "--mn-surface-hover",
  "--mn-lit-edge",
] as const;

/**
 * Everything `applyTheme` removes from the root's inline style before
 * applying a palette. `--sidebar-active`/`--sidebar-active-foreground` are
 * deliberately absent: they belong to the accent system, and
 * `applyAccentColor` runs in the same synchronous batch and both writes
 * and removes them itself.
 */
export const THEME_CLEAR_VARS = [
  ...MN_ROLE_VARS,
  ...SIGNAL_VARS,
  ...LEGACY_INLINE_VARS,
] as const;
