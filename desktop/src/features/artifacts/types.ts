export type ArtifactKind =
  | "html"
  | "markdown"
  | "text"
  | "code"
  | "image"
  | "svg"
  | "pdf"
  | "file"
  | "app";

export type ArtifactAvailability =
  | "ready"
  | "preview_unavailable"
  | "source_missing"
  | "corrupt"
  | "too_large"
  | "unavailable";

export type ArtifactVersion = Readonly<{
  id: string;
  number: number;
  createdAt: string;
  note: string;
  sizeLabel: string;
  sizeBytes?: number;
  mediaType?: string;
  contentHash?: string;
  source: string;
}>;

export type ArtifactSourceBinding = Readonly<{
  kind: "file" | "directory";
  relativePath: string;
  availability: "available" | "missing";
}>;

export type ArtifactProvenance = Readonly<{
  conversationId: string | null;
  conversationLabel: string | null;
  projectId: string | null;
  projectLabel: string | null;
  residentPubkey: string | null;
  residentName: string;
  turnId: string | null;
  dispatchReceiptId: string | null;
  finalMessageId: string | null;
}>;

export type ArtifactSummary = Readonly<{
  id: string;
  title: string;
  kind: ArtifactKind;
  mediaType: string;
  language: string | null;
  currentVersion: number;
  currentVersionId: string | null;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  deletedAt: string | null;
  availability: ArtifactAvailability;
  summary: string | null;
  provenance: ArtifactProvenance;
  sourceBinding: ArtifactSourceBinding | null;
  activePreviewSessionId: string | null;
}>;

export type ArtifactDetail = ArtifactSummary &
  Readonly<{ versions: readonly ArtifactVersion[] }>;

export type ArtifactPreviewCapability =
  | "html"
  | "markdown"
  | "text"
  | "code"
  | "image"
  | "svg_image"
  | "pdf"
  | "generic"
  | "app";

export type ArtifactPreviewPayload = Readonly<{
  artifactId: string;
  version: number;
  versionId: string | null;
  capability: ArtifactPreviewCapability;
  mediaType: string;
  language: string | null;
  text: string | null;
  dataUrl: string | null;
  truncated: boolean;
  availability: ArtifactAvailability;
  safeMessage: string | null;
}>;

export type ArtifactListPage = Readonly<{
  artifacts: readonly ArtifactSummary[];
  nextCursor: string | null;
  total: number;
}>;

export type ArtifactReceiptState =
  | "provisional"
  | "linked"
  | "interrupted"
  | "orphaned";

export type ArtifactReceipt = Readonly<{
  id: string;
  artifactId: string;
  artifactTitle: string;
  version: number | null;
  state: ArtifactReceiptState;
  conversationId: string;
  residentPubkey: string;
  residentName: string;
  turnId: string;
  dispatchReceiptId: string;
  sessionEpoch: number;
  finalMessageId: string | null;
  createdAt: string;
}>;

export type PreviewHealth = "starting" | "ready" | "unreachable" | "stopped";

export type PreviewSession = Readonly<{
  id: string;
  artifactId: string;
  displayUrl: string;
  proxyUrl: string;
  status: PreviewHealth;
  conversationId: string;
  residentPubkey: string;
  turnId: string;
  attachedAt: string;
  checkedAt: string;
}>;

export type ArtifactCanvasPresentation = Readonly<{
  artifactId: string;
  version: number | null;
  previewSessionId: string | null;
  conversationId: string | null;
  residentPubkey: string | null;
  turnId: string | null;
  source: "agent" | "conversation" | "library" | "reopen";
}>;

export type ArtifactCanvasMode = "expanded" | "contained" | "focus";
export type ArtifactCanvasPhase = "closed" | "opening" | "open" | "closing";

export type ArtifactRecord = Readonly<{
  id: string;
  title: string;
  kind: ArtifactKind;
  language?: string;
  author: string;
  authorSeed: string;
  conversation: string;
  project: string;
  updatedAt: string;
  sizeLabel: string;
  summary: string;
  imageUrl?: string;
  versions: readonly ArtifactVersion[];
}>;

export type ArtifactView = "preview" | "source" | "versions";
