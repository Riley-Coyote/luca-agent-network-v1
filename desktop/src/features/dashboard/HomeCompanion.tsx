import * as React from "react";
import { ArrowUpRight, MessageCircle, X } from "lucide-react";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useConversationPresentation } from "@/features/channels/ui/useConversationPresentation";
import { useResidentStopControl } from "@/features/channels/ui/useResidentStopControl";
import {
  useChannelMessagesQuery,
  useChannelSubscription,
  useSendMessageMutation,
} from "@/features/messages/hooks";
import { useManagedPresentations } from "@/features/messages/managedPresentationHooks";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { useRelaySelfQuery } from "@/features/moderation/hooks";
import { projectQuickChatMessages } from "@/features/quickchat/messages";
import { Markdown } from "@/shared/ui/markdown";
import { dashboardContextText } from "./dashboardModel";
import type { useCompanionHome } from "./useCompanionHome";

export type HomeContext = {
  title: string;
  runtimeFamily: "claude_code" | "codex";
  taskId?: string;
  sessionId?: string;
};
export function useHomeConversation(
  companion: ReturnType<typeof useCompanionHome>,
  open: boolean,
) {
  const channel = open ? companion.channel : null;
  const history = useChannelMessagesQuery(channel);
  useChannelSubscription(channel, { markVisible: false });
  const streams = useManagedPresentations(channel?.id ?? null);
  const relay = useRelaySelfQuery(channel !== null).data;
  const agents = useManagedAgentsQuery();
  const keys = React.useMemo(
    () => new Set((agents.data ?? []).map((agent) => agent.pubkey)),
    [agents.data],
  );
  const send = useSendMessageMutation(
    companion.channel,
    companion.identity,
    keys,
  );
  const [error, setError] = React.useState("");
  const lock = React.useRef(false);
  const presentation = useConversationPresentation(channel?.id ?? null);
  const control = useResidentStopControl({
    channelId: channel?.id ?? null,
    presentationActivity: presentation.managedActivity,
  });
  const activity = companion.residentPubkey
    ? presentation.managedActivity.get(companion.residentPubkey)
    : null;
  const working = Boolean(
    activity &&
      !activity.settled &&
      !["failed", "cancelled", "completed"].includes(activity.phase),
  );
  const messages = React.useMemo(
    () =>
      projectQuickChatMessages(
        history.data ?? [],
        streams,
        channel,
        companion.identity?.pubkey ?? "",
        companion.residentPubkey,
        relay,
        companion.residentPubkey,
      ),
    [
      history.data,
      streams,
      channel,
      companion.identity?.pubkey,
      companion.residentPubkey,
      relay,
    ],
  );
  async function sendMessage(
    content: string,
    mentions: string[],
    mediaTags?: string[][],
    context?: HomeContext | null,
  ) {
    if (lock.current) throw new Error("Your message is already being sent.");
    lock.current = true;
    setError("");
    try {
      const targetChannel = await companion.ensureChannel();
      await send.mutateAsync({
        targetChannel,
        channelId: targetChannel.id,
        content: context
          ? `${content}\n\n${dashboardContextText(context)}`
          : content,
        mentionPubkeys: mentions,
        explicitMentionPubkeys: mentions,
        mediaTags,
        managedAudience: {
          mode: "directed",
          resident_pubkeys: [companion.residentPubkey ?? ""],
        },
      });
    } catch (cause) {
      const text =
        cause instanceof Error
          ? cause.message
          : "Your message could not be sent. Your draft is kept.";
      setError(text);
      throw cause;
    } finally {
      lock.current = false;
    }
  }
  return {
    messages,
    working,
    error,
    historyError: history.isError,
    sending: send.isPending,
    sendMessage,
    stop: () =>
      companion.residentPubkey
        ? control.stopResidents([companion.residentPubkey])
        : Promise.resolve(),
  };
}

/** A second view of the canonical DM, backed by the same events, drafts and Stop authority. */
export function HomeCompanion({
  companion,
  conversation,
  open,
  setOpen,
  context,
  clearContext,
}: {
  companion: ReturnType<typeof useCompanionHome>;
  conversation: ReturnType<typeof useHomeConversation>;
  open: boolean;
  setOpen: (next: boolean) => void;
  context: HomeContext | null;
  clearContext: () => void;
}) {
  const scroll = React.useRef<HTMLDivElement>(null);
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const nearEnd = React.useRef(true);
  const [navigationError, setNavigationError] = React.useState("");
  const { goChannel, goAgents } = useAppNavigation();
  const last = conversation.messages.at(-1);
  React.useLayoutEffect(() => {
    if (!open || !last?.id || last.text === undefined) return;
    const node = scroll.current;
    if (node && nearEnd.current) node.scrollTop = node.scrollHeight;
  }, [open, last?.text, last?.id]);
  const composer = (
    <div className="pf-dash-composer pf-home-composer">
      {context ? (
        <div className="pf-home-context-chip">
          <span>{context.title}</span>
          <button
            type="button"
            aria-label="Remove selected work context"
            onClick={clearContext}
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
      <MessageComposer
        channelId={companion.channel?.id ?? null}
        channelName="Luca"
        channelType="dm"
        draftKey={`dashboard:${companion.scope}:luca`}
        disabled={!companion.ready || !present}
        isSending={conversation.sending}
        showTopBorder={false}
        placeholder={
          context
            ? "Ask Luca about this work…"
            : "Ask Luca to handle something…"
        }
        onSend={async (content, mentions, tags) => {
          setOpen(true);
          await conversation.sendMessage(content, mentions, tags, context);
          clearContext();
        }}
      />
      {conversation.error ? (
        <p className="pf-home-card-error" role="alert">
          {conversation.error}
        </p>
      ) : null}
    </div>
  );
  if (!open)
    return (
      <div className="pf-home-dock">
        <div className="pf-home-dock-heading">
          <span>Luca</span>
          <button type="button" onClick={() => setOpen(true)}>
            Open conversation <ArrowUpRight size={13} />
          </button>
        </div>
        {composer}
      </div>
    );
  return (
    <motion.aside
      className="pf-home-luca"
      aria-label="Luca conversation"
      inert={!present}
      aria-hidden={!present || undefined}
      initial={{ opacity: 0, width: reduced ? 340 : 0 }}
      animate={{ opacity: 1, width: 340 }}
      exit={{ opacity: 0, width: reduced ? 340 : 0 }}
      transition={{ duration: reduced ? 0 : 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="pf-home-luca-inner">
        <header>
          <div>
            <MessageCircle size={16} />
            <span>
              Luca<small>Your existing conversation</small>
            </span>
          </div>
          <button
            type="button"
            className="pf-home-icon-button"
            aria-label="Close Luca conversation"
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </button>
        </header>
        <div
          className="pf-home-luca-messages"
          ref={scroll}
          onScroll={() => {
            const node = scroll.current;
            if (node)
              nearEnd.current =
                node.scrollHeight - node.scrollTop - node.clientHeight < 64;
          }}
        >
          {!companion.ready ? (
            <div className="pf-home-luca-intro">
              <p>Set up your companion to start a conversation.</p>
              <button type="button" onClick={() => void goAgents()}>
                Open Agents <ArrowUpRight size={13} />
              </button>
            </div>
          ) : null}
          {conversation.historyError ? (
            <p role="alert" className="pf-home-card-error">
              Conversation history could not be loaded. Open the conversation to
              retry.
            </p>
          ) : null}
          {conversation.messages.map((message) => (
            <article
              key={message.id}
              className="pf-home-chat-turn"
              data-role={message.role === "owner" ? "You" : "Luca"}
            >
              <span>{message.role === "owner" ? "You" : "Luca"}</span>
              <Markdown content={message.text} />
            </article>
          ))}
          {conversation.working ? (
            <div className="pf-home-chat-working" role="status">
              <span className="pf-home-working-dot" />
              Luca is working{" "}
              <button type="button" onClick={() => void conversation.stop()}>
                Stop
              </button>
            </div>
          ) : null}
        </div>
        <div className="pf-home-luca-foot">
          {composer}
          <button
            type="button"
            className="pf-home-text-button"
            disabled={!companion.ready}
            onClick={() => {
              setNavigationError("");
              void companion
                .ensureChannel()
                .then((channel) => goChannel(channel.id))
                .catch(() =>
                  setNavigationError(
                    "The conversation could not be opened. Try again.",
                  ),
                );
            }}
          >
            Open full conversation <ArrowUpRight size={13} />
          </button>
          {navigationError ? (
            <p className="pf-home-card-error" role="alert">
              {navigationError}
            </p>
          ) : null}
        </div>
      </div>
    </motion.aside>
  );
}
