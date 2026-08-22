export const POLYPHONIC_SURFACE_REQUEST = "polyphonic_surface_request" as const;

export const polyphonicSurfaces = [
  "onboarding",
  "runtime",
  "native_agents",
  "brain",
  "profile",
  "appearance",
  "recovery",
  "access",
] as const;

export type PolyphonicSurface = (typeof polyphonicSurfaces)[number];

export type PolyphonicSurfaceRequest = {
  type: typeof POLYPHONIC_SURFACE_REQUEST;
  requestId: string;
  channelId: string;
  surface: PolyphonicSurface;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePolyphonicSurfaceRequest(
  value: unknown,
): PolyphonicSurfaceRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Record<string, unknown>;
  if (
    Object.keys(payload).length !== 4 ||
    payload.type !== POLYPHONIC_SURFACE_REQUEST ||
    typeof payload.requestId !== "string" ||
    payload.requestId.trim().length === 0 ||
    typeof payload.channelId !== "string" ||
    !UUID_PATTERN.test(payload.channelId) ||
    !polyphonicSurfaces.includes(payload.surface as PolyphonicSurface)
  ) {
    return null;
  }
  return payload as PolyphonicSurfaceRequest;
}
