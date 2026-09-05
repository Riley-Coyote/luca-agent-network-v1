import { ArrowUp, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/shared/ui/button";

import { EditorContent } from "@tiptap/react";
import { useChannelLinks } from "@/features/messages/lib/useChannelLinks";
import { handleAgentSnapshotPaste } from "@/features/messages/lib/agentSnapshotClipboard";
import { useComposerAutofocus } from "@/features/messages/lib/useComposerAutofocus";
import type { ChannelSuggestion } from "@/features/messages/lib/useChannelLinks";
import {
  type DraftMentionRef,
  useDrafts,
} from "@/features/messages/lib/useDrafts";
import { resolveSentDraftKey } from "@/features/messages/ui/draftSubmitKey";
import { useEmojiAutocomplete } from "@/features/messages/lib/useEmojiAutocomplete";
import type { EmojiSuggestion } from "@/features/messages/lib/useEmojiAutocomplete";
import { useCustomEmoji } from "@/features/custom-emoji/hooks";
import { buildCustomEmojiTags } from "@/shared/lib/customEmojiTags";
import {
  buildOutgoingMessage,
  findSpoileredImetaMediaUrls,
  type ImetaMedia,
  mergeOutgoingTags,
  restoreImetaMediaDisplayLabels,
  stripImetaMediaLines,
} from "@/features/messages/lib/imetaMediaMarkdown";

import { useAttachmentEditing } from "@/features/messages/lib/useAttachmentEditing";
import {
  type MediaUploadController,
  useMediaUpload,
} from "@/features/messages/lib/useMediaUpload";
import { useAudioAttachmentRecorder } from "@/features/messages/lib/useAudioAttachmentRecorder";
import { sanitizedAttachmentFailure } from "@/features/messages/lib/managedOperationalStatus";
import { useMentions } from "@/features/messages/lib/useMentions";
import { diffAddedMentionPubkeys } from "@/features/messages/lib/threading";
import { getPersistentAgentAudienceScope } from "@/features/messages/lib/persistentAgentAudience";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import {
  hasMentionClipboardHtml,
  normalizeMentionClipboardHtml,
} from "@/features/messages/lib/normalizeMentionClipboard";
import { CUSTOM_EMOJI_NODE_NAME } from "@/features/messages/lib/customEmojiNode";
import {
  type AutocompleteEdit,
  type LinkSelectionInfo,
  useRichTextEditor,
} from "@/features/messages/lib/useRichTextEditor";
import { useLinkEditor } from "@/features/messages/lib/useLinkEditor";
import { useComposerSpoilerParticles } from "@/features/messages/lib/useComposerSpoilerParticles";
import { useTypingBroadcast } from "@/features/messages/useTypingBroadcast";
import {
  ConversationContextComposerSurface,
  type ConversationContextComposerConfig,
} from "@/features/luca/context/ConversationContextComposerSurface";
import { getBuzzCodeBlockClipboardText } from "@/shared/lib/codeBlockClipboard";
import { cn } from "@/shared/lib/cn";
import type { ChannelType } from "@/shared/api/types";
import { ChannelAutocomplete } from "./ChannelAutocomplete";
import { ComposerReplyEditBanner } from "./ComposerReplyEditBanner";
import { ComposerAttachments, DropZoneOverlay } from "./ComposerAttachments";
import { EmojiAutocomplete } from "./EmojiAutocomplete";
import {
  MentionAutocomplete,
  type MentionSuggestion,
} from "./MentionAutocomplete";
import { MessageComposerToolbar } from "./MessageComposerToolbar";
import { NonMemberMentionDialog } from "./NonMemberMentionDialog";
import { useMentionSendFlow } from "./useMentionSendFlow";
import { usePersistentAgentMentionHydration } from "./usePersistentAgentMentionHydration";
import { useComposerContentState } from "./useComposerContentState";
import { useDraftPersistLifecycle } from "./useDraftPersistSnapshot";
import type { MessageComposerSendContext } from "./messageComposerTypes";
import {
  ComposerCapabilityPalette,
  type CapabilityResidentOption,
  type ComposerCapabilitySelection,
} from "@/features/capabilities/ui/ComposerCapabilityPalette";
import {
  RuntimeTaskConfirmationCard,
  type RuntimeTaskDraft,
} from "@/features/capabilities/ui/RuntimeTaskConfirmationCard";
import { runtimeTaskTargetForFamily } from "@/features/capabilities/lib/runtimeTaskPresentation";
import {
  getResidentSessionCapabilities,
  resolveCapabilitySkillActivation,
} from "@/shared/api/tauriCapabilities";
import {
  listLucaMcpRegistry,
  listRuntimeOwnedMcpCatalog,
} from "@/shared/api/tauriMcp";
import {
  resolveRuntimeTaskProjectFolder,
  startRuntimeTask,
} from "@/shared/api/tauriRuntimeTasks";

type MessageComposerAudienceContext = {
  type: "thread";
  threadRootId: string;
  initialAgentPubkeys?: readonly string[];
};
type MessageComposerProps = {
  audienceContext?: MessageComposerAudienceContext | null;
  channelId?: string | null;
  /**
   * Part of the caller-facing shape; nothing in the composer reads it. The
   * placeholder deliberately does not name the room — the header already
   * does, and a group room has no name worth printing ("ziggy, Luca").
   */
  channelName: string;
  channelType?: ChannelType | null;
  conversationContext?: ConversationContextComposerConfig | null;
  capabilityResidents?: CapabilityResidentOption[];
  containerClassName?: string;
  disabled?: boolean;
  draftKey?: string;
  /**
   * Fires `submitMessage` once after the matching draft loads. This powers
   * the "Send message" confirm-dialog flow in the Drafts panel. The callback
   * `onAutoSubmitComplete` must clear the trigger (e.g. remove `?autoSend`
   * from the URL) — it is called synchronously before `submitMessage` fires
   * so the param is gone before any navigation the send might cause.
   *
   * Fires at most once per mount: a stable key value that persists across
   * re-renders does NOT re-fire.
   */
  autoSubmitDraftKey?: string | null;
  /** Called when the auto-submit fires so the parent can clear the trigger. */
  onAutoSubmitComplete?: () => void;
  editTarget?: {
    author: string;
    body: string;
    id: string;
    /**
     * NIP-92 imeta attachments on the original event, in tag order. Loaded
     * into the composer's pending-imeta state on edit-open so the user sees
     * them as removable thumbnails (just like the send path) and can add
     * more. The submit path emits a fresh full imeta tag set on the edit
     * event; the receiver overlays it.
     */
    imetaMedia?: ImetaMedia[];
  } | null;
  /**
   * Seeds an otherwise-empty composer once. Used by Library actions that hand
   * a runtime-owned capability into a normal conversation. It never replaces
   * a restored draft or text the owner has already entered.
   */
  initialContent?: string;
  initialSkillId?: string;
  isSending?: boolean;
  mediaController?: MediaUploadController;
  onCancelEdit?: () => void;
  onCancelReply?: () => void;
  /**
   * Invoked when the user presses ↑ in an empty composer that is not already
   * in edit mode. The owner should locate the most recent message authored by
   * the current user within this composer's scope (main timeline, DM, or
   * thread) and enter edit mode for it. Return `true` if a target was found
   * and edit mode was entered, so the composer can swallow the keystroke;
   * return `false` to let the arrow key fall through normally.
   */
  onEditLastOwnMessage?: () => boolean;
  onEditSave?: (
    content: string,
    mediaTags?: string[][],
    mentionPubkeys?: string[],
  ) => Promise<void>;
  /** Captures send context synchronously before awaits can change navigation. */
  onCaptureSendContext?: () => MessageComposerSendContext | null;
  /** Resolves the channel required to prepare mentions before sending. */
  onPrepareSendChannel?: (pubkeys?: string[]) => Promise<string | null>;
  onPreparingMentionSendChange?: (isPreparing: boolean) => void;
  onSend: (
    content: string,
    mentionPubkeys: string[],
    mediaTags?: string[][],
    channelId?: string | null,
    threadContext?: MessageComposerSendContext | null,
    explicitMentionPubkeys?: string[],
  ) => Promise<void>;
  placeholder?: string;
  profiles?: UserProfileLookup;
  replyTarget?: {
    author: string;
    body: string;
    id: string;
  } | null;
  showTopBorder?: boolean;
  toolbarExtraActions?: React.ReactNode;
  typingParentEventId?: string | null;
  typingRootEventId?: string | null;
};

function MessageComposerImpl({
  audienceContext = null,
  channelId = null,
  channelType = null,
  conversationContext = null,
  capabilityResidents = [],
  containerClassName,
  disabled = false,
  draftKey,
  autoSubmitDraftKey = null,
  onAutoSubmitComplete,
  editTarget = null,
  initialContent,
  initialSkillId,
  isSending = false,
  onCancelEdit,
  onCancelReply,
  onCaptureSendContext,
  onEditLastOwnMessage,
  onEditSave,
  onPrepareSendChannel,
  onPreparingMentionSendChange,
  onSend,
  placeholder,
  profiles,
  replyTarget = null,
  mediaController,
  showTopBorder = false,
  toolbarExtraActions,
  typingParentEventId = null,
  typingRootEventId = null,
}: MessageComposerProps) {
  React.useEffect(() => {
    if (window.__BUZZ_E2E__) {
      performance.mark("luca:message-composer-commit");
    }
  });
  const {
    contentRef,
    isContentEmpty,
    setComposerContent,
    setComposerContentFromText,
    syncComposerContentFromEditor,
    syncContentRefFromEditorRef,
  } = useComposerContentState();
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = React.useState(false);
  const [isFormattingOpen, setIsFormattingOpen] = React.useState(false);
  const [isContextOpen, setIsContextOpen] = React.useState(false);
  const [isCapabilityPaletteOpen, setIsCapabilityPaletteOpen] =
    React.useState(false);
  const dismissedCapabilitySlashRef = React.useRef(false);
  const [capabilitySelection, setCapabilitySelection] =
    React.useState<ComposerCapabilitySelection | null>(null);
  const [capabilityError, setCapabilityError] = React.useState<string | null>(
    null,
  );
  const [runtimeTaskDraft, setRuntimeTaskDraft] =
    React.useState<RuntimeTaskDraft | null>(null);
  const conversationProjectSourceIds = conversationContext?.project?.sourceIds;
  const contextAddButtonRef = React.useRef<HTMLButtonElement>(null);
  const [isContextSendBlocked, setIsContextSendBlocked] = React.useState(false);
  const isContextSendBlockedRef = React.useRef(false);
  isContextSendBlockedRef.current = isContextSendBlocked;
  React.useEffect(() => {
    if (!conversationContext) setIsContextSendBlocked(false);
  }, [conversationContext]);
  const [spoileredAttachmentUrls, setSpoileredAttachmentUrls] = React.useState<
    Set<string>
  >(() => new Set());
  const spoileredAttachmentUrlsRef = React.useRef(spoileredAttachmentUrls);
  spoileredAttachmentUrlsRef.current = spoileredAttachmentUrls;

  const handleFormattingToggle = React.useCallback((pressed: boolean) => {
    if (pressed) setIsEmojiPickerOpen(false);
    setIsFormattingOpen(pressed);
  }, []);

  const seededInitialSkillRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!initialSkillId || capabilityResidents.length !== 1) return;
    const residentPubkey = capabilityResidents[0]?.pubkey ?? "";
    const seedKey = `${initialSkillId}:${residentPubkey}`;
    if (seededInitialSkillRef.current === seedKey) return;
    seededInitialSkillRef.current = seedKey;
    let cancelled = false;
    void resolveCapabilitySkillActivation(initialSkillId, residentPubkey)
      .then((activation) => {
        if (cancelled) return;
        if (
          activation.status !== "ready" ||
          !activation.canonicalName ||
          !activation.runtimeFamily
        ) {
          setCapabilityError(
            activation.reason ??
              "This Skill is not available to the selected resident session.",
          );
          return;
        }
        setCapabilitySelection({
          kind: "skill",
          residentPubkey: activation.residentPubkey,
          runtimeFamily: activation.runtimeFamily,
          catalogId: activation.skillId,
          catalogGeneration: activation.catalogGeneration,
          canonicalName: activation.canonicalName,
          label: activation.canonicalName.slice(1),
        });
        setCapabilityError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setCapabilityError(
            "Polyphonic could not verify this Skill for the selected resident session.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    capabilityResidents.length,
    capabilityResidents[0]?.pubkey,
    initialSkillId,
  ]);

  const drafts = useDrafts();
  const identityQuery = useIdentityQuery();
  const effectiveDraftKey = draftKey ?? channelId;
  const ownerPubkey = identityQuery.data?.pubkey ?? null;
  const audienceThreadRootId = audienceContext?.threadRootId ?? null;
  const audienceScope =
    audienceThreadRootId && channelId && ownerPubkey
      ? getPersistentAgentAudienceScope({
          ownerPubkey,
          channelId,
          threadRootId: audienceThreadRootId,
        })
      : null;
  const effectiveDraftKeyRef = React.useRef(effectiveDraftKey);
  effectiveDraftKeyRef.current = effectiveDraftKey;
  // Snapshot composer state before edit mode so cancel can restore it.
  const preEditSnapshotRef = React.useRef<{
    draftKey: string | null | undefined;
    content: string;
    pendingImeta: ImetaMedia[];
    spoileredAttachmentUrls: Set<string>;
    mentionRefs: DraftMentionRef[];
  } | null>(null);
  const mentions = useMentions(channelId, undefined, profiles, {
    channelType,
  });
  const channelLinks = useChannelLinks();
  const customEmoji = useCustomEmoji();
  const emojiAutocomplete = useEmojiAutocomplete(customEmoji);
  const notifyTyping = useTypingBroadcast(
    channelId,
    typingParentEventId,
    typingRootEventId,
  );

  // We pass a custom setter that both updates React state AND inserts
  // markdown into the Tiptap editor when media upload completes.
  const internalMedia = useMediaUpload();
  const media = mediaController ?? internalMedia;
  const ownsDropZone = mediaController === undefined;
  const audioRecorder = useAudioAttachmentRecorder({
    disabled: disabled || media.isUploading,
    uploadFile: media.uploadFile,
  });

  // Keep draft writes out of the typing path, but flush before reload/exit
  // and preserve the outgoing conversation before a key change.
  const scheduleDraftPersist = useDraftPersistLifecycle({
    effectiveDraftKey,
    channelId,
    loadDraft: drafts.loadDraft,
    persistDraft: drafts.persistDraft,
    getMentionRefs: mentions.getDraftMentionRefs,
    restoreMentionRefs: mentions.restoreDraftMentionRefs,
    getDraftBeforeEdit: (key) => {
      const snapshot = preEditSnapshotRef.current;
      return snapshot?.draftKey === key
        ? {
            ...snapshot,
            spoileredAttachmentUrls: [...snapshot.spoileredAttachmentUrls],
          }
        : null;
    },
    livePendingImeta: media.pendingImeta,
    setPendingImeta: media.setPendingImeta,
    setContent: (content) => {
      setComposerContent(content);
      richText.setContent(content);
    },
    clearContent: () => {
      setComposerContent("");
      richText.clearContent();
    },
    setSpoileredAttachmentUrls,
    spoileredAttachmentUrlsRef,
    syncComposerContentFromEditor,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: attachment changes trigger a save; the flush reads their latest refs
  React.useEffect(() => {
    scheduleDraftPersist();
  }, [media.pendingImeta, spoileredAttachmentUrls, scheduleDraftPersist]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: effectiveDraftKey is the sole trigger
  React.useEffect(() => {
    media.setUploadState({ status: "idle" });
    setIsEmojiPickerOpen(false);
    setIsCapabilityPaletteOpen(false);
    dismissedCapabilitySlashRef.current = false;
    channelLinks.clearChannels();
    emojiAutocomplete.clearEmojis();
  }, [effectiveDraftKey]);

  const disabledRef = React.useRef(disabled);
  const isSendingRef = React.useRef(isSending);
  const isUploadingRef = React.useRef(media.isUploading);
  const onSendRef = React.useRef(onSend);
  const onEditSaveRef = React.useRef(onEditSave);
  const onEditLastOwnMessageRef = React.useRef(onEditLastOwnMessage);
  const editTargetRef = React.useRef(editTarget);
  const replyTargetRef = React.useRef(replyTarget);
  const extractMentionPubkeysRef = React.useRef(mentions.extractMentionPubkeys);
  const ownerPubkeyRef = React.useRef(ownerPubkey);
  disabledRef.current = disabled;
  isSendingRef.current = isSending;
  isUploadingRef.current = media.isUploading;
  onSendRef.current = onSend;
  onEditSaveRef.current = onEditSave;
  onEditLastOwnMessageRef.current = onEditLastOwnMessage;
  editTargetRef.current = editTarget;
  replyTargetRef.current = replyTarget;
  extractMentionPubkeysRef.current = mentions.extractMentionPubkeys;
  ownerPubkeyRef.current = ownerPubkey;

  const isAutocompleteOpenRef = React.useRef(false);
  isAutocompleteOpenRef.current =
    mentions.isMentionOpen ||
    channelLinks.isChannelOpen ||
    emojiAutocomplete.isEmojiAutocompleteOpen;

  const submitMessageRef = React.useRef<() => void>(() => {});
  const composerScrollRef = React.useRef<HTMLDivElement>(null);

  // Set after `useLinkEditor` exists below; the editor's link-click handler
  // delegates through this ref to break the hook ordering cycle (the editor
  // needs `onEditLink`, but the link editor needs the editor's `richText`).
  const onEditLinkRef = React.useRef<
    ((info: LinkSelectionInfo) => void) | null
  >(null);
  const onLinkSelectionChangeRef = React.useRef<
    ((info: LinkSelectionInfo | null) => void) | null
  >(null);
  const onLinkShortcutRef = React.useRef<(() => boolean) | null>(null);

  const scrollComposerToBottom = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      const scrollElement = composerScrollRef.current;
      if (!scrollElement) return;
      scrollElement.scrollTop = scrollElement.scrollHeight;
    });
  }, []);

  // One string, every conversation type. Naming the room here said it twice
  // (the header already does) and turned group rooms into "Message ziggy,
  // Luca"; reply and edit are named by the recess sitting directly above the
  // card. The prop stays for a caller with a genuine gate to announce
  // ("Choose a recipient…"), not for naming the room.
  const computedPlaceholder = placeholder ?? "Message…";

  const richText = useRichTextEditor({
    placeholder: computedPlaceholder,
    editable: !disabled,
    mentionNames: mentions.knownNames,
    agentMentionNames: mentions.agentKnownNames,
    channelNames: channelLinks.knownChannelNames,
    customEmoji,
    onSubmit: () => submitMessageRef.current(),
    onEditLastOwnMessage: () => {
      // Never re-enter edit from an empty edit (e.g. image-only edit whose
      // text body is empty) — `editTarget` means we're already editing.
      if (editTargetRef.current) return false;
      const handler = onEditLastOwnMessageRef.current;
      return handler ? handler() : false;
    },
    isAutocompleteOpen: isAutocompleteOpenRef,
    onEditLink: (info) => onEditLinkRef.current?.(info),
    onLinkSelectionChange: (info) => onLinkSelectionChangeRef.current?.(info),
    onLinkShortcut: () => onLinkShortcutRef.current?.() ?? false,
    onLeadingSlash: () => {
      dismissedCapabilitySlashRef.current = false;
      setIsCapabilityPaletteOpen(true);
    },
    onUpdate: ({ cursor, text }) => {
      setComposerContentFromText(text);
      scheduleDraftPersist();

      if (/^\s*\/$/.test(text)) {
        if (!dismissedCapabilitySlashRef.current) {
          setIsCapabilityPaletteOpen(true);
        }
        // The leading slash belongs exclusively to the capability palette.
        // Avoid waking the mention/channel/emoji reconcilers in the same
        // frame as the palette acknowledgment; they cannot match this input
        // and made the first command keystroke exceed the P0 frame budget on
        // throttled hardware.
        return;
      }
      dismissedCapabilitySlashRef.current = false;

      mentions.updateMentionQuery(text, cursor);
      channelLinks.updateChannelQuery(text, cursor);
      emojiAutocomplete.updateEmojiQuery(text, cursor);

      persistentMentionHydrationRef.current?.reconcile(text);

      if (text.trim().length > 0) {
        notifyTyping();
      }
    },
  });

  const seededInitialContentRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const seed = initialContent?.trimEnd();
    if (!seed || seededInitialContentRef.current === seed) return;
    seededInitialContentRef.current = seed;
    if (syncComposerContentFromEditor().trim().length > 0) return;
    const nextContent = `${seed}\n\n`;
    setComposerContent(nextContent);
    richText.setContent(nextContent);
    requestAnimationFrame(() => richText.focusEnd());
  }, [
    initialContent,
    richText.focusEnd,
    richText.setContent,
    setComposerContent,
    syncComposerContentFromEditor,
  ]);

  const handleCapabilityCommand = React.useCallback(
    (selection: ComposerCapabilitySelection) => {
      if (selection.kind !== "command") return;
      const current = richText.getMarkdown();
      if (/^\s*\/\s*$/.test(current)) {
        const next = `${selection.canonicalName} `;
        setComposerContent(next);
        richText.setContent(next);
        requestAnimationFrame(() => richText.focusEnd());
      } else {
        richText.editor
          ?.chain()
          .focus()
          .insertContent(`${selection.canonicalName} `)
          .run();
      }
      setCapabilitySelection(selection);
      setCapabilityError(null);
      setIsCapabilityPaletteOpen(false);
    },
    [
      richText.editor,
      richText.focusEnd,
      richText.getMarkdown,
      richText.setContent,
      setComposerContent,
    ],
  );

  const handleCapabilitySelection = React.useCallback(
    (selection: ComposerCapabilitySelection) => {
      setCapabilitySelection(selection);
      setCapabilityError(null);
      setIsCapabilityPaletteOpen(false);
      if (/^\s*\/\s*$/.test(richText.getMarkdown())) {
        setComposerContent("");
        richText.clearContent();
      }
      requestAnimationFrame(() => richText.focusEnd());
    },
    [
      richText.clearContent,
      richText.focusEnd,
      richText.getMarkdown,
      setComposerContent,
    ],
  );

  const beginRuntimeTask = React.useCallback(() => {
    if (capabilityResidents.length !== 1) {
      setIsCapabilityPaletteOpen(true);
      return;
    }
    const resident = capabilityResidents[0];
    if (!resident) return;
    void getResidentSessionCapabilities(resident.pubkey)
      .then((snapshot) => {
        const runtimeFamily = runtimeTaskTargetForFamily(
          snapshot?.runtimeFamily,
        );
        if (!runtimeFamily) {
          setCapabilityError(
            "Polyphonic could not verify a supported runtime for this resident. Try again after it reconnects.",
          );
          return;
        }
        setCapabilitySelection({
          kind: "runtime_task",
          residentPubkey: resident.pubkey,
          runtimeFamily,
          label: "Run task",
        });
        setCapabilityError(null);
        requestAnimationFrame(() => richText.focusEnd());
      })
      .catch(() => {
        setCapabilityError(
          "Polyphonic could not verify this resident's runtime session. Try again after it reconnects.",
        );
      });
  }, [capabilityResidents, richText.focusEnd]);

  const linkEditor = useLinkEditor(richText);
  syncContentRefFromEditorRef.current = () => {
    const markdown = richText.getMarkdown();
    contentRef.current = markdown;
    return markdown;
  };
  onEditLinkRef.current = linkEditor.openFromClick;
  onLinkSelectionChangeRef.current = linkEditor.showFromCursor;
  onLinkShortcutRef.current = linkEditor.openFromShortcut;
  useComposerSpoilerParticles(richText.editor, composerScrollRef);

  const persistentMentionHydration = usePersistentAgentMentionHydration({
    audienceScope,
    hydrationKey: effectiveDraftKey,
    initialAgentPubkeys: audienceContext?.initialAgentPubkeys,
    isEditing: editTarget != null,
    mentions,
    richText,
  });
  const persistentAudience = persistentMentionHydration.audience;
  const persistentMentionHydrationRef = React.useRef(
    persistentMentionHydration,
  );
  persistentMentionHydrationRef.current = persistentMentionHydration;

  const mentionSendFlow = useMentionSendFlow({
    channelId,
    channelLinks,
    channelType,
    contentRef,
    customEmoji,
    drafts,
    emojiAutocomplete,
    mentions,
    onPrepareSendChannel,
    onSendRef,
    richText,
    setContent: setComposerContent,
    setIsEmojiPickerOpen,
    setPendingImeta: media.setPendingImeta,
    setSpoileredAttachmentUrls,
    onSuccessfulExplicitAgentAudience:
      persistentAudience.enabled && audienceContext && ownerPubkey
        ? ({ channelId: successfulChannelId, ...promotion }) => {
            const scope = getPersistentAgentAudienceScope({
              ownerPubkey,
              channelId: successfulChannelId,
              threadRootId: audienceThreadRootId,
            });
            persistentAudience.promotePubkeys({ ...promotion, scope });
          }
        : undefined,
    resolvePostSendContent: persistentMentionHydration.resolvePostSendContent,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: editTarget?.id is the trigger
  React.useEffect(() => {
    if (editTarget) {
      // Snapshot the current draft (text + attachments) so the user's
      // in-flight work survives the edit-mode hijack and is restored on
      // edit-cancel/exit.
      if (
        !preEditSnapshotRef.current ||
        preEditSnapshotRef.current.draftKey !== effectiveDraftKey
      ) {
        const content = syncComposerContentFromEditor();
        preEditSnapshotRef.current = {
          draftKey: effectiveDraftKey,
          content,
          pendingImeta: [...media.pendingImetaRef.current],
          spoileredAttachmentUrls: new Set(spoileredAttachmentUrls),
          mentionRefs: mentions.getDraftMentionRefs(content),
        };
      }
      // Strip the trailing `![image|video](url)` lines that correspond to
      // imeta attachments — the user manages those via the attachments row,
      // not via raw markdown in the editor.
      const editableImeta = restoreImetaMediaDisplayLabels(
        editTarget.body,
        editTarget.imetaMedia ?? [],
      );
      const editableBody = stripImetaMediaLines(editTarget.body, editableImeta);
      setComposerContent(editableBody);
      richText.setContent(editableBody);
      // Seed the composer's pending-imeta state with the original event's
      // attachments so they show up in `ComposerAttachments` and the user
      // can remove existing ones / add new ones before saving.
      media.setPendingImeta(editableImeta);
      setSpoileredAttachmentUrls(
        findSpoileredImetaMediaUrls(editTarget.body, editableImeta),
      );
      // Defer focus to the next frame so it runs after any focus-
      // restoration the trigger UI (e.g. the message-row context menu)
      // fires on close. Without this, Radix-style focus-restoration races
      // our call and leaves DOM focus on the message row — global keybinds
      // like Delete then fire there instead of in the editor. `focusEnd`
      // also lands the caret at end of the loaded content.
      const rafId = requestAnimationFrame(() => richText.focusEnd());
      return () => cancelAnimationFrame(rafId);
    } else if (preEditSnapshotRef.current !== null) {
      const {
        draftKey: restoredDraftKey,
        content: restoredContent,
        pendingImeta: restoredImeta,
        spoileredAttachmentUrls: restoredSpoileredAttachmentUrls,
        mentionRefs: restoredMentionRefs,
      } = preEditSnapshotRef.current;
      preEditSnapshotRef.current = null;
      if (restoredDraftKey !== effectiveDraftKey) return;
      setComposerContent(restoredContent);
      restoredContent
        ? richText.setContent(restoredContent)
        : richText.clearContent();
      media.setPendingImeta(restoredImeta);
      setSpoileredAttachmentUrls(restoredSpoileredAttachmentUrls);
      mentions.restoreDraftMentionRefs(restoredMentionRefs);
    }
  }, [editTarget?.id]);

  // ── Focus on reply ──────────────────────────────────────────────────
  // Use focusPreserve so that re-renders (e.g. new messages arriving in
  // a thread) don't yank the cursor to the end while the user is editing.
  React.useEffect(() => {
    if (!replyTarget || disabled) return;
    richText.focusPreserve();
  }, [disabled, replyTarget, richText.focusPreserve]);

  // ── Autofocus on mount / channel switch ─────────────────────────────
  useComposerAutofocus(richText.focus, effectiveDraftKey, disabled);

  // ── Mention / channel / emoji autocomplete insertion ────────────────
  // Hooks return a plain-text edit descriptor; `replacePlainTextRange`
  // applies it as a single ProseMirror transaction (no markdown round-trip).
  const applyAutocompleteEdit = React.useCallback(
    (edit: AutocompleteEdit) => {
      richText.replacePlainTextRange(
        edit.replaceFromOffset,
        edit.replaceToOffset,
        edit.insertText,
        edit.customEmojiShortcode,
      );
    },
    [richText.replacePlainTextRange],
  );

  const applyMentionInsert = React.useCallback(
    (suggestion: MentionSuggestion) => {
      const { cursor } = richText.getPlainTextAndCursor();
      applyAutocompleteEdit(mentions.insertMention(suggestion, cursor));
    },
    [
      applyAutocompleteEdit,
      mentions.insertMention,
      richText.getPlainTextAndCursor,
    ],
  );

  const applyChannelInsert = React.useCallback(
    (suggestion: ChannelSuggestion) => {
      const { cursor } = richText.getPlainTextAndCursor();
      applyAutocompleteEdit(channelLinks.insertChannel(suggestion, cursor));
    },
    [
      applyAutocompleteEdit,
      channelLinks.insertChannel,
      richText.getPlainTextAndCursor,
    ],
  );

  const applyEmojiInsert = React.useCallback(
    (suggestion: EmojiSuggestion) => {
      const { cursor } = richText.getPlainTextAndCursor();
      applyAutocompleteEdit(emojiAutocomplete.insertEmoji(suggestion, cursor));
    },
    [
      applyAutocompleteEdit,
      emojiAutocomplete.insertEmoji,
      richText.getPlainTextAndCursor,
    ],
  );

  // ── Emoji insertion ─────────────────────────────────────────────────
  const insertEmoji = React.useCallback(
    (emoji: string) => {
      if (!richText.editor) return;
      // A `:shortcode:` for a known custom emoji becomes a selectable atom
      // node (same as the input rule / autocomplete), so it can be selected,
      // copied, and deleted as one unit. Everything else (native unicode)
      // inserts as plain content.
      const match = /^:([^:\s]+):$/.exec(emoji);
      const shortcode = match?.[1]?.toLowerCase();
      const known =
        shortcode &&
        customEmoji.some((e) => e.shortcode.toLowerCase() === shortcode);
      if (known && shortcode) {
        richText.editor
          .chain()
          .focus()
          .insertContent({
            type: CUSTOM_EMOJI_NODE_NAME,
            attrs: {
              shortcode,
              src:
                customEmoji.find((e) => e.shortcode.toLowerCase() === shortcode)
                  ?.url ?? "",
            },
          })
          .insertContent(" ")
          .run();
      } else {
        richText.editor.chain().focus().insertContent(emoji).run();
      }
      setIsEmojiPickerOpen(false);
      mentions.clearMentions();
    },
    [richText.editor, mentions.clearMentions, customEmoji],
  );

  // ── @ mention picker (toolbar button) ───────────────────────────────
  const openMentionPicker = React.useCallback(() => {
    if (!richText.editor) return;
    const { text, cursor } = richText.getPlainTextAndCursor();

    // Check if there's already an @-query in progress
    const beforeCursor = text.slice(0, cursor);
    if (/(?:^|[\s])@[^\s]*$/.test(beforeCursor)) {
      mentions.updateMentionQuery(text, cursor);
      richText.focus();
      return;
    }

    // Insert @ at cursor
    const previousChar = text.slice(0, cursor).slice(-1);
    const prefix =
      cursor > 0 && previousChar && !/\s/.test(previousChar) ? " @" : "@";
    richText.editor.chain().focus().insertContent(prefix).run();
    setIsEmojiPickerOpen(false);

    // Trigger mention detection after inserting @
    const { text: updatedText, cursor: updatedCursor } =
      richText.getPlainTextAndCursor();
    mentions.updateMentionQuery(updatedText, updatedCursor);
  }, [
    richText.editor,
    richText.getPlainTextAndCursor,
    richText.focus,
    mentions.updateMentionQuery,
  ]);

  // ── Submit message ──────────────────────────────────────────────────
  const submitMessage = React.useCallback(async () => {
    const trimmed = syncComposerContentFromEditor().trim();

    // Edit mode
    if (editTargetRef.current && onEditSaveRef.current) {
      if (isSendingRef.current || isUploadingRef.current) return;
      const currentPendingImeta = media.pendingImetaRef.current;
      const hasMedia = currentPendingImeta.length > 0;
      // Empty text + zero attachments is a no-op (don't let edit become an
      // effective deletion).
      if (!trimmed && !hasMedia) return;

      // Build the edit's body + imeta tag set. Coerce `mediaTags ?? []`
      // because edit semantics use `[]` as the explicit "wipe all
      // attachments" signal — the receiver overlay drops imeta when the
      // edit carries an empty (but defined) set.
      const { content: finalContent, mediaTags } = buildOutgoingMessage(
        trimmed,
        currentPendingImeta,
        spoileredAttachmentUrls,
      );

      // NIP-30: attach `["emoji", shortcode, url]` tags for custom emoji in the
      // edited body, exactly like the send path. Without this an edited message
      // ships with no emoji tags, so the receiver can't resolve a `:shortcode:`
      // and renders the literal text. `?? []` preserves edit semantics (a
      // defined-but-empty media set means "wipe attachments").
      const outgoingTags =
        mergeOutgoingTags(
          mediaTags,
          buildCustomEmojiTags(finalContent, customEmoji),
        ) ?? [];

      // Notify only mentions this edit *newly adds* (see
      // diffAddedMentionPubkeys): a typo-fix edit that leaves the mention set
      // unchanged emits no `p` tags and re-wakes nobody. Computed before the
      // composer state is cleared below.
      const addedMentionPubkeys = diffAddedMentionPubkeys(
        extractMentionPubkeysRef.current(editTargetRef.current.body),
        extractMentionPubkeysRef.current(finalContent),
        ownerPubkeyRef.current ?? "",
      );

      const savedContent = trimmed;
      const savedImeta = [...currentPendingImeta];
      const savedSpoileredAttachmentUrls = new Set(spoileredAttachmentUrls);
      setComposerContent("");
      richText.clearContent();
      media.setPendingImeta([]);
      setSpoileredAttachmentUrls(new Set());
      mentions.clearMentions();
      channelLinks.clearChannels();
      emojiAutocomplete.clearEmojis();
      setIsEmojiPickerOpen(false);

      try {
        await onEditSaveRef.current(
          finalContent,
          outgoingTags,
          addedMentionPubkeys,
        );
      } catch {
        setComposerContent(savedContent);
        richText.setContent(savedContent);
        media.setPendingImeta(savedImeta);
        setSpoileredAttachmentUrls(savedSpoileredAttachmentUrls);
      }
      return;
    }

    // Normal send
    const currentPendingImeta = media.pendingImetaRef.current;
    const hasMedia = currentPendingImeta.length > 0;
    const typedRuntimeTask = /^\/task(?:\s+|$)/i.test(trimmed);
    const selectedRuntimeTask =
      capabilitySelection?.kind === "runtime_task" ? capabilitySelection : null;
    if (typedRuntimeTask || selectedRuntimeTask) {
      if (
        disabledRef.current ||
        isSendingRef.current ||
        isUploadingRef.current ||
        runtimeTaskDraft
      ) {
        return;
      }
      if (hasMedia) {
        setCapabilityError(
          "Runtime task attachments are not part of the beta. Describe the task and choose its working folder.",
        );
        return;
      }
      const residentPubkey =
        selectedRuntimeTask?.residentPubkey ??
        (capabilityResidents.length === 1
          ? capabilityResidents[0]?.pubkey
          : undefined);
      const resident = capabilityResidents.find(
        (candidate) => candidate.pubkey === residentPubkey,
      );
      const prompt = typedRuntimeTask
        ? trimmed.replace(/^\/task(?:\s+|$)/i, "").trim()
        : trimmed;
      if (!channelId || !residentPubkey || !resident || !prompt) {
        setCapabilityError(
          residentPubkey
            ? "Describe the task before continuing."
            : "Choose the resident initiating this task from Skills and tools.",
        );
        return;
      }
      let runtimeFamily = selectedRuntimeTask?.runtimeFamily;
      if (!runtimeFamily) {
        const snapshot = await getResidentSessionCapabilities(
          residentPubkey,
        ).catch(() => null);
        runtimeFamily =
          runtimeTaskTargetForFamily(snapshot?.runtimeFamily) ?? undefined;
        if (!runtimeFamily) {
          setCapabilityError(
            "Polyphonic could not verify a supported runtime for this resident. Try again after it reconnects.",
          );
          return;
        }
      }
      const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim() || "Runtime task";
      const workingFolder = conversationProjectSourceIds?.length
        ? await resolveRuntimeTaskProjectFolder(
            conversationProjectSourceIds,
          ).catch(() => null)
        : null;
      setRuntimeTaskDraft({
        conversationId: channelId,
        residentPubkey,
        residentName: resident.name,
        runtimeFamily,
        summary:
          firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine,
        prompt,
        workingFolder,
      });
      setCapabilityError(null);
      return;
    }
    if (
      (!trimmed && !hasMedia) ||
      disabledRef.current ||
      isContextSendBlockedRef.current ||
      isSendingRef.current ||
      isUploadingRef.current ||
      mentionSendFlow.isPreparingMentionSend
    ) {
      return;
    }

    let outboundText = trimmed;
    if (capabilitySelection) {
      setCapabilityError(null);
      if (capabilitySelection.kind === "command") {
        const snapshot = await getResidentSessionCapabilities(
          capabilitySelection.residentPubkey,
        ).catch(() => null);
        const firstToken = trimmed.split(/\s+/, 1)[0];
        if (
          !snapshot ||
          snapshot.runtimeFamily !== capabilitySelection.runtimeFamily ||
          snapshot.sessionEpoch !== capabilitySelection.sessionEpoch ||
          firstToken !== capabilitySelection.canonicalName ||
          !snapshot.commands.some(
            (command) =>
              command.canonicalName === capabilitySelection.canonicalName,
          )
        ) {
          setCapabilityError(
            "This command changed before Send. Your draft is intact; choose it again after the resident reconnects.",
          );
          return;
        }
      } else if (capabilitySelection.kind === "skill") {
        const activation = await resolveCapabilitySkillActivation(
          capabilitySelection.catalogId,
          capabilitySelection.residentPubkey,
        ).catch(() => null);
        if (
          activation?.status !== "ready" ||
          !activation.canonicalName ||
          activation.canonicalName !== capabilitySelection.canonicalName ||
          activation.runtimeFamily !== capabilitySelection.runtimeFamily ||
          activation.catalogGeneration !== capabilitySelection.catalogGeneration
        ) {
          setCapabilityError(
            activation?.reason ??
              "This Skill changed before send. Refresh Skills and choose it again.",
          );
          return;
        }
        outboundText = `${activation.canonicalName}\n\n${trimmed}`;
      } else if (capabilitySelection.kind === "mcp_preference") {
        const snapshot = await getResidentSessionCapabilities(
          capabilitySelection.residentPubkey,
        ).catch(() => null);
        if (
          !snapshot ||
          snapshot.runtimeFamily !== capabilitySelection.runtimeFamily
        ) {
          setCapabilityError(
            "This resident's runtime session changed. Choose the connection again.",
          );
          return;
        }
        let available = false;
        if (capabilitySelection.catalogId.startsWith("runtime:")) {
          const catalogs = await listRuntimeOwnedMcpCatalog().catch(() => []);
          available = catalogs.some(
            (catalog) =>
              catalog.runtimeId === capabilitySelection.runtimeFamily &&
              catalog.servers.some(
                (server) =>
                  server.name === capabilitySelection.canonicalName &&
                  server.status === "configured",
              ),
          );
        } else {
          const registry = await listLucaMcpRegistry().catch(() => null);
          available = Boolean(
            registry?.connections.some(
              (connection) =>
                connection.connectionId === capabilitySelection.catalogId &&
                connection.enabled,
            ) &&
              registry?.grants.some(
                (grant) =>
                  grant.connectionId === capabilitySelection.catalogId &&
                  grant.residentPubkey === capabilitySelection.residentPubkey,
              ),
          );
        }
        if (!available) {
          setCapabilityError(
            "This connection is no longer available to the selected resident. Open Connections to repair it.",
          );
          return;
        }
        outboundText = `Use the ${capabilitySelection.label} connection if it is appropriate for this request.\n\n${trimmed}`;
      }
    }

    const capturedThreadContext = onCaptureSendContext?.() ?? null;
    if (
      capturedThreadContext !== null &&
      !capturedThreadContext.parentEventId
    ) {
      return;
    }

    onPreparingMentionSendChange?.(true);
    persistentMentionHydration.beginSubmit();
    try {
      await mentionSendFlow.sendMessageWithMentionFlow({
        capturedChannelId: channelId,
        capturedThreadContext,
        pendingImeta: currentPendingImeta,
        sentDraftKey: resolveSentDraftKey(
          effectiveDraftKeyRef.current,
          drafts.loadDraft,
        ),
        spoileredAttachmentUrls,
        trimmed: outboundText,
        audienceGeneration: persistentAudience.generation,
        audienceRevision: audienceScope ? persistentAudience.revision : null,
      });
      setCapabilitySelection(null);
      setCapabilityError(null);
    } finally {
      persistentMentionHydration.endSubmit();
      onPreparingMentionSendChange?.(false);
    }
  }, [
    capabilityResidents,
    channelId,
    channelLinks.clearChannels,
    customEmoji,
    drafts.loadDraft,
    emojiAutocomplete.clearEmojis,
    media.pendingImetaRef,
    media.setPendingImeta,
    mentionSendFlow.isPreparingMentionSend,
    mentionSendFlow.sendMessageWithMentionFlow,
    mentions.clearMentions,
    richText.clearContent,
    richText.setContent,
    setComposerContent,
    spoileredAttachmentUrls,
    syncComposerContentFromEditor,
    onCaptureSendContext,
    onPreparingMentionSendChange,
    audienceScope,
    persistentMentionHydration,
    persistentAudience.generation,
    persistentAudience.revision,
    capabilitySelection,
    conversationProjectSourceIds,
    runtimeTaskDraft,
  ]);
  submitMessageRef.current = submitMessage;

  // ── Auto-submit on draft send ────────────────────────────────────────────
  // When `autoSubmitDraftKey` is set (the user clicked "Send message" in the
  // Drafts panel and confirmed), fire `submitMessage` once after mount so the
  // draft is sent through the real send path (mention resolution, media, etc.).
  //
  // Guard: only fire when the effective draft key matches the trigger so a
  // stale URL param on a different channel never fires a spurious send.
  //
  // Fires at most once per mount (empty dep array after the key check) — the
  // `onAutoSubmitComplete` callback clears the trigger before `submitMessage`
  // runs, preventing re-fire on re-render or back-navigation.
  const onAutoSubmitCompleteRef = React.useRef(onAutoSubmitComplete);
  onAutoSubmitCompleteRef.current = onAutoSubmitComplete;

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally fires once on mount only
  React.useEffect(() => {
    if (
      autoSubmitDraftKey === null ||
      autoSubmitDraftKey !== effectiveDraftKey
    ) {
      return;
    }
    // Clear the trigger BEFORE firing so any navigation from the send cannot
    // loop back with the param still present.
    onAutoSubmitCompleteRef.current?.();
    // Defer by one macrotask so the draft-persist lifecycle effect (which runs
    // synchronously after mount) has a chance to load the draft content into
    // the Tiptap editor before we try to submit.
    const timer = window.setTimeout(() => {
      submitMessageRef.current();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only

  const handleSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submitMessage();
    },
    [submitMessage],
  );

  // ── Keyboard handling ───────────────────────────────────────────────
  // Tiptap handles formatting shortcuts (⌘B, ⌘I, etc.) natively.
  // Plain Enter → submit is now handled inside the Tiptap `submitOnEnter`
  // extension (fires before ProseMirror's splitBlock). This wrapper only
  // handles autocomplete arrow/enter keys and Escape for edit mode.
  const handleEditorKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Let autocomplete handle keys first
      const emojiResult = emojiAutocomplete.handleEmojiKeyDown(event);
      if (emojiResult.handled) {
        if (emojiResult.suggestion) {
          applyEmojiInsert(emojiResult.suggestion);
        }
        return;
      }

      const channelResult = channelLinks.handleChannelKeyDown(event);
      if (channelResult.handled) {
        if (channelResult.suggestion) {
          applyChannelInsert(channelResult.suggestion);
        }
        return;
      }

      const { handled, suggestion } = mentions.handleMentionKeyDown(event);
      if (handled) {
        if (suggestion) {
          applyMentionInsert(suggestion);
        }
        return;
      }

      if (event.key === "Tab" && !event.shiftKey && linkEditor.isCardOpen) {
        event.preventDefault();
        if (!linkEditor.focusCardFirstControl()) {
          requestAnimationFrame(linkEditor.focusCardFirstControl);
        }
        return;
      }

      // Escape closes whatever is attached to the composer, and only that. It
      // takes the edit target first because editing is the state the composer
      // is *in* — leaving it restores the draft — while a reply is a target
      // the draft is merely pointed at. Either way the words you have typed
      // survive: Escape dismisses the attachment, never the message.
      if (event.key === "Escape" && editTargetRef.current && onCancelEdit) {
        event.preventDefault();
        onCancelEdit();
        return;
      }

      if (event.key === "Escape" && replyTargetRef.current && onCancelReply) {
        event.preventDefault();
        onCancelReply();
        return;
      }
    },
    [
      emojiAutocomplete.handleEmojiKeyDown,
      applyEmojiInsert,
      channelLinks.handleChannelKeyDown,
      applyChannelInsert,
      mentions.handleMentionKeyDown,
      applyMentionInsert,
      linkEditor.isCardOpen,
      linkEditor.focusCardFirstControl,
      onCancelEdit,
      onCancelReply,
    ],
  );

  // ── Media paste + ⌘K link shortcut via Tiptap editorProps ──────────
  const uploadFileRef = React.useRef(media.uploadFile);
  uploadFileRef.current = media.uploadFile;

  React.useEffect(() => {
    if (!richText.editor) return;

    richText.editor.setOptions({
      editorProps: {
        ...richText.editor.options.editorProps,
        handlePaste: (_view, event) => {
          // --- File paste ---
          // Any actual file (image, video, document, …) pastes as an
          // attachment. String/text items have kind "string", so plain-text
          // and code-block paste fall through to the handlers below.
          const items = Array.from(event.clipboardData?.items ?? []);
          const mediaItem = items.find((item) => item.kind === "file");
          if (mediaItem) {
            const file = mediaItem.getAsFile();
            if (file) {
              void uploadFileRef.current(file);
            }
            return true;
          }

          // --- Buzz code-block paste ---
          // The code block copy button writes a small Buzz marker alongside
          // plain text. Use it to paste back as a literal code block so Markdown
          // parsing cannot reshape indentation, fence markers, or headings.
          const codeBlockText = getBuzzCodeBlockClipboardText(
            event.clipboardData,
          );
          if (codeBlockText !== null) {
            event.preventDefault();
            richText.editor
              ?.chain()
              .focus()
              .insertContent([
                {
                  type: "codeBlock",
                  content:
                    codeBlockText.length > 0
                      ? [{ type: "text", text: codeBlockText }]
                      : [],
                },
                { type: "paragraph" },
              ])
              .run();
            scrollComposerToBottom();
            return true;
          }

          // Restore Buzz snapshots before normal styled-HTML normalization.
          if (handleAgentSnapshotPaste(event, media.setPendingImeta))
            return true;
          // Strip mention/channel wrappers that Tiptap would misread as bold.
          const html = event.clipboardData?.getData("text/html");
          if (html && hasMentionClipboardHtml(html)) {
            const cleanHtml = normalizeMentionClipboardHtml(html);
            event.preventDefault();
            _view.pasteHTML(cleanHtml);
            return true;
          }

          const plainText = event.clipboardData?.getData("text/plain") ?? "";
          if (plainText.includes("\n")) {
            scrollComposerToBottom();
          }

          return false;
        },
      },
    });
  }, [media.setPendingImeta, richText.editor, scrollComposerToBottom]);

  // ── Send button state ───────────────────────────────────────────────
  const sendDisabled = React.useMemo(
    () =>
      disabled ||
      isContextSendBlocked ||
      media.isUploading ||
      mentionSendFlow.isPreparingMentionSend ||
      (isContentEmpty && media.pendingImeta.length === 0),
    [
      disabled,
      isContextSendBlocked,
      media.isUploading,
      mentionSendFlow.isPreparingMentionSend,
      isContentEmpty,
      media.pendingImeta.length,
    ],
  );

  const handleCaptureSelection = React.useCallback(() => {
    // No-op for Tiptap — selection is managed by ProseMirror.
  }, []);

  const handlePaperclipClick = React.useCallback(() => {
    void media.handlePaperclip();
  }, [media.handlePaperclip]);

  const handleRemoveAttachment = React.useCallback(
    (url: string) => {
      setSpoileredAttachmentUrls((current) => {
        if (!current.has(url)) return current;
        const next = new Set(current);
        next.delete(url);
        return next;
      });
      media.removeAttachment(url);
    },
    [media.removeAttachment],
  );

  const { handleAttachmentEditSave, handleAttachmentRevert } =
    useAttachmentEditing({
      revertAttachment: media.revertAttachment,
      setSpoileredAttachmentUrls,
      uploadEditedAttachment: media.uploadEditedAttachment,
    });

  const handleToggleAttachmentSpoiler = React.useCallback((url: string) => {
    setSpoileredAttachmentUrls((current) => {
      const next = new Set(current);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }, []);

  return (
    <>
      <footer
        className={cn(
          "relative z-20 shrink-0 bg-transparent px-0 pb-3 pt-0",
          showTopBorder ? "border-t border-border/40 pt-3" : "",
          containerClassName,
        )}
        data-luca-reading-plane
      >
        <div className="relative flex w-full flex-col gap-0">
          {conversationContext ? (
            <ConversationContextComposerSurface
              config={conversationContext}
              fallbackFocusRef={contextAddButtonRef}
              onOpenChange={setIsContextOpen}
              onSendBlockedChange={setIsContextSendBlocked}
              open={isContextOpen}
            />
          ) : null}
          <ComposerReplyEditBanner
            isEditing={editTarget != null}
            replyTarget={replyTarget}
            onCancelEdit={onCancelEdit}
            onCancelReply={onCancelReply}
          />
          {runtimeTaskDraft ? (
            <RuntimeTaskConfirmationCard
              draft={runtimeTaskDraft}
              onCancel={() => {
                setRuntimeTaskDraft(null);
                requestAnimationFrame(() => richText.focusEnd());
              }}
              onConfirm={(details) =>
                startRuntimeTask({
                  conversationId: runtimeTaskDraft.conversationId,
                  residentPubkey: runtimeTaskDraft.residentPubkey,
                  runtimeFamily: details.runtimeFamily,
                  summary: runtimeTaskDraft.summary,
                  prompt: runtimeTaskDraft.prompt,
                  workingFolder: details.workingFolder,
                  permissionMode: details.permissionMode,
                })
              }
              onConfirmed={() => {
                setRuntimeTaskDraft(null);
                setCapabilitySelection(null);
                setCapabilityError(null);
                setComposerContent("");
                richText.clearContent();
                if (effectiveDraftKey) drafts.clearDraft(effectiveDraftKey);
                requestAnimationFrame(() => richText.focusEnd());
              }}
            />
          ) : null}
          {/* The card carries no `transition-colors`: that moves ten
           * properties at once, and on this card only the focus border is
           * allowed to move — the background must hold still and the height
           * must never ease. The one border-color transition it does want
           * lives in composer-states.css. */}
          <form
            className="relative z-10 isolate rounded-xl border bg-muted px-3 py-2"
            data-testid="message-composer"
            onDragEnter={ownsDropZone ? media.handleDragEnter : undefined}
            onDragLeave={ownsDropZone ? media.handleDragLeave : undefined}
            onDragOver={ownsDropZone ? media.handleDragOver : undefined}
            onDrop={
              ownsDropZone
                ? (e) => {
                    void media.handleDrop(e);
                  }
                : undefined
            }
            onSubmit={(event) => {
              handleSubmit(event);
            }}
          >
            <ComposerCapabilityPalette
              onClose={(reason) => {
                dismissedCapabilitySlashRef.current = true;
                setIsCapabilityPaletteOpen(false);
                if (reason !== "outside") richText.editor?.commands.focus();
              }}
              onCommand={handleCapabilityCommand}
              onError={setCapabilityError}
              onSelection={handleCapabilitySelection}
              open={isCapabilityPaletteOpen}
              residents={capabilityResidents}
            />
            {ownsDropZone && media.isDragOver && <DropZoneOverlay />}
            <EmojiAutocomplete
              onSelect={applyEmojiInsert}
              selectedIndex={emojiAutocomplete.emojiSelectedIndex}
              suggestions={
                emojiAutocomplete.isEmojiAutocompleteOpen
                  ? emojiAutocomplete.emojiSuggestions
                  : []
              }
            />
            <ChannelAutocomplete
              onSelect={applyChannelInsert}
              selectedIndex={channelLinks.channelSelectedIndex}
              suggestions={
                channelLinks.isChannelOpen
                  ? channelLinks.channelSuggestions
                  : []
              }
            />
            <MentionAutocomplete
              onFetchMore={mentions.fetchMoreSuggestions}
              onSelect={applyMentionInsert}
              selectedIndex={mentions.mentionSelectedIndex}
              suggestions={mentions.isMentionOpen ? mentions.suggestions : []}
            />
            {capabilitySelection ? (
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-foreground/[0.07] py-1 pl-2.5 pr-1 text-xs text-foreground">
                  <span className="truncate">
                    {capabilitySelection.kind === "command"
                      ? "Command"
                      : capabilitySelection.kind === "skill"
                        ? "Skill"
                        : capabilitySelection.kind === "runtime_task"
                          ? "Task"
                          : "Use"}{" "}
                    {capabilitySelection.label}
                  </span>
                  <button
                    aria-label={`Remove ${capabilitySelection.label}`}
                    className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                    onClick={() => {
                      setCapabilitySelection(null);
                      setCapabilityError(null);
                    }}
                    type="button"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </span>
              </div>
            ) : null}
            {capabilityError ? (
              <div
                className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
                role="alert"
              >
                {capabilityError}
              </div>
            ) : null}
            {media.uploadState.status === "error" ? (
              <div
                className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
                role="alert"
              >
                {sanitizedAttachmentFailure()}
                <button
                  className="ml-2 underline"
                  onClick={() => media.setUploadState({ status: "idle" })}
                  type="button"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            {audioRecorder.error ? (
              <div
                className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
                role="alert"
              >
                {audioRecorder.error}
                <button
                  className="ml-2 underline"
                  onClick={audioRecorder.dismissError}
                  type="button"
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {(media.pendingImeta.length > 0 || media.isUploading) && (
              <div className="mb-2 flex items-center gap-2">
                <ComposerAttachments
                  attachments={media.pendingImeta}
                  isUploading={media.isUploading}
                  onCancelUpload={media.cancelUpload}
                  uploadingCount={media.uploadingCount}
                  uploadingPreviews={media.uploadingPreviews}
                  onEditSave={handleAttachmentEditSave}
                  onRemove={handleRemoveAttachment}
                  onRevert={handleAttachmentRevert}
                  originalUrlByUrl={media.originalUrlByUrl}
                  onToggleSpoiler={handleToggleAttachmentSpoiler}
                  spoileredUrls={spoileredAttachmentUrls}
                />
              </div>
            )}

            {/* The card holds only what the message IS: the text, and the one
             * control that commits it. Everything else lives on the baseline
             * row below, on the ground. */}
            <div className="flex items-end gap-2">
              {/* biome-ignore lint/a11y/noStaticElementInteractions: keydown handler bridges Tiptap editor to autocomplete and submit */}
              <div
                className="rich-text-composer relative max-h-40 min-w-0 flex-1 self-center overflow-y-auto"
                data-testid="message-input-scroll"
                ref={composerScrollRef}
                onKeyDown={handleEditorKeyDown}
              >
                <EditorContent editor={richText.editor} />
              </div>
              {/* Armed or disarmed — that is the button's whole vocabulary.
               * A send is not information: the user caused it, and the
               * message appearing in the timeline is the confirmation. A
               * spinner here would announce, in peripheral vision, something
               * they already know they did. The arrow stays, always, and the
               * button never moves or changes size. Armed, the glyph is cut
               * to the card's own shade, so it reads as a hole punched
               * through the ink rather than a second colour. Arm/disarm
               * timing is in composer-states.css. */}
              <Button
                aria-label={isSending ? "Sending" : "Send message"}
                className="mb-0.5 size-7 shrink-0 rounded-full bg-ink text-muted shadow-none hover:bg-ink/90 disabled:bg-plate disabled:text-ink-ghost disabled:opacity-100"
                data-testid="send-message"
                disabled={sendDisabled || isSending}
                size="icon"
                type="submit"
              >
                <ArrowUp aria-hidden className="size-3.5" />
              </Button>
            </div>
          </form>
          <MessageComposerToolbar
            addButtonRef={contextAddButtonRef}
            composerDisabled={disabled}
            editor={richText.editor}
            extraActions={toolbarExtraActions}
            formattingDisabled={disabled}
            isEmojiPickerOpen={isEmojiPickerOpen}
            isFormattingOpen={isFormattingOpen}
            isUploading={media.isUploading}
            audioRecordingElapsedSeconds={audioRecorder.elapsedSeconds}
            audioRecordingStatus={audioRecorder.status}
            onCaptureSelection={handleCaptureSelection}
            onAudioRecordCancel={audioRecorder.cancel}
            onAudioRecordStart={audioRecorder.start}
            onAudioRecordStop={audioRecorder.stop}
            onEmojiPickerOpenChange={setIsEmojiPickerOpen}
            onEmojiSelect={insertEmoji}
            onFormattingToggle={handleFormattingToggle}
            onLinkButton={linkEditor.openFromToolbar}
            onOpenContext={
              conversationContext ? () => setIsContextOpen(true) : undefined
            }
            onOpenMentionPicker={openMentionPicker}
            onOpenCapabilities={() => setIsCapabilityPaletteOpen(true)}
            onRunTask={beginRuntimeTask}
            onPaperclip={handlePaperclipClick}
          />
        </div>
      </footer>

      <NonMemberMentionDialog
        createsGroupDm={channelType === "dm"}
        error={mentionSendFlow.nonMemberPromptError}
        isInvitePending={mentionSendFlow.isInvitePending}
        names={mentionSendFlow.pendingNonMemberNames}
        onDismiss={mentionSendFlow.dismissNonMemberPrompt}
        onDoNothing={mentionSendFlow.sendWithoutInviting}
        onInvite={mentionSendFlow.inviteNonMembers}
        open={mentionSendFlow.pendingNonMemberSend !== null}
      />

      {linkEditor.card}
      {linkEditor.dialog}
    </>
  );
}

export const MessageComposer = React.memo(MessageComposerImpl);
