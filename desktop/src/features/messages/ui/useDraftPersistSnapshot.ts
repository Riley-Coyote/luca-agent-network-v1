import * as React from "react";

import type { ImetaMedia } from "@/features/messages/lib/imetaMediaMarkdown";
import type {
  DraftMentionRef,
  DraftState,
} from "@/features/messages/lib/useDrafts";

type UseDraftPersistLifecycleParams = {
  effectiveDraftKey: string | null | undefined;
  channelId: string | null | undefined;
  /** Load a saved draft from the store. */
  loadDraft: (draftKey: string) => DraftState | undefined;
  /** Persist the current draft to the existing owner/relay-scoped store. */
  persistDraft: (
    draftKey: string,
    content: string,
    channelId: string,
    pendingImeta: ImetaMedia[],
    spoileredAttachmentUrls: string[],
    mentionRefs: DraftMentionRef[],
  ) => void;
  /** Snapshot selected mention identities still present in current content. */
  getMentionRefs: (content: string) => DraftMentionRef[];
  /** Replace mention routing/highlight state when a draft is restored or cleared. */
  restoreMentionRefs: (refs: readonly DraftMentionRef[]) => void;
  /** An edit temporarily replaces the editor; retain the original draft. */
  getDraftBeforeEdit?: (
    draftKey: string,
  ) => Pick<
    DraftState,
    "content" | "pendingImeta" | "spoileredAttachmentUrls" | "mentionRefs"
  > | null;
  /** Live `pendingImeta` from React state — used for render-time ref sync. */
  livePendingImeta: ImetaMedia[];
  /** Async setter for pendingImeta — called after the synchronous snapshot. */
  setPendingImeta: (imeta: ImetaMedia[]) => void;
  /** Set the rich-text editor content from a draft string. */
  setContent: (content: string) => void;
  /** Clear the rich-text editor content (no-draft path). */
  clearContent: () => void;
  /** Set the spoilered attachment URLs state. */
  setSpoileredAttachmentUrls: (urls: Set<string>) => void;
  /**
   * Stable ref to the spoilered attachment URLs — read in the cleanup closure
   * so it always captures the latest value at cleanup time.
   */
  spoileredAttachmentUrlsRef: React.MutableRefObject<Set<string>>;
  /**
   * Read the current editor content synchronously — called in the cleanup
   * closure to capture the latest text before the effect fires.
   */
  syncComposerContentFromEditor: () => string;
};

/**
 * Owns draft restoration, scheduled saves, and lifecycle flushes for
 * `MessageComposer`. The returned callback schedules a save without reading
 * or serializing the editor on the typing path.
 *
 * This hook:
 * - Holds `pendingImetaForPersistRef` — the ref the cleanup reads when
 *   persisting `pendingImeta` to the draft store.
 * - Updates that ref on every render (render-time passive path) so normal
 *   add/remove-image operations are always captured.
 * - Runs a `useEffect` keyed on `effectiveDraftKey` that restores a saved
 *   draft into the composer (content + imeta + spoilered urls) or clears it,
 *   and whose cleanup persists the outgoing draft before the key changes.
 * - Saves at most once per 300 ms during updates, and flushes synchronously
 *   when the document hides, unloads, or the composer unmounts. Reload/quit
 *   does not reliably run React cleanup.
 *
 * **The StrictMode fix lives here.**
 * When the restore effect body calls `setPendingImeta(saved.pendingImeta)`,
 * that state update is async — it won't commit until React re-renders.
 * React StrictMode (dev builds) simulates an unmount immediately after the
 * effect body, before the re-render. Without the synchronous write the
 * cleanup would read `[]` and overwrite the just-restored images.
 *
 * The effect body calls `snapshotPendingImeta` (the synchronous ref write)
 * BEFORE `setPendingImeta`, so the cleanup always sees the correct value.
 *
 * Extracted from `MessageComposer` so the full lifecycle can be exercised
 * directly in a StrictMode test without mounting the full composer.
 */
export function useDraftPersistLifecycle({
  effectiveDraftKey,
  channelId,
  loadDraft,
  persistDraft,
  getMentionRefs,
  restoreMentionRefs,
  getDraftBeforeEdit,
  livePendingImeta,
  setPendingImeta,
  setContent,
  clearContent,
  setSpoileredAttachmentUrls,
  spoileredAttachmentUrlsRef,
  syncComposerContentFromEditor,
}: UseDraftPersistLifecycleParams): () => void {
  const pendingImetaForPersistRef = React.useRef<ImetaMedia[]>([]);
  const schedulePersistRef = React.useRef<() => void>(() => {});
  const schedulePersist = React.useCallback(
    () => schedulePersistRef.current(),
    [],
  );
  // Render-time update: keep the ref in sync with committed state so the
  // cleanup always reads the latest value during normal mounted operation.
  pendingImetaForPersistRef.current = livePendingImeta;

  // biome-ignore lint/correctness/useExhaustiveDependencies: effectiveDraftKey is the sole trigger
  React.useEffect(() => {
    // The outgoing draft is persisted by the cleanup below, which runs before
    // this body on key changes and has the correct outgoing channelId in its
    // closure. Do NOT re-persist prevKey here: channelId in this render
    // already reflects the incoming channel, which would corrupt the outgoing
    // draft's channelId metadata.

    const saved = effectiveDraftKey ? loadDraft(effectiveDraftKey) : undefined;
    if (saved) {
      setContent(saved.content);
      restoreMentionRefs(saved.mentionRefs ?? []);
      // Set the persist-snapshot ref SYNCHRONOUSLY before calling the async
      // state setter, so the cleanup closure (which may fire before the state
      // update commits in React StrictMode's simulate-unmount pass) reads the
      // correct value instead of the stale [].
      pendingImetaForPersistRef.current = saved.pendingImeta;
      setPendingImeta(saved.pendingImeta);
      spoileredAttachmentUrlsRef.current = new Set(
        saved.spoileredAttachmentUrls,
      );
      setSpoileredAttachmentUrls(spoileredAttachmentUrlsRef.current);
    } else {
      clearContent();
      restoreMentionRefs([]);
      // Same synchronous snapshot on the empty path.
      pendingImetaForPersistRef.current = [];
      setPendingImeta([]);
      spoileredAttachmentUrlsRef.current = new Set();
      setSpoileredAttachmentUrls(spoileredAttachmentUrlsRef.current);
    }

    let pendingSave: ReturnType<typeof setTimeout> | null = null;
    const flushDraft = () => {
      if (pendingSave !== null) {
        clearTimeout(pendingSave);
        pendingSave = null;
      }
      if (effectiveDraftKey) {
        const beforeEdit = getDraftBeforeEdit?.(effectiveDraftKey);
        // Read at flush time, never from the triggering keystroke: a send or
        // clear may have emptied the composer while a save was queued.
        const content = beforeEdit?.content ?? syncComposerContentFromEditor();
        persistDraft(
          effectiveDraftKey,
          content,
          channelId ?? effectiveDraftKey,
          [...(beforeEdit?.pendingImeta ?? pendingImetaForPersistRef.current)],
          [
            ...(beforeEdit?.spoileredAttachmentUrls ??
              spoileredAttachmentUrlsRef.current),
          ],
          beforeEdit ? (beforeEdit.mentionRefs ?? []) : getMentionRefs(content),
        );
      }
    };
    schedulePersistRef.current = () => {
      if (effectiveDraftKey && pendingSave === null) {
        pendingSave = setTimeout(flushDraft, 300);
      }
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushDraft();
    };
    window.addEventListener("pagehide", flushDraft);
    window.addEventListener("beforeunload", flushDraft);
    document.addEventListener("visibilitychange", flushWhenHidden);

    return () => {
      schedulePersistRef.current = () => {};
      window.removeEventListener("pagehide", flushDraft);
      window.removeEventListener("beforeunload", flushDraft);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      flushDraft();
    };
  }, [effectiveDraftKey]);

  return schedulePersist;
}
