function warmSurface(load: () => Promise<unknown>): Promise<void> {
  // Prefetch is opportunistic; route-level lazy loading remains the retry path.
  return load().then(
    () => undefined,
    () => undefined,
  );
}

export function preloadConversationSurface() {
  return warmSurface(() => import("@/app/routes/ChannelRouteScreen"));
}

export function preloadAgentsSurface() {
  return warmSurface(() => import("@/features/agents/ui/AgentsScreen"));
}

export function preloadBrainSurface() {
  return warmSurface(() => import("@/features/luca/brain/BrainScreen"));
}

export function preloadArtifactsSurface() {
  return warmSurface(
    () => import("@/features/artifacts/ui/ArtifactLibraryScreen"),
  );
}

export function preloadActivitySurface() {
  return warmSurface(() => import("@/features/pulse/ui/PulseScreen"));
}

export function preloadSettingsSurface() {
  return warmSurface(() => import("@/features/settings/ui/SettingsScreen"));
}

export function preloadPrimaryNavigationSurfaces() {
  return Promise.allSettled([
    preloadConversationSurface(),
    preloadAgentsSurface(),
    preloadBrainSurface(),
    preloadArtifactsSurface(),
    preloadActivitySurface(),
    preloadSettingsSurface(),
  ]);
}
