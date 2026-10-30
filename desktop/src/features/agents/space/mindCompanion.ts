import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  companionState,
  type CompanionGrant,
  type ProfileKind,
} from "@/shared/api/companion";

export type CompanionLoaded = Awaited<ReturnType<typeof companionState>>;

export const mindCompanionKey = (pubkey: string) =>
  ["mind-companion", pubkey.toLowerCase()] as const;

/** What a companion follows and may do on its own (today's companion
 *  settings, `companionState`), read once for their page and Settings. */
export function useMindCompanion(pubkey: string | null) {
  return useQuery({
    enabled: Boolean(pubkey),
    queryFn: () => companionState(pubkey as string),
    queryKey: mindCompanionKey(pubkey ?? ""),
    retry: false,
    staleTime: 5_000,
  });
}

/** A companion change, then the state read again; its error in words. */
export function useCompanionOperate(pubkey: string | null) {
  const client = useQueryClient();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const operate = React.useCallback(
    async (
      action: (resident: string, data: CompanionLoaded) => Promise<unknown>,
    ) => {
      if (!pubkey || pending) return;
      const data = client.getQueryData<CompanionLoaded>(
        mindCompanionKey(pubkey),
      );
      if (!data) return;
      setPending(true);
      setError(null);
      try {
        await action(pubkey, data);
      } catch (cause) {
        setError(
          typeof cause === "string"
            ? cause
            : cause instanceof Error
              ? cause.message
              : "Could not update this choice. Refresh and try again.",
        );
      } finally {
        setPending(false);
        await client.invalidateQueries({ queryKey: mindCompanionKey(pubkey) });
      }
    },
    [client, pending, pubkey],
  );
  return { error, operate, pending };
}

export const PROFILE_WORDS: Record<ProfileKind, string> = {
  codex_sessions: "Codex",
  claude_projects: "Claude Code",
};

/** The grant on one kind of work, if it has been followed. */
export function grantOf(
  loaded: CompanionLoaded | undefined,
  kind: ProfileKind,
): CompanionGrant | null {
  if (!loaded) return null;
  const ids = loaded.selections
    .filter((selection) => selection.kind === kind)
    .map((selection) => selection.sourceId);
  return (
    loaded.awareness.grants.find((grant) =>
      ids.includes(grant.source.source_id),
    ) ?? null
  );
}

/** Observing now: the grant is active and observation chosen. */
export function isFollowing(grant: CompanionGrant | null): boolean {
  return Boolean(
    grant && grant.grant.state === "active" && grant.grant.choices.observe,
  );
}

/** The work they follow, by name ("Codex", "Claude Code"). */
export function followedWork(loaded: CompanionLoaded | undefined): string[] {
  return (Object.keys(PROFILE_WORDS) as ProfileKind[])
    .filter((kind) => isFollowing(grantOf(loaded, kind)))
    .map((kind) => PROFILE_WORDS[kind]);
}

/** Noticing: some source is observed, and collection isn't paused. */
export function isNoticing(loaded: CompanionLoaded | undefined): boolean {
  if (!loaded) return false;
  return (
    loaded.awareness.grants.some(isFollowing) &&
    !loaded.awareness.paused &&
    loaded.awareness.collectionRunning
  );
}

/** Whether they have the companion's awareness at all. */
export function hasAwareness(loaded: CompanionLoaded | undefined): boolean {
  return loaded?.awareness.availability === "ready";
}

/** While you're away: background work on and not paused. */
export function awayOn(loaded: CompanionLoaded | undefined): boolean {
  return Boolean(
    loaded?.work.policy.enabled &&
      !loaded.work.policy.paused &&
      !loaded.work.executionPaused,
  );
}

/** "Codex and Claude Code", "Codex". */
export function namesAnd(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
