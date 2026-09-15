import {
  listLucaMcpRegistry,
  listRuntimeConnectionStatus,
  type LucaMcpRegistryV1,
  type RuntimeConnectionStatusV1,
} from "@/shared/api/tauriMcp";

/**
 * The Doctor summary: what runtime connections and MCP look like right now.
 *
 * Extracted from the Diagnostics panel so the same body-free text can ride
 * along with a feedback report instead of being rebuilt, slightly differently,
 * in a second place. Deliberately body-free: readiness, authentication state,
 * counts and error codes — never message content, prompts or secret values.
 */

export type DoctorSummaryInput = {
  error: string | null;
  registry: LucaMcpRegistryV1 | null;
  runtimes: RuntimeConnectionStatusV1[];
};

export function formatDoctorSummary(input: DoctorSummaryInput): string {
  return JSON.stringify(
    {
      runtimeConnections: input.runtimes.map(
        ({ runtimeId, readiness, authentication, reason }) => ({
          runtimeId,
          readiness,
          authentication,
          reason,
        }),
      ),
      mcp: input.registry
        ? {
            connections: input.registry.connections.length,
            grants: input.registry.grants.length,
            health: input.registry.health.map(
              ({ connectionId, readiness, errorCode }) => ({
                connectionId,
                readiness,
                errorCode,
              }),
            ),
          }
        : null,
      error: input.error,
    },
    null,
    2,
  );
}

/** Fetch and format the summary; never throws. */
export async function collectDoctorSummary(): Promise<string> {
  try {
    const [runtimes, registry] = await Promise.all([
      listRuntimeConnectionStatus(),
      listLucaMcpRegistry(),
    ]);
    return formatDoctorSummary({ error: null, registry, runtimes });
  } catch (cause) {
    return formatDoctorSummary({
      error:
        cause instanceof Error ? cause.message : "Diagnostics unavailable.",
      registry: null,
      runtimes: [],
    });
  }
}
