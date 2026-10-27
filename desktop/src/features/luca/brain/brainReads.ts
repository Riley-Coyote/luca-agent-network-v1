import type {
  ConnectedBrainInventory,
  ConnectedBrainSourceKind,
  OwnerBrainGrant,
  OwnerBrainSource,
} from "@/shared/api/tauriBrain";

/**
 * What the account's minds can read, and what one of them may (BETA14_RELEASE.md
 * WP-38, Decided 2 and 3). Pure: Brain's two records in, words and rows out.
 */

/** What they can read, in a breath: Brain's sources as its cards count them.
 *  Empty until the connected inventory has arrived. */
export function brainReadsLine(
  inventory: Pick<ConnectedBrainInventory, "sources"> | undefined,
  fileCount: number,
): string {
  if (!inventory) return "";
  const sources = inventory.sources.filter(
    (source) => source.status !== "disconnected",
  );
  const count = (kind: ConnectedBrainSourceKind) =>
    sources.filter((source) => source.sourceKind === kind).length;
  const repositories = count("repository");
  const histories = [
    count("claude_history") > 0 ? "Claude Code" : null,
    count("codex_history") > 0 ? "Codex" : null,
  ].filter(Boolean);
  const parts = [
    repositories > 0
      ? `${repositories} ${repositories === 1 ? "repository" : "repositories"}`
      : null,
    histories.length > 0 ? `${histories.join(" and ")} history` : null,
    fileCount > 0 ? `${fileCount} ${fileCount === 1 ? "file" : "files"}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Nothing connected";
}

/** One mind's access to one of Brain's sources. */
export type MindSourceAccess = {
  /** A connected source (repositories and histories) or an imported file. */
  record: "connected" | "file";
  sourceId: string;
  name: string;
  /** The source's kind, as Brain's cards name it. */
  kindLabel: string;
  /** This mind's grant: absent means none was ever made. */
  state: "active" | "stale" | "revoked" | "absent";
  /** The source itself needs attention (a connected source only). */
  sourceNeedsAttention: boolean;
  /** Repository work beside recall (a connected repository only). */
  workReady: boolean | null;
  /** A stale file grant can be reconfirmed only when the store says so. */
  canReconfirm: boolean;
  /** Where a file grant's model runs (an imported file only). */
  egress: OwnerBrainGrant["providerEgress"] | null;
};

const KIND_LABELS: Record<ConnectedBrainSourceKind, string> = {
  repository: "Repository",
  codex_history: "Codex",
  claude_history: "Claude Code",
};

const same = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

/**
 * What one mind may read, source by source: every connected source with this
 * mind's recall grant (and, for a repository, its work grant), then every
 * imported file with this mind's grant. The same records Brain's details
 * read for each resident (BrainConnectedDetails, BrainAccessPanel).
 */
export function mindBrainAccess(
  inventory:
    | Pick<
        ConnectedBrainInventory,
        "sources" | "recallGrants" | "repositoryGrants"
      >
    | undefined,
  files: { sources: OwnerBrainSource[]; grants: OwnerBrainGrant[] } | undefined,
  residentPubkey: string,
): MindSourceAccess[] {
  const connected = (inventory?.sources ?? [])
    .filter((source) => source.status !== "disconnected")
    .map((source): MindSourceAccess => {
      const recall = inventory?.recallGrants.find(
        (grant) =>
          grant.sourceId === source.sourceId &&
          same(grant.residentPubkey, residentPubkey),
      );
      const work = inventory?.repositoryGrants.find(
        (grant) =>
          grant.sourceId === source.sourceId &&
          same(grant.residentPubkey, residentPubkey),
      );
      return {
        canReconfirm: recall?.canReconfirm ?? false,
        egress: null,
        kindLabel: KIND_LABELS[source.sourceKind],
        name: source.displayName,
        record: "connected",
        // Brain's details read a missing recall grant as excluded.
        state: recall?.state ?? "revoked",
        sourceId: source.sourceId,
        sourceNeedsAttention:
          source.status === "needs_attention" ||
          source.status === "unavailable",
        workReady:
          source.sourceKind === "repository" ? work?.state === "active" : null,
      };
    });
  const imported = (files?.sources ?? []).map((source): MindSourceAccess => {
    const grant = files?.grants.find(
      (each) =>
        each.sourceId === source.sourceId &&
        same(each.residentPubkey, residentPubkey),
    );
    return {
      canReconfirm: grant?.canReconfirm ?? false,
      egress: grant?.providerEgress ?? null,
      kindLabel: source.sourceKind === "text_folder" ? "Folder" : "File",
      name: source.displayName,
      record: "file",
      state: grant?.state ?? "absent",
      sourceId: source.sourceId,
      sourceNeedsAttention: false,
      workReady: null,
    };
  });
  return [...connected, ...imported];
}

/** Whether a mind reads everything Brain connects: some source, and every
 *  one of them with an active grant. */
export function readsEverything(rows: readonly MindSourceAccess[]): boolean {
  return rows.length > 0 && rows.every((row) => row.state === "active");
}

/** The quiet word for a mind's grant, as Brain's details say it. */
export function accessWord(row: MindSourceAccess): string {
  if (row.state === "active")
    return row.record === "file" ? "Active" : "Included";
  if (row.state === "stale")
    return row.record === "file" ? "Needs review" : "Review needed";
  if (row.state === "revoked")
    return row.record === "file" ? "Revoked" : "Excluded";
  return "No access";
}

/** The line under a source's name: its kind, then what the grant covers,
 *  in the words Brain's details use. */
export function accessDetail(row: MindSourceAccess): string {
  const covers =
    row.record === "file"
      ? row.egress
        ? `${row.egress === "local" ? "Local" : "Remote"} provider path`
        : "No source content can be retrieved"
      : row.sourceNeedsAttention
        ? "Resident access saved · source reconnect required"
        : row.workReady !== null
          ? `Recall and repository work · ${row.workReady ? "ready" : "review needed"}`
          : "Recall access";
  return `${row.kindLabel} · ${covers}`;
}
