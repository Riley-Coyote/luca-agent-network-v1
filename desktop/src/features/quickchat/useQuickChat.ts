import { useRelaySelfQuery } from "@/features/moderation/hooks";
import { projectQuickChatMessages } from "./messages";
import * as React from "react";
import { useLocation } from "@tanstack/react-router";
import { useLucaResidentsQuery } from "@/features/luca/residents/hooks";
import { buildOutgoingMessage } from "@/features/messages/lib/imetaMediaMarkdown";
import {
  useManagedAgentsQuery,
  useAttachManagedAgentToChannelMutation,
} from "@/features/agents/hooks";
import {
  useChannelsQuery,
  useCreateChannelMutation,
} from "@/features/channels/hooks";
import { useConversationPresentation } from "@/features/channels/ui/useConversationPresentation";
import { useResidentStopControl } from "@/features/channels/ui/useResidentStopControl";
import { loadActiveCommunityId } from "@/features/communities/communityStorage";
import {
  useChannelMessagesQuery,
  useChannelSubscription,
  useSendMessageMutation,
} from "@/features/messages/hooks";
import { useManagedPresentations } from "@/features/messages/managedPresentationHooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { getChannelDetails, uploadMediaBytes } from "@/shared/api/tauri";
import {
  captureQuickChatWindow,
  getQuickChatEffort,
} from "@/shared/api/tauriQuickChat";
import { captureQuickChatContext } from "./context";
import {
  emptyQuickChat,
  emptyRoom,
  newQuickChat,
  prepareQuickChatRoom,
  quickChatStorageKey,
  readQuickChat,
  updateQuickChatRoom,
  type QuickChatState,
} from "./store";
import type {
  QuickChatViewModel,
  QuickChatImage,
  QuickChatEffort,
} from "./types";

const MANAGED_EFFORT: QuickChatEffort = {
  supported: false,
  values: [],
  value: null,
  pending: false,
  reason: "Thinking is managed by this resident’s runtime.",
};

export function useQuickChat({
  onOpenConversation,
  onOpenAgentSetup,
}: {
  onOpenConversation: (id: string) => void;
  onOpenAgentSetup: () => void;
}): QuickChatViewModel {
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const identity = useIdentityQuery();
  const registry = useLucaResidentsQuery();
  const location = useLocation();
  const agents = useManagedAgentsQuery();
  const channels = useChannelsQuery();
  const create = useCreateChannelMutation();
  const attach = useAttachManagedAgentToChannelMutation(null);
  const owner = identity.data?.pubkey ?? "";
  const scope = quickChatStorageKey(
    owner,
    loadActiveCommunityId() ?? "default",
  );
  const [stored, setStored] = React.useState<{
    scope: string;
    value: QuickChatState;
  }>(() => ({
    scope,
    value: owner ? readQuickChat(localStorage, scope) : emptyQuickChat(),
  }));
  const state =
    stored.scope === scope
      ? stored.value
      : owner
        ? readQuickChat(localStorage, scope)
        : emptyQuickChat();
  const stateRef = React.useRef({ scope, value: state });
  stateRef.current = { scope, value: state };
  const change = React.useCallback(
    (
      update: (current: QuickChatState) => QuickChatState,
      expectedScope = scope,
    ) => {
      if (!alive.current || stateRef.current.scope !== expectedScope) return;
      const value = update(stateRef.current.value);
      stateRef.current = { scope: expectedScope, value };
      setStored({ scope: expectedScope, value });
      if (owner) {
        try {
          localStorage.setItem(expectedScope, JSON.stringify(value));
        } catch {
          /* Keep the live draft if storage is full. */
        }
      }
    },
    [owner, scope],
  );
  const residents = (agents.data ?? []).map((agent) => ({
    pubkey: agent.pubkey,
    name: agent.name,
    detail: agent.status,
  }));
  const selectedPubkey = residents.some(
    (r) => r.pubkey === state.selectedPubkey,
  )
    ? state.selectedPubkey
    : (registry.data?.residents.find(
        (r) =>
          r.personaId === "persona:luca" &&
          residents.some((a) => a.pubkey === r.residentPubkey),
      )?.residentPubkey ??
      residents.find((r) => r.name.toLowerCase() === "luca")?.pubkey ??
      null);
  const selectedRef = React.useRef(selectedPubkey);
  selectedRef.current = selectedPubkey;
  const room = selectedPubkey
    ? (state.rooms[selectedPubkey] ?? emptyRoom())
    : emptyRoom();
  const channel = channels.data?.find((c) => c.id === room.channelId) ?? null;
  const history = useChannelMessagesQuery(channel);
  useChannelSubscription(channel, { markVisible: false });
  const streams = useManagedPresentations(channel?.id ?? null);
  const presentation = useConversationPresentation(channel?.id ?? null);
  const control = useResidentStopControl({
    channelId: channel?.id ?? null,
    presentationActivity: presentation.managedActivity,
  });
  const managedKeys = React.useMemo(
    () => new Set((agents.data ?? []).map((a) => a.pubkey)),
    [agents.data],
  );
  const sendMutation = useSendMessageMutation(
    channel,
    identity.data,
    managedKeys,
  );
  const [open, setOpen] = React.useState(false);
  const [contextEnabled, setContextEnabled] = React.useState(true);
  const [image, setImage] = React.useState<QuickChatImage | null>(null);
  const captureEpoch = React.useRef(0);
  const [capturing, setCapturing] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const sendLock = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const pendingEffort = React.useRef<{
    scope: string;
    conversationId: string;
    residentPubkey: string;
    eventId: string | null;
    configId: string;
    value: string;
    buffered: Event[];
  } | null>(null);
  const [capabilityVersion, refreshCapabilities] = React.useReducer(
    (value: number) => value + 1,
    0,
  );
  const [effort, setEffortState] = React.useState(MANAGED_EFFORT);
  const [context, setContext] = React.useState<ReturnType<
    typeof captureQuickChatContext
  > | null>(null);
  React.useEffect(() => {
    if (!location.href || !open || !contextEnabled) {
      setContext(null);
      return;
    }
    setContext(captureQuickChatContext());
  }, [open, contextEnabled, location.href]);
  React.useEffect(() => {
    if (scope) {
      setOpen(false);
      setImage(null);
      setError(null);
      setCapturing(false);
      setContextEnabled(true);
      pendingEffort.current = null;
    }
  }, [scope]);
  const active = [...presentation.managedActivity.values()].some(
    (a) =>
      !a.settled && !["failed", "stopped", "needs_attention"].includes(a.phase),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Switching conversation must discard transient capture and capability state.
  React.useEffect(() => {
    setError(null);
    setEffortState(MANAGED_EFFORT);
  }, [selectedPubkey, room.channelId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Invalidate in-flight images on resident/account switches.
  React.useLayoutEffect(() => {
    captureEpoch.current += 1;
    setImage(null);
    setCapturing(false);
  }, [scope, selectedPubkey]);
  React.useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (
        event as CustomEvent<{ residentPubkey: string; conversationId: string }>
      ).detail;
      if (
        detail?.residentPubkey === selectedPubkey &&
        detail.conversationId === room.channelId
      )
        refreshCapabilities();
    };
    window.addEventListener("quickchat-effort-capabilities", refresh);
    return () =>
      window.removeEventListener("quickchat-effort-capabilities", refresh);
  }, [selectedPubkey, room.channelId]);
  React.useEffect(() => {
    let current = true;
    const shouldRefresh = open || active || capabilityVersion > 0;
    if (shouldRefresh && room.channelId && selectedPubkey)
      void getQuickChatEffort(room.channelId, selectedPubkey)
        .then((value) => {
          if (!current) return;
          const saved =
            stateRef.current.value.rooms[selectedPubkey] ?? emptyRoom();
          const choice =
            value.supported && saved.effortChosen
              ? value.values[
                  Math.round(
                    (saved.effortPosition / 3) * (value.values.length - 1),
                  )
                ]?.value
              : value.value;
          if (
            value.supported &&
            !saved.effortChosen &&
            value.values.length > 1
          ) {
            const index = value.values.findIndex(
              (option) => option.value === value.value,
            );
            if (index >= 0)
              change((s) =>
                updateQuickChatRoom(s, selectedPubkey, {
                  effortPosition: (3 * index) / (value.values.length - 1),
                }),
              );
          }
          setEffortState((previous) => ({
            ...value,
            value: choice ?? value.value,
            pending: previous.pending,
            reason:
              previous.configId === value.configId &&
              previous.value === (choice ?? value.value)
                ? (previous.reason ?? value.reason)
                : value.reason,
          }));
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [selectedPubkey, room.channelId, open, active, change, capabilityVersion]);
  React.useEffect(() => {
    const receive = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          eventId: string;
          residentPubkey: string;
          conversationId: string;
          configId: string;
          value: string;
          status: string;
        }>
      ).detail;
      if (
        !detail ||
        detail.residentPubkey !== selectedPubkey ||
        detail.conversationId !== room.channelId
      )
        return;
      const pending = pendingEffort.current;
      if (
        !pending ||
        pending.scope !== scope ||
        pending.conversationId !== detail.conversationId ||
        pending.residentPubkey !== detail.residentPubkey ||
        pending.configId !== detail.configId ||
        pending.value !== detail.value ||
        (detail.status !== "applied" && detail.status !== "failed")
      )
        return;
      if (!pending.eventId) {
        pending.buffered = [...pending.buffered.slice(-3), event];
        return;
      }
      if (pending.eventId !== detail.eventId) return;
      pendingEffort.current = null;
      setEffortState((current) =>
        current.configId === detail.configId && current.value === detail.value
          ? {
              ...current,
              pending: false,
              reason:
                detail.status === "applied"
                  ? "Applied by runtime"
                  : "Runtime could not apply this level",
            }
          : { ...current, pending: false },
      );
      if (detail.status === "failed")
        setError(
          "The runtime could not apply the selected thinking level. Your message was not run with that setting.",
        );
    };
    window.addEventListener("quickchat-effort-result", receive);
    return () => window.removeEventListener("quickchat-effort-result", receive);
  }, [scope, selectedPubkey, room.channelId]);
  React.useEffect(() => {
    if (!effort.pending) return;
    const timer = window.setTimeout(() => {
      setEffortState((current) => ({
        ...current,
        pending: false,
        reason: "Runtime has not confirmed this level",
      }));
    }, 30000);
    return () => clearTimeout(timer);
  }, [effort.pending]);
  const relaySelfPubkey = useRelaySelfQuery(channel !== null).data;
  const messages = React.useMemo(
    () =>
      projectQuickChatMessages(
        history.data ?? [],
        streams,
        channel,
        owner,
        selectedPubkey,
        relaySelfPubkey,
      ),
    [history.data, streams, channel, owner, selectedPubkey, relaySelfPubkey],
  );
  const send = async () => {
    if (
      sendLock.current ||
      !selectedPubkey ||
      !owner ||
      (!room.draft.trim() && !image)
    )
      return;
    const agent = agents.data?.find((a) => a.pubkey === selectedPubkey);
    if (!agent) return;
    const targetPubkey = selectedPubkey;
    const capturedScope = scope;
    const capturedDraft = room.draft;
    const capturedImage = image;
    const capturedEffort =
      effort.supported && effort.configId && effort.value
        ? { configId: effort.configId, value: effort.value }
        : undefined;
    const capturedContext = contextEnabled
      ? captureQuickChatContext()
      : undefined;
    sendLock.current = true;
    setSending(true);
    setError(null);
    try {
      const id = await prepareQuickChatRoom(
        room,
        async () =>
          (
            await create.mutateAsync({
              name: `Quick Chat · ${agent.name}`,
              channelType: "stream",
              visibility: "private",
            })
          ).id,
        (id) => {
          if (!alive.current || stateRef.current.scope !== capturedScope)
            throw new Error("Quick Chat account changed.");
          return attach.mutateAsync({
            channelId: id,
            agent,
            role: "bot",
            ensureRunning: true,
          });
        },
        (patch) =>
          change(
            (s) => updateQuickChatRoom(s, targetPubkey, patch),
            capturedScope,
          ),
      );
      if (!alive.current || stateRef.current.scope !== capturedScope) return;
      const target = await getChannelDetails(id);
      if (!alive.current || stateRef.current.scope !== capturedScope) return;
      let outgoing = buildOutgoingMessage(capturedDraft, []);
      if (capturedImage) {
        const bytes = Uint8Array.from(
          atob(capturedImage.dataUrl.split(",")[1]),
          (c) => c.charCodeAt(0),
        );
        const uploaded = await uploadMediaBytes([...bytes], capturedImage.name);
        outgoing = buildOutgoingMessage(capturedDraft, [uploaded]);
      }
      if (!alive.current || stateRef.current.scope !== capturedScope) return;
      if (capturedEffort)
        pendingEffort.current = {
          scope: capturedScope,
          conversationId: id,
          residentPubkey: targetPubkey,
          eventId: null,
          configId: capturedEffort.configId,
          value: capturedEffort.value,
          buffered: [],
        };
      if (capturedEffort && selectedRef.current === targetPubkey)
        setEffortState((current) => ({
          ...current,
          value: capturedEffort.value,
          configId: capturedEffort.configId,
          pending: true,
        }));
      const sent = await sendMutation.mutateAsync({
        targetChannel: target,
        content: outgoing.content,
        mentionPubkeys: [targetPubkey],
        managedAudience: { mode: "directed", resident_pubkeys: [targetPubkey] },
        mediaTags: outgoing.mediaTags,
        quickChatContext: capturedContext,
        quickChatEffort: capturedEffort,
      });
      const pending = pendingEffort.current;
      if (
        pending &&
        pending.scope === capturedScope &&
        pending.conversationId === id
      ) {
        pending.eventId = sent.id;
        for (const event of pending.buffered)
          window.dispatchEvent(
            new CustomEvent("quickchat-effort-result", {
              detail: (event as CustomEvent).detail,
            }),
          );
        pending.buffered = [];
      }
      change(
        (s) =>
          s.rooms[targetPubkey]?.draft === capturedDraft
            ? updateQuickChatRoom(s, targetPubkey, { draft: "" })
            : s,
        capturedScope,
      );
      if (alive.current && stateRef.current.scope === capturedScope)
        setImage((current) => (current === capturedImage ? null : current));
    } catch (cause) {
      if (
        alive.current &&
        stateRef.current.scope === capturedScope &&
        selectedRef.current === targetPubkey
      )
        setEffortState((current) => ({ ...current, pending: false }));
      if (alive.current && stateRef.current.scope === capturedScope)
        setError(
          cause instanceof Error ? cause.message : "Could not send message.",
        );
    } finally {
      sendLock.current = false;
      if (alive.current) setSending(false);
    }
  };
  const renderedImageEpoch = captureEpoch.current;
  return {
    channelId: room.channelId,
    open,
    setOpen,
    residents,
    selectedPubkey,
    selectResident: (pubkey) =>
      change((s) => ({ ...s, selectedPubkey: pubkey })),
    messages,
    draft: room.draft,
    setDraft: (draft) => {
      if (selectedPubkey)
        change((s) => updateQuickChatRoom(s, selectedPubkey, { draft }));
    },
    busy: sending || active,
    error: error ?? (history.error ? history.error.message : null),
    send,
    stop: () => {
      if (effort.pending) {
        pendingEffort.current = null;
        setEffortState((current) => ({
          ...current,
          pending: false,
          reason: "Turn stopped before confirmation",
        }));
      }
      if (selectedPubkey) void control.stopResidents([selectedPubkey]);
    },
    newChat: () => {
      if (selectedPubkey && !sendLock.current) {
        captureEpoch.current += 1;
        setCapturing(false);
        change((s) => newQuickChat(s, selectedPubkey));
        setImage(null);
        setError(null);
      }
    },
    openFullConversation: () => {
      if (room.channelId) {
        onOpenConversation(room.channelId);
        setOpen(false);
      }
    },
    openAgentSetup: onOpenAgentSetup,
    contextEnabled,
    setContextEnabled,
    context,
    refreshContext: () =>
      setContext(contextEnabled ? captureQuickChatContext() : null),
    image,
    setImage: (value) => {
      if (
        !alive.current ||
        stateRef.current.scope !== scope ||
        selectedRef.current !== selectedPubkey ||
        captureEpoch.current !== renderedImageEpoch
      )
        return;
      captureEpoch.current += 1;
      setCapturing(false);
      setImage(value);
    },
    capturing,
    capture: async () => {
      const epoch = ++captureEpoch.current;
      setCapturing(true);
      setError(null);
      try {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const result = await captureQuickChatWindow();
        if (
          alive.current &&
          epoch === captureEpoch.current &&
          stateRef.current.scope === scope &&
          selectedRef.current === selectedPubkey
        )
          setImage(result);
      } catch (cause) {
        if (alive.current && epoch === captureEpoch.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not capture app window.",
          );
      } finally {
        if (alive.current && epoch === captureEpoch.current)
          setCapturing(false);
      }
    },
    effort,
    setEffort: (value) =>
      setEffortState((current) =>
        current.supported &&
        current.values.some((option) => option.value === value)
          ? { ...current, value }
          : current,
      ),
    effortPosition: room.effortPosition,
    setEffortPosition: (position) => {
      setEffortState((current) => {
        const option =
          current.values[
            Math.round(
              (Math.max(0, Math.min(3, position)) / 3) *
                (current.values.length - 1),
            )
          ];
        return current.supported && option
          ? {
              ...current,
              value: option.value,
              reason: "Selected for next message",
            }
          : current;
      });
      if (selectedPubkey)
        change((s) =>
          updateQuickChatRoom(s, selectedPubkey, {
            effortPosition: Math.max(0, Math.min(3, position)),
            effortChosen: true,
          }),
        );
    },
    width: state.width,
    height: state.height,
    setSize: (width, height) => change((s) => ({ ...s, width, height })),
    scrollTop: room.scrollTop,
    setScrollTop: (scrollTop) => {
      if (selectedPubkey)
        change((s) => updateQuickChatRoom(s, selectedPubkey, { scrollTop }));
    },
  };
}
