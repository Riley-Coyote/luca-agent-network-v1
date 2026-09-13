import * as React from "react";
import { loadActiveCommunityId } from "@/features/communities/communityStorage";
import type { QuickChatEffort } from "@/features/quickchat/types";
import { getQuickChatEffort } from "@/shared/api/tauriQuickChat";

export type ConversationEffortSelection = {
  residentPubkey: string;
  configId: string;
  value: string;
};
type Choice = Omit<ConversationEffortSelection, "residentPubkey"> & {
  position: number;
};
type Result = ConversationEffortSelection & {
  conversationId: string;
  eventId: string;
  status: "applied" | "failed";
};
type Receipt = ConversationEffortSelection & {
  eventId: string;
  status: "pending" | "applied" | "failed" | "unconfirmed";
};
type Preferences = { selected: string | null; choices: Record<string, Choice> };
const EMPTY: Preferences = { selected: null, choices: {} };
const WAITING: QuickChatEffort = {
  supported: false,
  values: [],
  value: null,
  pending: false,
  awaitingFirstReply: true,
  reason: "Available after the first reply",
};

function readPreferences(key: string): Preferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
    const choices: Record<string, Choice> = {};
    for (const [pubkey, raw] of Object.entries(parsed?.choices ?? {}).slice(
      0,
      32,
    )) {
      const value = raw as Choice;
      if (
        /^[a-f0-9]{64}$/.test(pubkey) &&
        typeof value?.configId === "string" &&
        typeof value.value === "string" &&
        Number.isFinite(value.position)
      ) {
        choices[pubkey] = {
          ...value,
          position: Math.max(0, Math.min(3, value.position)),
        };
      }
    }
    return {
      selected: typeof parsed?.selected === "string" ? parsed.selected : null,
      choices,
    };
  } catch {
    return EMPTY;
  }
}

/** Conversation-local effort choices; only the runtime can acknowledge application. */
export function useConversationEffort({
  ownerPubkey,
  conversationId,
  residents,
}: {
  ownerPubkey?: string | null;
  conversationId: string | null;
  residents: Array<{ pubkey: string; name: string }>;
}) {
  const scope = JSON.stringify([
    ownerPubkey,
    loadActiveCommunityId(),
    conversationId,
  ]);
  const storageKey = `luca.conversation-effort.v1:${scope}`;
  const [saved, setSaved] = React.useState(() => ({
    scope,
    value: readPreferences(storageKey),
  }));
  const preferences = React.useMemo(
    () => (saved.scope === scope ? saved.value : readPreferences(storageKey)),
    [saved, scope, storageKey],
  );
  const [reports, setReports] = React.useState<{
    scope: string;
    values: Record<string, QuickChatEffort>;
  }>({ scope, values: {} });
  const [receipts, setReceipts] = React.useState<{
    scope: string;
    values: Record<string, Receipt>;
  }>({ scope, values: {} });
  const [drag, setDrag] = React.useState<{
    key: string;
    position: number;
  } | null>(null);
  const dragRef = React.useRef(drag);
  const liveScope = React.useRef(scope);
  liveScope.current = scope;
  const buffered = React.useRef<{ scope: string; results: Result[] }>({
    scope,
    results: [],
  });
  if (buffered.current.scope !== scope)
    buffered.current = { scope, results: [] };
  const memberKey = residents
    .map((resident) => resident.pubkey)
    .sort()
    .join(",");
  const selectedPubkey = residents.some(
    (resident) => resident.pubkey === preferences.selected,
  )
    ? preferences.selected
    : (residents[0]?.pubkey ?? null);
  const update = (change: (value: Preferences) => Preferences) => {
    const next = change(preferences);
    setSaved({ scope, value: next });
    if (ownerPubkey && conversationId) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* In-memory choice remains usable. */
      }
    }
  };
  React.useEffect(() => {
    let active = true;
    const members = memberKey ? memberKey.split(",") : [];
    if (!ownerPubkey || !conversationId || !members.length) return;
    const refresh = (pubkey: string) => {
      void getQuickChatEffort(conversationId, pubkey)
        .then((value) => {
          if (active && liveScope.current === scope)
            setReports((old) => ({
              scope,
              values: {
                ...(old.scope === scope ? old.values : {}),
                [pubkey]: value,
              },
            }));
        })
        .catch(() => {
          if (active && liveScope.current === scope)
            setReports((old) => ({
              scope,
              values: {
                ...(old.scope === scope ? old.values : {}),
                [pubkey]: {
                  ...WAITING,
                  reason:
                    "Could not check runtime settings. Reopen this conversation to retry.",
                },
              },
            }));
        });
    };
    for (const pubkey of members) refresh(pubkey);
    const onCapabilities = (event: Event) => {
      const detail = (
        event as CustomEvent<{ conversationId: string; residentPubkey: string }>
      ).detail;
      if (
        detail?.conversationId === conversationId &&
        members.includes(detail.residentPubkey)
      )
        refresh(detail.residentPubkey);
    };
    window.addEventListener("quickchat-effort-capabilities", onCapabilities);
    return () => {
      active = false;
      window.removeEventListener(
        "quickchat-effort-capabilities",
        onCapabilities,
      );
    };
  }, [scope, ownerPubkey, conversationId, memberKey]);

  React.useEffect(() => {
    const receive = (event: Event) => {
      const result = (event as CustomEvent<Result>).detail;
      if (
        !result ||
        result.conversationId !== conversationId ||
        !result.eventId ||
        !memberKey.split(",").includes(result.residentPubkey) ||
        (result.status !== "applied" && result.status !== "failed")
      )
        return;
      buffered.current.results = [
        ...buffered.current.results.slice(-31),
        result,
      ];
      setReceipts((old) => {
        const pending =
          old.scope === scope ? old.values[result.residentPubkey] : undefined;
        if (
          !pending ||
          pending.eventId !== result.eventId ||
          pending.configId !== result.configId ||
          pending.value !== result.value
        )
          return old;
        return {
          scope,
          values: {
            ...old.values,
            [result.residentPubkey]: { ...pending, status: result.status },
          },
        };
      });
    };
    window.addEventListener("quickchat-effort-result", receive);
    return () => window.removeEventListener("quickchat-effort-result", receive);
  }, [scope, conversationId, memberKey]);
  React.useEffect(() => {
    if (
      receipts.scope !== scope ||
      !Object.values(receipts.values).some(
        (receipt) => receipt.status === "pending",
      )
    )
      return;
    const timer = window.setTimeout(
      () =>
        setReceipts((old) =>
          old.scope !== scope
            ? old
            : {
                scope,
                values: Object.fromEntries(
                  Object.entries(old.values).map(([pubkey, receipt]) => [
                    pubkey,
                    receipt.status === "pending"
                      ? { ...receipt, status: "unconfirmed" }
                      : receipt,
                  ]),
                ),
              },
        ),
      30000,
    );
    return () => clearTimeout(timer);
  }, [receipts, scope]);

  const report =
    (selectedPubkey && reports.scope === scope
      ? reports.values[selectedPubkey]
      : null) ?? WAITING;
  const choice = selectedPubkey
    ? preferences.choices[selectedPubkey]
    : undefined;
  const validChoice =
    choice &&
    report.supported &&
    report.configId === choice.configId &&
    report.values.some((option) => option.value === choice.value)
      ? choice
      : undefined;
  const value = validChoice?.value ?? report.value;
  const index = report.values.findIndex((option) => option.value === value);
  const positionKey = `${scope}:${selectedPubkey}:${report.configId}:${report.values.map((option) => option.value).join(",")}`;
  const effortPosition =
    drag?.key === positionKey
      ? drag.position
      : (validChoice?.position ??
        (index >= 0 && report.values.length > 1
          ? (3 * index) / (report.values.length - 1)
          : 0));
  const receipt =
    selectedPubkey && receipts.scope === scope
      ? receipts.values[selectedPubkey]
      : undefined;
  const matchingReceipt =
    receipt?.configId === report.configId && receipt?.value === value
      ? receipt
      : undefined;
  const reason =
    matchingReceipt?.status === "pending"
      ? "Waiting for runtime confirmation"
      : matchingReceipt?.status === "applied"
        ? "Applied by runtime"
        : matchingReceipt?.status === "failed"
          ? "Runtime could not apply this level"
          : matchingReceipt?.status === "unconfirmed"
            ? "Runtime has not confirmed this level"
            : validChoice
              ? "Selected for next message"
              : choice && report.supported
                ? "Previous selection is unavailable; using runtime setting"
                : report.reason;
  return {
    selectedPubkey,
    selectResident: (pubkey: string) => {
      if (residents.some((resident) => resident.pubkey === pubkey))
        update((old) => ({ ...old, selected: pubkey }));
    },
    effort: { ...report, value, pending: false, reason },
    effortPosition,
    setEffortPosition: (position: number) => {
      const next = {
        key: positionKey,
        position: Math.max(0, Math.min(3, position)),
      };
      dragRef.current = next;
      setDrag(next);
    },
    setEffort: (next: string) => {
      if (
        !selectedPubkey ||
        !report.configId ||
        !report.supported ||
        !report.values.some((option) => option.value === next)
      )
        return;
      update((old) => ({
        ...old,
        choices: {
          ...old.choices,
          [selectedPubkey]: {
            configId: report.configId as string,
            value: next,
            position:
              dragRef.current?.key === positionKey
                ? dragRef.current.position
                : effortPosition,
          },
        },
      }));
      setReceipts((old) => ({
        scope,
        values: Object.fromEntries(
          Object.entries(old.scope === scope ? old.values : {}).filter(
            ([pubkey]) => pubkey !== selectedPubkey,
          ),
        ),
      }));
    },
    captureSelections: (): ConversationEffortSelection[] =>
      residents.flatMap(({ pubkey }) => {
        const savedChoice = preferences.choices[pubkey];
        const capability =
          reports.scope === scope ? reports.values[pubkey] : undefined;
        return savedChoice &&
          capability?.supported &&
          capability.configId === savedChoice.configId &&
          capability.values.some((option) => option.value === savedChoice.value)
          ? [
              {
                residentPubkey: pubkey,
                configId: savedChoice.configId,
                value: savedChoice.value,
              },
            ]
          : [];
      }),
    recordSent: (eventId: string, choices: ConversationEffortSelection[]) => {
      if (liveScope.current !== scope) return;
      setReceipts((old) => {
        const values = { ...(old.scope === scope ? old.values : {}) };
        for (const choice of choices) {
          const result = buffered.current.results.find(
            (result) =>
              result.eventId === eventId &&
              result.residentPubkey === choice.residentPubkey &&
              result.configId === choice.configId &&
              result.value === choice.value,
          );
          values[choice.residentPubkey] = {
            ...choice,
            eventId,
            status: result?.status ?? "pending",
          };
        }
        return { scope, values };
      });
    },
  };
}
