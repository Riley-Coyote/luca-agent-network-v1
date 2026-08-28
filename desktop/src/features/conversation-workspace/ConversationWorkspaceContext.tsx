import * as React from "react";

import {
  createDefaultWorkspaceLayout,
  loadWorkspaceLayout,
  openConversationInNewPane,
  projectWorkspaceLayout,
  reconcileWorkspaceConversations,
  reduceWorkspaceLayout,
  saveWorkspaceLayout,
  type OpenInNewPaneResult,
  type WorkspaceConversationRef,
  type WorkspaceLayoutAction,
  type WorkspaceLayoutScope,
  type WorkspaceLayoutV1,
  type WorkspacePreset,
  type WorkspaceSlotId,
  workspaceLayoutStorageKey,
} from "./workspaceLayout";

export const OPEN_CONVERSATION_IN_PANE_EVENT = "luca:open-conversation-in-pane";

export type ConversationWorkspaceController = {
  layout: WorkspaceLayoutV1;
  dispatch: (action: WorkspaceLayoutAction) => void;
  focusSlot: (slotId: WorkspaceSlotId) => void;
  openInNewPane: (
    conversation: WorkspaceConversationRef,
  ) => OpenInNewPaneResult;
  replaceFocusedConversation: (conversation: WorkspaceConversationRef) => void;
  setPreset: (preset: WorkspacePreset) => void;
};

const ConversationWorkspaceContext =
  React.createContext<ConversationWorkspaceController | null>(null);

export function requestOpenConversationInNewPane(
  conversation: WorkspaceConversationRef,
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<WorkspaceConversationRef>(OPEN_CONVERSATION_IN_PANE_EVENT, {
      detail: conversation,
    }),
  );
}

export function useConversationWorkspaceController({
  availableConversations,
  scope,
}: {
  availableConversations: readonly WorkspaceConversationRef[] | null;
  scope: WorkspaceLayoutScope;
}): ConversationWorkspaceController {
  const ownerPubkey = scope.ownerPubkey;
  const workspaceId = scope.workspaceId;
  const stableScope = React.useMemo(
    () => ({ ownerPubkey, workspaceId }),
    [ownerPubkey, workspaceId],
  );
  const storageKey = workspaceLayoutStorageKey(stableScope);
  const [layout, setLayout] = React.useState(createDefaultWorkspaceLayout);
  const loadedStorageKeyRef = React.useRef<string | null>(null);
  const skipNextPersistRef = React.useRef(false);
  const layoutRef = React.useRef(layout);
  layoutRef.current = layout;

  React.useEffect(() => {
    if (!storageKey || typeof window === "undefined") {
      loadedStorageKeyRef.current = null;
      skipNextPersistRef.current = false;
      setLayout(createDefaultWorkspaceLayout());
      return;
    }
    const loaded = loadWorkspaceLayout(window.localStorage, stableScope);
    loadedStorageKeyRef.current = storageKey;
    skipNextPersistRef.current = true;
    layoutRef.current = loaded;
    setLayout(loaded);
  }, [stableScope, storageKey]);

  React.useEffect(() => {
    if (
      !storageKey ||
      loadedStorageKeyRef.current !== storageKey ||
      typeof window === "undefined"
    ) {
      return;
    }
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    saveWorkspaceLayout(window.localStorage, stableScope, layout);
  }, [layout, stableScope, storageKey]);

  React.useEffect(() => {
    if (availableConversations === null) return;
    setLayout((current) => {
      const next = reconcileWorkspaceConversations(
        current,
        availableConversations,
      );
      const result =
        JSON.stringify(next) === JSON.stringify(current) ? current : next;
      layoutRef.current = result;
      return result;
    });
  }, [availableConversations]);

  const dispatch = React.useCallback((action: WorkspaceLayoutAction) => {
    setLayout((current) => {
      const next = reduceWorkspaceLayout(current, action);
      layoutRef.current = next;
      return next;
    });
  }, []);

  const focusSlot = React.useCallback(
    (slotId: WorkspaceSlotId) => dispatch({ type: "focus-slot", slotId }),
    [dispatch],
  );

  const replaceFocusedConversation = React.useCallback(
    (conversation: WorkspaceConversationRef) =>
      dispatch({ type: "replace-active-tab", conversation }),
    [dispatch],
  );

  const setPreset = React.useCallback(
    (preset: WorkspacePreset) => dispatch({ type: "set-preset", preset }),
    [dispatch],
  );

  const openInNewPane = React.useCallback(
    (conversation: WorkspaceConversationRef) => {
      const result = openConversationInNewPane(layoutRef.current, conversation);
      if (result.layout !== layoutRef.current) {
        layoutRef.current = result.layout;
        setLayout(result.layout);
      }
      return result;
    },
    [],
  );

  return React.useMemo(
    () => ({
      dispatch,
      focusSlot,
      layout,
      openInNewPane,
      replaceFocusedConversation,
      setPreset,
    }),
    [
      dispatch,
      focusSlot,
      layout,
      openInNewPane,
      replaceFocusedConversation,
      setPreset,
    ],
  );
}

export function ConversationWorkspaceProvider({
  children,
  controller,
}: {
  children: React.ReactNode;
  controller: ConversationWorkspaceController;
}) {
  return (
    <ConversationWorkspaceContext.Provider value={controller}>
      {children}
    </ConversationWorkspaceContext.Provider>
  );
}

export function useConversationWorkspace() {
  return React.useContext(ConversationWorkspaceContext);
}

export function useConversationWorkspaceProjection(compact: boolean) {
  const workspace = useConversationWorkspace();
  return workspace ? projectWorkspaceLayout(workspace.layout, compact) : null;
}
