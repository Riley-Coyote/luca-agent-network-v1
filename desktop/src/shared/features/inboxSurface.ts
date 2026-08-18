import { resolveEnabled } from "./resolveEnabled";

/**
 * Feature id for the home Inbox surface.
 *
 * Deliberately NOT listed in `preview-features.json`: this is a product-scope
 * lock, not a user-facing experiment, so it must not show up in
 * Settings → Experiments. It still resolves through the same
 * `resolveEnabled` + override-store pipeline as a manifest preview feature,
 * so an explicit override always beats the shipped default.
 */
export const INBOX_SURFACE_FEATURE_ID = "inbox";

/**
 * THE single value that turns the Inbox back on.
 *
 * Product decision (owner, 2026-08-18): the Inbox — Buzz's home
 * mentions/DMs/replies digest plus Luca's owner native-inbox bridge — is
 * disabled for now. Every resident reply is a DM reply, so an Inbox row is
 * only ever a duplicate of the conversation the owner is already reading.
 *
 * None of the Inbox code was deleted; only the surface is gated. To bring it
 * back, flip this constant to `true` — nothing else needs to change.
 *
 * To enable it for one machine or one test run without a rebuild, write the
 * shared feature-override entry owned by `./store.ts`:
 *
 *     localStorage["buzz-feature-overrides-v1"] = '{"inbox":true}'
 *
 * (E2E specs use `enableInboxSurface()` from `tests/helpers/features.ts`.)
 */
export const INBOX_SURFACE_DEFAULT_ENABLED = false;

/**
 * Pure resolution: explicit override wins, otherwise the shipped default.
 * Safe to call from tests without a DOM.
 */
export function resolveInboxSurfaceEnabled(
  overrides: Record<string, boolean>,
): boolean {
  return resolveEnabled(
    INBOX_SURFACE_FEATURE_ID,
    overrides,
    INBOX_SURFACE_DEFAULT_ENABLED,
  );
}
