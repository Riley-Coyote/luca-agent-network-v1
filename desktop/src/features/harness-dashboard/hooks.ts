import * as React from "react";
import { useQuery } from "@tanstack/react-query";

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
  const sessionId = session?.sessionId ?? null;
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
  return useHarnessSnapshot<HarnessSessionDetail>({
    enabled:
      visible &&
      Boolean(sourceId && sessionId && conversationId && residentPubkey),
    load,
    key,
    revision,
  });
}
