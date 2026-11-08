import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getHarnessSession,
  listHarnessSessions,
  type HarnessRuntimeFamily,
  type HarnessSession,
  type HarnessSessionDetail,
  type HarnessSessionList,
} from "@/shared/api/tauriHarnessDashboard";
import { listRuntimeConnectionStatus } from "@/shared/api/tauriMcp";
import { invokeTauri } from "@/shared/api/tauri";
import { listenRuntimeTasks } from "@/shared/api/tauriRuntimeTasks";
import {
  createHarnessRequestGate,
  harnessSnapshotForKey,
  type HarnessSnapshot,
} from "./requestGuard";

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "This local information could not be read. Refresh to try again.";
}

/** Only the selected send-capable native transcript receives a short refresh. */
export function harnessTranscriptRefreshInterval(
  enabled: boolean,
  canSend: boolean,
): number | false {
  return enabled && canSend ? 4_000 : false;
}

/** Catalogue handles are checked slowly, and only for a visible authorized scope. */
export function harnessCatalogueRefreshInterval(
  visible: boolean,
  hasScope: boolean,
): number | false {
  return visible && hasScope ? 240_000 : false;
}

/** A renewed handle may retain text only for the same exact scoped native identity. */
export function harnessTranscriptPlaceholder<T>(
  previous: T | undefined,
  previousIdentity: unknown,
  identity: string,
): T | undefined {
  return previousIdentity === identity ? previous : undefined;
}

/** Repeated transcript failures may reacquire metadata no more than once a minute. */
export function createHarnessCatalogueRenewalGate() {
  let nextAllowed = Number.NEGATIVE_INFINITY;
  return (now = Date.now()) => {
    if (now < nextAllowed) return false;
    nextAllowed = now + 60_000;
    return true;
  };
}

/** Bounded reads only: effects, native events, explicit refresh and window focus. */
export function useHarnessSnapshot<T>({
  enabled,
  load,
  key,
  revision,
}: {
  enabled: boolean;
  load: () => Promise<T>;
  key: string;
  revision: number | string;
}): HarnessSnapshot<T> {
  const [snapshot, setSnapshot] = React.useState<HarnessSnapshot<T>>({
    key,
    value: null,
    loading: enabled,
    error: null,
  });
  React.useEffect(() => {
    if (!enabled) return;
    const gate = createHarnessRequestGate();
    const current = gate.begin(JSON.stringify([key, revision]));
    setSnapshot((previous) => ({
      key,
      value: previous.key === key ? previous.value : null,
      error: null,
      loading: true,
    }));
    void load().then(
      (value) => {
        if (current()) setSnapshot({ key, value, loading: false, error: null });
      },
      (error: unknown) => {
        if (current())
          setSnapshot((previous) => ({
            key,
            value: previous.key === key ? previous.value : null,
            loading: false,
            error: errorMessage(error),
          }));
      },
    );
    return () => gate.dispose();
  }, [enabled, key, load, revision]);
  const scoped = harnessSnapshotForKey(snapshot, key);
  return enabled ? scoped : { ...scoped, loading: false };
}

/** Native events while hidden do not trigger transcript or filesystem reads. */
function useHarnessRefresh(runtimeFamily: HarnessRuntimeFamily) {
  const [visible, setVisible] = React.useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const [revision, bump] = React.useReducer((value: number) => value + 1, 0);
  const refresh = React.useCallback(() => {
    if (!document.hidden) bump();
  }, []);
  React.useEffect(() => {
    const visibility = () => {
      setVisible(!document.hidden);
      if (!document.hidden) bump();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", refresh);
    let active = true;
    let stop: (() => void) | undefined;
    void listenRuntimeTasks((task) => {
      if (task.runtimeFamily === runtimeFamily) refresh();
    })
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch(() => {
        // Focus and manual refresh remain available when native events are absent.
      });
    return () => {
      active = false;
      stop?.();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, runtimeFamily]);
  return { visible, revision, refresh };
}

export function useHarnessWorkspaceData({
  runtimeFamily,
  conversationId,
  residentPubkey,
  ownerScope = "",
}: {
  runtimeFamily: HarnessRuntimeFamily;
  conversationId: string | null;
  residentPubkey: string | null;
  ownerScope?: string;
}) {
  const refreshState = useHarnessRefresh(runtimeFamily);
  const scopeKey = JSON.stringify([
    ownerScope,
    runtimeFamily,
    conversationId,
    residentPubkey,
  ]);
  const loadSessions = React.useCallback(
    () =>
      conversationId && residentPubkey
        ? listHarnessSessions(runtimeFamily, conversationId, residentPubkey)
        : Promise.reject(
            new Error(
              "Open Luca’s conversation before reading native sessions.",
            ),
          ),
    [runtimeFamily, conversationId, residentPubkey],
  );
  const catalogueQuery = useQuery<HarnessSessionList>({
    enabled: refreshState.visible && Boolean(conversationId && residentPubkey),
    queryFn: loadSessions,
    queryKey: [
      "harness-sessions",
      runtimeFamily,
      conversationId,
      residentPubkey,
      ownerScope,
    ],
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchInterval: harnessCatalogueRefreshInterval(
      refreshState.visible,
      Boolean(conversationId && residentPubkey),
    ),
    refetchIntervalInBackground: false,
  });
  const refetchCatalogue = catalogueQuery.refetch;
  React.useEffect(() => {
    if (
      refreshState.revision &&
      refreshState.visible &&
      conversationId &&
      residentPubkey
    ) {
      void refetchCatalogue({ cancelRefetch: false });
    }
  }, [
    refreshState.revision,
    refreshState.visible,
    conversationId,
    residentPubkey,
    refetchCatalogue,
  ]);
  const catalogue: HarnessSnapshot<HarnessSessionList> = {
    key: `catalogue:${scopeKey}`,
    value: catalogueQuery.data ?? null,
    loading: catalogueQuery.isFetching,
    error: catalogueQuery.error ? errorMessage(catalogueQuery.error) : null,
  };
  const connections = useHarnessSnapshot({
    enabled: refreshState.visible,
    load: listRuntimeConnectionStatus,
    key: `harness-runtime-connections:${ownerScope}`,
    revision: refreshState.revision,
  });
  const loadApi = React.useCallback(
    () => invokeTauri<{ connected: boolean }>("get_claude_api_connection"),
    [],
  );
  const api = useHarnessSnapshot({
    enabled: refreshState.visible && runtimeFamily === "claude_code",
    load: loadApi,
    key: `harness-claude-api-status:${ownerScope}`,
    revision: refreshState.revision,
  });
  return { ...refreshState, scopeKey, catalogue, connections, api };
}

/** Only the explicitly selected session is read; changing selection gates late data. */
export function useHarnessTranscript({
  runtimeFamily,
  conversationId,
  residentPubkey,
  sourceId,
  session,
  visible,
  revision,
  ownerScope = "",
}: {
  runtimeFamily: HarnessRuntimeFamily;
  conversationId: string | null;
  residentPubkey: string | null;
  sourceId: string | null;
  session: HarnessSession | null;
  visible: boolean;
  revision: number;
  ownerScope?: string;
}) {
  const queryClient = useQueryClient();
  const sessionId = session?.sessionId ?? null;
  const identity = JSON.stringify([
    ownerScope,
    runtimeFamily,
    conversationId,
    residentPubkey,
    session?.selectionKey ?? null,
  ]);
  const key = JSON.stringify([
    ownerScope,
    runtimeFamily,
    conversationId,
    residentPubkey,
    sourceId,
    sessionId,
  ]);
  const load = React.useCallback(() => {
    if (!sourceId || !sessionId || !conversationId || !residentPubkey) {
      return Promise.reject(
        new Error("Refresh and select this session again."),
      );
    }
    return getHarnessSession({
      runtimeFamily,
      sourceId,
      sessionId,
      conversationId,
      residentPubkey,
    });
  }, [runtimeFamily, conversationId, residentPubkey, sourceId, sessionId]);
  const enabled =
    visible &&
    Boolean(
      sourceId &&
        sessionId &&
        session?.selectionKey &&
        conversationId &&
        residentPubkey,
    );
  const query = useQuery<HarnessSessionDetail>({
    queryKey: ["harness-transcript", identity, sourceId, sessionId],
    queryFn: load,
    enabled,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: harnessTranscriptRefreshInterval(
      enabled,
      session?.canSend === true,
    ),
    refetchIntervalInBackground: false,
    placeholderData: (previous, previousQuery) =>
      harnessTranscriptPlaceholder(
        previous,
        previousQuery?.queryKey[1],
        identity,
      ),
  });
  const refetch = query.refetch;
  React.useEffect(() => {
    if (enabled && revision) void refetch({ cancelRefetch: false });
  }, [enabled, revision, refetch]);
  const allowRenewal = React.useRef(createHarnessCatalogueRenewalGate());
  const errorUpdatedAt = query.errorUpdatedAt;
  const hasReadError = query.isError;
  React.useEffect(() => {
    if (!enabled || !hasReadError || !errorUpdatedAt || !allowRenewal.current())
      return;
    // Reacquire this exact owner's catalogue after expiry or a native routing
    // change. This does not fan out into connections, billing or other sessions.
    void queryClient.invalidateQueries(
      {
        queryKey: [
          "harness-sessions",
          runtimeFamily,
          conversationId,
          residentPubkey,
          ownerScope,
        ],
        exact: true,
        refetchType: "active",
      },
      { cancelRefetch: false },
    );
  }, [
    enabled,
    hasReadError,
    errorUpdatedAt,
    queryClient,
    runtimeFamily,
    conversationId,
    residentPubkey,
    ownerScope,
  ]);
  return {
    key,
    value: query.data ?? null,
    loading: query.isFetching,
    error: query.error ? errorMessage(query.error) : null,
  } satisfies HarnessSnapshot<HarnessSessionDetail>;
}
