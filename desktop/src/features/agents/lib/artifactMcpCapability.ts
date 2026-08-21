import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";

export type ArtifactMcpCapabilityPresentation = Readonly<{
  state:
    | AcpRuntimeCatalogEntry["artifactMcpSupport"]
    | "loading"
    | "not_reported";
  value: string;
  detail: string;
}>;

export function artifactMcpCapabilityPresentation(input: {
  runtimeReference: string | null;
  runtimes: readonly AcpRuntimeCatalogEntry[] | undefined;
  loading: boolean;
  failed: boolean;
}): ArtifactMcpCapabilityPresentation {
  if (input.loading) {
    return {
      state: "loading",
      value: "Checking runtime support",
      detail: "Luca is reading the runtime catalog.",
    };
  }

  const reference = input.runtimeReference?.trim() ?? "";
  const runtime = reference
    ? input.runtimes?.find(
        (entry) =>
          entry.id === reference || entry.command?.trim() === reference,
      )
    : undefined;
  if (input.failed || !runtime) {
    return {
      state: "not_reported",
      value: "Support not reported",
      detail:
        "Luca has no catalog fact for this resident’s current runtime, so artifact tools are not assumed.",
    };
  }

  switch (runtime.artifactMcpSupport) {
    case "supported":
      return {
        state: "supported",
        value: "Available",
        detail:
          "This runtime can receive Luca’s artifact tools for managed conversation turns.",
      };
    case "probe_pending":
      return {
        state: "probe_pending",
        value: "Compatibility check pending",
        detail:
          "Luca verifies this runtime in a disposable session before exposing artifact tools.",
      };
    case "unavailable":
      return {
        state: "unavailable",
        value: "Unavailable",
        detail:
          "This runtime continues without artifact tools. Conversation remains available.",
      };
  }
}
