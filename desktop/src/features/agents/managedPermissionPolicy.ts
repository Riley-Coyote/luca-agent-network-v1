import type { CapabilityManagedPermissionRequest } from "@/shared/api/types";

/** Keep the renderer's durable option aligned with native fail-closed policy. */
export function canRememberCapabilityPermission(
  request: CapabilityManagedPermissionRequest,
): boolean {
  return (
    request.risk !== "high_impact" &&
    ![
      "external_communication",
      "destructive_action",
      "credential_use",
    ].includes(request.capability)
  );
}
