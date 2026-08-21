import { invokeTauri } from "@/shared/api/tauri";
import type {
  ArtifactAvailability,
  ArtifactDetail,
  ArtifactKind,
  ArtifactListPage,
  ArtifactPreviewCapability,
  ArtifactPreviewPayload,
  ArtifactReceipt,
  ArtifactReceiptState,
  ArtifactSummary,
  ArtifactVersion,
  PreviewHealth,
  PreviewSession,
} from "@/features/artifacts/types";

type JsonRecord = Record<string, unknown>;

export type ArtifactListInput = {
  query?: string;
  kind?: ArtifactKind;
  includeDeleted?: boolean;
  cursor?: string;
  limit?: number;
};

export type ArtifactCanvasWindowResult = {
  mode: "expanded" | "contained" | "focus";
  changed: boolean;
};

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object"
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

const artifactKinds = [
  "html",
  "markdown",
  "text",
  "code",
  "image",
  "svg",
  "pdf",
  "file",
  "app",
] as const;
const artifactAvailabilities = [
  "ready",
  "preview_unavailable",
  "source_missing",
  "corrupt",
  "too_large",
  "unavailable",
] as const;
const previewCapabilities = [
  "html",
  "markdown",
  "text",
  "code",
  "image",
  "svg_image",
  "pdf",
  "generic",
  "app",
] as const;

function normalizeProvenance(value: unknown) {
  const raw = record(value);
  return {
    conversationId: nullableString(raw.conversation_id ?? raw.conversationId),
    conversationLabel: nullableString(
      raw.conversation_label ?? raw.conversationLabel,
    ),
    projectId: nullableString(raw.project_id ?? raw.projectId),
    projectLabel: nullableString(raw.project_label ?? raw.projectLabel),
    residentPubkey: nullableString(raw.resident_pubkey ?? raw.residentPubkey),
    residentName: stringValue(
      raw.resident_name ?? raw.residentName,
      "Resident",
    ),
    turnId: nullableString(raw.turn_id ?? raw.turnId),
    dispatchReceiptId: nullableString(
      raw.dispatch_receipt_id ?? raw.dispatchReceiptId,
    ),
    finalMessageId: nullableString(raw.final_message_id ?? raw.finalMessageId),
  };
}

function normalizeSummary(value: unknown): ArtifactSummary {
  const raw = record(value);
  const source = record(raw.source_binding ?? raw.sourceBinding);
  const sourceKind = enumValue(
    source.kind,
    ["file", "directory"] as const,
    "file",
  );
  return {
    id: stringValue(raw.id ?? raw.artifact_id ?? raw.artifactId),
    title: stringValue(raw.title, "Untitled artifact"),
    kind: enumValue<ArtifactKind>(raw.kind, artifactKinds, "file"),
    mediaType: stringValue(
      raw.media_type ?? raw.mediaType,
      "application/octet-stream",
    ),
    language: nullableString(raw.language),
    currentVersion: numberValue(raw.current_version ?? raw.currentVersion, 1),
    currentVersionId: nullableString(
      raw.current_version_id ?? raw.currentVersionId,
    ),
    sizeBytes:
      raw.size_bytes === null || raw.sizeBytes === null
        ? null
        : numberValue(raw.size_bytes ?? raw.sizeBytes),
    createdAt: stringValue(raw.created_at ?? raw.createdAt),
    updatedAt: stringValue(raw.updated_at ?? raw.updatedAt),
    pinned: booleanValue(raw.pinned),
    deletedAt: nullableString(raw.deleted_at ?? raw.deletedAt),
    availability: enumValue<ArtifactAvailability>(
      raw.availability ?? raw.lifecycle_state ?? raw.lifecycleState,
      artifactAvailabilities,
      "ready",
    ),
    summary: nullableString(raw.summary),
    provenance: normalizeProvenance(raw.provenance ?? raw),
    sourceBinding:
      Object.keys(source).length === 0
        ? null
        : {
            kind: sourceKind,
            relativePath: stringValue(
              source.relative_path ?? source.relativePath,
            ),
            availability: enumValue(
              source.availability,
              ["available", "missing"] as const,
              "available",
            ),
          },
    activePreviewSessionId: nullableString(
      raw.active_preview_session_id ?? raw.activePreviewSessionId,
    ),
  };
}

function normalizeVersion(value: unknown): ArtifactVersion {
  const raw = record(value);
  const sizeBytes = numberValue(raw.size_bytes ?? raw.sizeBytes);
  return {
    id: stringValue(raw.id ?? raw.version_id ?? raw.versionId),
    number: numberValue(raw.number ?? raw.version, 1),
    createdAt: stringValue(raw.created_at ?? raw.createdAt),
    note: stringValue(raw.note, "Artifact version"),
    sizeBytes,
    sizeLabel: stringValue(
      raw.size_label ?? raw.sizeLabel,
      formatBytes(sizeBytes),
    ),
    mediaType: nullableString(raw.media_type ?? raw.mediaType) ?? undefined,
    contentHash:
      nullableString(raw.content_hash ?? raw.contentHash) ?? undefined,
    source: stringValue(raw.source),
  };
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function listArtifacts(
  input: ArtifactListInput = {},
): Promise<ArtifactListPage> {
  const raw = record(
    await invokeTauri<unknown>("list_artifacts", {
      input: {
        includeDeleted: input.includeDeleted,
        limit: input.limit,
      },
    }),
  );
  const items = Array.isArray(raw.artifacts)
    ? raw.artifacts
    : Array.isArray(raw.items)
      ? raw.items
      : [];
  const query = input.query?.trim().toLowerCase() ?? "";
  const artifacts = items.map(normalizeSummary).filter((artifact) => {
    if (input.kind && artifact.kind !== input.kind) return false;
    if (!query) return true;
    return `${artifact.title} ${artifact.summary ?? ""} ${artifact.provenance.residentName} ${artifact.provenance.conversationLabel ?? ""}`
      .toLowerCase()
      .includes(query);
  });
  return {
    artifacts,
    nextCursor: nullableString(raw.next_cursor ?? raw.nextCursor),
    total:
      query || input.kind
        ? artifacts.length
        : numberValue(raw.total, items.length),
  };
}

export async function getArtifact(artifactId: string): Promise<ArtifactDetail> {
  const raw = record(
    await invokeTauri<unknown>("get_artifact", { input: { artifactId } }),
  );
  const versions = Array.isArray(raw.versions)
    ? raw.versions.map(normalizeVersion)
    : await listArtifactVersions(artifactId);
  return { ...normalizeSummary(raw), versions };
}

export async function listArtifactVersions(
  artifactId: string,
): Promise<ArtifactVersion[]> {
  const value = await invokeTauri<unknown>("list_artifact_versions", {
    input: { artifactId },
  });
  const raw = record(value);
  const versions = Array.isArray(value)
    ? value
    : Array.isArray(raw.versions)
      ? raw.versions
      : [];
  return versions.map(normalizeVersion);
}

export async function readArtifactPreview(
  artifactId: string,
  version?: number | null,
): Promise<ArtifactPreviewPayload> {
  const raw = record(
    await invokeTauri<unknown>("read_artifact_preview", {
      input: { artifactId, version: version ?? null },
    }),
  );
  const mediaType = stringValue(
    raw.media_type ?? raw.mediaType,
    "application/octet-stream",
  );
  const previewType = stringValue(raw.preview_type ?? raw.previewType);
  const contentText = nullableString(
    raw.text ?? raw.content_utf8 ?? raw.contentUtf8,
  );
  const contentBase64 = nullableString(raw.content_base64 ?? raw.contentBase64);
  const capability = (() => {
    if (previewType === "app") return "app";
    if (previewType === "unsupported") return "generic";
    if (mediaType.includes("svg")) return "svg_image";
    if (mediaType.includes("html")) return "html";
    if (mediaType.includes("markdown")) return "markdown";
    if (mediaType === "application/pdf") return "pdf";
    if (mediaType.startsWith("image/")) return "image";
    if (previewType === "text" && raw.language) return "code";
    if (previewType === "text") return "text";
    return enumValue<ArtifactPreviewCapability>(
      raw.capability,
      previewCapabilities,
      "generic",
    );
  })();
  return {
    artifactId: stringValue(raw.artifact_id ?? raw.artifactId, artifactId),
    version: numberValue(raw.version, version ?? 1),
    versionId: nullableString(raw.version_id ?? raw.versionId),
    capability,
    mediaType,
    language: nullableString(raw.language),
    text: contentText,
    dataUrl:
      nullableString(raw.data_url ?? raw.dataUrl) ??
      (contentBase64 ? `data:${mediaType};base64,${contentBase64}` : null),
    truncated: booleanValue(raw.truncated),
    availability: enumValue<ArtifactAvailability>(
      raw.availability,
      artifactAvailabilities,
      "ready",
    ),
    safeMessage: nullableString(raw.safe_message ?? raw.safeMessage),
  };
}

export async function listArtifactReceipts(
  conversationId: string,
): Promise<ArtifactReceipt[]> {
  const value = await invokeTauri<unknown>("list_artifact_receipts", {
    input: { conversationId, limit: 100 },
  });
  const raw = record(value);
  const receipts = Array.isArray(value)
    ? value
    : Array.isArray(raw.receipts)
      ? raw.receipts
      : [];
  return receipts.map((value) => {
    const item = record(value);
    return {
      id: stringValue(item.id),
      artifactId: stringValue(item.artifact_id ?? item.artifactId),
      artifactTitle: stringValue(
        item.artifact_title ?? item.artifactTitle,
        "Artifact",
      ),
      version: item.version === null ? null : numberValue(item.version, 1),
      state: enumValue<ArtifactReceiptState>(
        item.state,
        ["provisional", "linked", "interrupted", "orphaned"] as const,
        "provisional",
      ),
      conversationId: stringValue(
        item.conversation_id ?? item.conversationId,
        conversationId,
      ),
      residentPubkey: stringValue(item.resident_pubkey ?? item.residentPubkey),
      residentName: stringValue(
        item.resident_name ?? item.residentName,
        "Resident",
      ),
      turnId: stringValue(item.turn_id ?? item.turnId),
      dispatchReceiptId: stringValue(
        item.dispatch_receipt_id ?? item.dispatchReceiptId,
      ),
      sessionEpoch: numberValue(item.session_epoch ?? item.sessionEpoch),
      finalMessageId: nullableString(
        item.final_message_id ?? item.finalMessageId,
      ),
      createdAt: stringValue(item.created_at ?? item.createdAt),
    };
  });
}

function normalizePreviewSession(value: unknown): PreviewSession {
  const raw = record(value);
  return {
    id: stringValue(raw.id ?? raw.preview_session_id ?? raw.previewSessionId),
    artifactId: stringValue(raw.artifact_id ?? raw.artifactId),
    displayUrl: stringValue(raw.display_url ?? raw.displayUrl),
    proxyUrl: stringValue(raw.proxy_url ?? raw.proxyUrl),
    status: enumValue<PreviewHealth>(
      raw.status,
      ["starting", "ready", "unreachable", "stopped"] as const,
      "starting",
    ),
    conversationId: stringValue(raw.conversation_id ?? raw.conversationId),
    residentPubkey: stringValue(raw.resident_pubkey ?? raw.residentPubkey),
    turnId: stringValue(raw.turn_id ?? raw.turnId),
    attachedAt: stringValue(raw.attached_at ?? raw.attachedAt),
    checkedAt: stringValue(raw.checked_at ?? raw.checkedAt),
  };
}

export async function getPreviewSession(
  previewSessionId: string,
): Promise<PreviewSession> {
  return normalizePreviewSession(
    await invokeTauri("get_preview_session", { previewSessionId }),
  );
}

export async function refreshPreviewHealth(
  previewSessionId: string,
): Promise<PreviewSession> {
  return normalizePreviewSession(
    await invokeTauri("refresh_preview_health", { previewSessionId }),
  );
}

export async function detachPreviewSession(
  previewSessionId: string,
): Promise<void> {
  await invokeTauri("detach_preview_session", { previewSessionId });
}

export async function importArtifactFromPicker(): Promise<ArtifactSummary | null> {
  const value = await invokeTauri<unknown>("import_artifact_from_picker", {
    input: {},
  });
  return value === null ? null : normalizeSummary(value);
}

export async function pinArtifact(
  artifactId: string,
  pinned: boolean,
): Promise<ArtifactSummary> {
  return normalizeSummary(
    await invokeTauri("pin_artifact", { input: { artifactId, pinned } }),
  );
}

export async function softDeleteArtifact(artifactId: string): Promise<void> {
  await invokeTauri("soft_delete_artifact", { input: { artifactId } });
}

export async function restoreArtifact(
  artifactId: string,
): Promise<ArtifactSummary> {
  return normalizeSummary(
    await invokeTauri("restore_artifact", { input: { artifactId } }),
  );
}

export async function revertArtifact(
  artifactId: string,
  version: number,
  expectedCurrentVersion: number,
): Promise<ArtifactSummary> {
  return normalizeSummary(
    await invokeTauri("revert_artifact", {
      input: {
        artifactId,
        sourceVersion: version,
        expectedCurrentVersion,
      },
    }),
  );
}

export async function exportArtifact(
  artifactId: string,
  version?: number | null,
): Promise<void> {
  await invokeTauri("export_artifact", {
    input: { artifactId, version: version ?? null },
  });
}

export async function setArtifactCanvasWindowOpen(
  open: boolean,
  preferredCanvasWidthPx?: number,
): Promise<ArtifactCanvasWindowResult> {
  return invokeTauri("set_artifact_canvas_window_open", {
    open,
    preferredCanvasWidthPx,
  });
}
