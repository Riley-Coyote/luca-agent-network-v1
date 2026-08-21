export type ArtifactKind = "html" | "markdown" | "image" | "code" | "pdf";

export type ArtifactVersion = Readonly<{
  id: string;
  number: number;
  createdAt: string;
  note: string;
  sizeLabel: string;
  source: string;
}>;

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
