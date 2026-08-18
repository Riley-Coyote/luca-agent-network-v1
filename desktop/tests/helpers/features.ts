// Single source of truth for E2E tests: derive preview-feature data from
// /preview-features.json so we don't have to hand-maintain a parallel array.
//
// Production reads the same JSON via the `@features-manifest` vite alias
// (see `desktop/src/shared/features/manifest.ts`). The localStorage key
// format matches `OVERRIDES_KEY` in `desktop/src/shared/features/store.ts`
// — bumping `version` in `preview-features.json` updates production AND
// every spec automatically.
import featuresManifest from "../../../preview-features.json" with {
  type: "json",
};

interface FeatureDefinition {
  id: string;
  name: string;
  description: string;
  platforms?: string[];
}

interface FeaturesManifest {
  version: number;
  features: FeatureDefinition[];
}

const manifest = featuresManifest as FeaturesManifest;

/** IDs of every preview feature on desktop. */
export const PREVIEW_FEATURE_IDS: string[] = manifest.features
  .filter((f) => !f.platforms || f.platforms.includes("desktop"))
  .map((f) => f.id);

/**
 * The localStorage key the production store uses for feature overrides.
 * Mirrors `OVERRIDES_KEY` in `src/shared/features/store.ts` so a manifest
 * version bump flows through to E2E seeding without manual updates.
 */
export const FEATURE_OVERRIDES_STORAGE_KEY = `buzz-feature-overrides-v${manifest.version}`;

/**
 * The Inbox surface flag (`src/shared/features/inboxSurface.ts`).
 *
 * It is deliberately NOT in `preview-features.json` — it is a product-scope
 * lock, not a user-facing experiment — so it is seeded separately from
 * `PREVIEW_FEATURE_IDS`. It resolves through the same override key, so
 * writing `{ inbox: true }` here is all it takes to turn the surface on.
 */
export const INBOX_SURFACE_FEATURE_ID = "inbox";
