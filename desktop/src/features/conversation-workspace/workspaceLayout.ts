export const WORKSPACE_LAYOUT_VERSION = 1 as const;

export const WORKSPACE_SLOT_IDS = [
  "slot-1",
  "slot-2",
  "slot-3",
  "slot-4",
] as const;

export type WorkspaceSlotId = (typeof WORKSPACE_SLOT_IDS)[number];

export type WorkspacePreset =
  | "single"
  | "columns-2"
  | "rows-2"
  | "three"
  | "grid-4";

export type WorkspaceConversationRef = {
  channelId: string;
  projectId?: string;
};

export type WorkspaceSlotV1 = {
  id: WorkspaceSlotId;
  conversations: WorkspaceConversationRef[];
  activeTab: WorkspaceConversationRef | null;
};

export type WorkspaceLayoutV1 = {
  version: typeof WORKSPACE_LAYOUT_VERSION;
  preset: WorkspacePreset;
  slots: [WorkspaceSlotV1, WorkspaceSlotV1, WorkspaceSlotV1, WorkspaceSlotV1];
  focusedSlotId: WorkspaceSlotId;
  visibility: "visible" | "hidden";
};

export type WorkspaceLayoutScope = {
  ownerPubkey?: string | null;
  workspaceId?: string | null;
};

export type WorkspaceLayoutStorage = Pick<Storage, "getItem" | "setItem">;

export type WorkspaceLayoutAction =
  | { type: "focus-slot"; slotId: WorkspaceSlotId }
  | {
      type: "replace-active-tab";
      conversation: WorkspaceConversationRef;
      slotId?: WorkspaceSlotId;
    }
  | {
      type: "select-tab";
      conversation: WorkspaceConversationRef;
      slotId: WorkspaceSlotId;
    }
  | {
      type: "close-tab";
      conversation: WorkspaceConversationRef;
      slotId: WorkspaceSlotId;
    }
  | { type: "set-preset"; preset: WorkspacePreset }
  | { type: "open-in-new-pane"; conversation: WorkspaceConversationRef }
  | { type: "hide" }
  | { type: "restore" };

export type OpenInNewPaneResult = {
  layout: WorkspaceLayoutV1;
  opened: boolean;
  reason: "maximum-panes" | null;
  slotId: WorkspaceSlotId | null;
};

export type WorkspaceLayoutProjection = {
  focusedSlotId: WorkspaceSlotId;
  hidden: boolean;
  preset: WorkspacePreset;
  visibleSlotIds: WorkspaceSlotId[];
};

const STORAGE_PREFIX = "luca.conversation-workspace.v1";
const OWNER_PUBKEY_PATTERN = /^[0-9a-f]{64}$/;
const PRESETS = new Set<WorkspacePreset>([
  "single",
  "columns-2",
  "rows-2",
  "three",
  "grid-4",
]);

const PRESET_SLOT_IDS: Record<WorkspacePreset, readonly WorkspaceSlotId[]> = {
  single: ["slot-1"],
  "columns-2": ["slot-1", "slot-2"],
  "rows-2": ["slot-1", "slot-2"],
  three: ["slot-1", "slot-2", "slot-3"],
  "grid-4": WORKSPACE_SLOT_IDS,
};

function emptySlot(id: WorkspaceSlotId): WorkspaceSlotV1 {
  return { id, conversations: [], activeTab: null };
}

function emptySlots(): WorkspaceLayoutV1["slots"] {
  return WORKSPACE_SLOT_IDS.map(emptySlot) as WorkspaceLayoutV1["slots"];
}

export function createDefaultWorkspaceLayout(): WorkspaceLayoutV1 {
  return {
    version: WORKSPACE_LAYOUT_VERSION,
    preset: "single",
    slots: emptySlots(),
    focusedSlotId: "slot-1",
    visibility: "visible",
  };
}

export function workspaceLayoutStorageKey({
  ownerPubkey,
  workspaceId,
}: WorkspaceLayoutScope): string | null {
  const owner = ownerPubkey?.trim().toLowerCase() ?? "";
  const workspace = workspaceId?.trim() ?? "";
  if (!OWNER_PUBKEY_PATTERN.test(owner) || workspace.length === 0) return null;
  return `${STORAGE_PREFIX}:${owner}:${encodeURIComponent(workspace)}`;
}

export function workspaceConversationKey(
  conversation: WorkspaceConversationRef,
): string {
  return JSON.stringify([
    conversation.projectId ?? null,
    conversation.channelId,
  ]);
}

export function workspaceConversationEquals(
  left: WorkspaceConversationRef | null | undefined,
  right: WorkspaceConversationRef | null | undefined,
): boolean {
  return (
    left != null &&
    right != null &&
    left.channelId === right.channelId &&
    (left.projectId ?? null) === (right.projectId ?? null)
  );
}

function parseConversationRef(value: unknown): WorkspaceConversationRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const channelId = (value as { channelId?: unknown }).channelId;
  const projectId = (value as { projectId?: unknown }).projectId;
  if (typeof channelId !== "string" || channelId.trim().length === 0) {
    return null;
  }
  if (projectId != null && typeof projectId !== "string") return null;

  const normalizedProjectId = projectId?.trim();
  return normalizedProjectId
    ? { channelId: channelId.trim(), projectId: normalizedProjectId }
    : { channelId: channelId.trim() };
}

function dedupeConversations(
  conversations: readonly WorkspaceConversationRef[],
): WorkspaceConversationRef[] {
  const seen = new Set<string>();
  return conversations.filter((conversation) => {
    const key = workspaceConversationKey(conversation);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseSlot(value: unknown, id: WorkspaceSlotId): WorkspaceSlotV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptySlot(id);
  }
  const conversations = dedupeConversations(
    Array.isArray((value as { conversations?: unknown }).conversations)
      ? (value as { conversations: unknown[] }).conversations.flatMap(
          (conversation) => {
            const parsed = parseConversationRef(conversation);
            return parsed ? [parsed] : [];
          },
        )
      : [],
  );
  const requestedActive = parseConversationRef(
    (value as { activeTab?: unknown }).activeTab,
  );
  const activeTab =
    conversations.find((conversation) =>
      workspaceConversationEquals(conversation, requestedActive),
    ) ??
    conversations[0] ??
    null;
  return { id, conversations, activeTab };
}

function isPreset(value: unknown): value is WorkspacePreset {
  return typeof value === "string" && PRESETS.has(value as WorkspacePreset);
}

function isSlotId(value: unknown): value is WorkspaceSlotId {
  return (
    typeof value === "string" &&
    (WORKSPACE_SLOT_IDS as readonly string[]).includes(value)
  );
}

function canonicalizeWorkspaceLayout(value: unknown): WorkspaceLayoutV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultWorkspaceLayout();
  }
  const record = value as Record<string, unknown>;
  if (record.version !== WORKSPACE_LAYOUT_VERSION || !isPreset(record.preset)) {
    return createDefaultWorkspaceLayout();
  }

  const rawSlots = Array.isArray(record.slots) ? record.slots : [];
  const slotById = new Map<string, unknown>();
  for (const candidate of rawSlots) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      continue;
    }
    const id = (candidate as { id?: unknown }).id;
    if (typeof id === "string" && !slotById.has(id))
      slotById.set(id, candidate);
  }
  const slots = WORKSPACE_SLOT_IDS.map((id) =>
    parseSlot(slotById.get(id), id),
  ) as WorkspaceLayoutV1["slots"];
  const visibleSlotIds = PRESET_SLOT_IDS[record.preset];
  const requestedFocus = isSlotId(record.focusedSlotId)
    ? record.focusedSlotId
    : null;
  const focusedSlotId =
    requestedFocus && visibleSlotIds.includes(requestedFocus)
      ? requestedFocus
      : (visibleSlotIds[0] ?? "slot-1");

  // Inactive slots are intentionally empty. Preset reduction moves their tabs
  // into a surviving slot before persistence, so stale hidden copies are never
  // resurrected when the workspace expands again.
  for (const slot of slots) {
    if (!visibleSlotIds.includes(slot.id)) {
      slot.conversations = [];
      slot.activeTab = null;
    }
  }

  return {
    version: WORKSPACE_LAYOUT_VERSION,
    preset: record.preset,
    slots,
    focusedSlotId,
    visibility: record.visibility === "hidden" ? "hidden" : "visible",
  };
}

export function parseWorkspaceLayout(
  rawValue: string | null | undefined,
): WorkspaceLayoutV1 {
  if (!rawValue) return createDefaultWorkspaceLayout();
  try {
    return canonicalizeWorkspaceLayout(JSON.parse(rawValue));
  } catch {
    return createDefaultWorkspaceLayout();
  }
}

export function loadWorkspaceLayout(
  storage: WorkspaceLayoutStorage,
  scope: WorkspaceLayoutScope,
): WorkspaceLayoutV1 {
  const key = workspaceLayoutStorageKey(scope);
  if (!key) return createDefaultWorkspaceLayout();
  try {
    return parseWorkspaceLayout(storage.getItem(key));
  } catch {
    return createDefaultWorkspaceLayout();
  }
}

export function saveWorkspaceLayout(
  storage: WorkspaceLayoutStorage,
  scope: WorkspaceLayoutScope,
  layout: WorkspaceLayoutV1,
): boolean {
  const key = workspaceLayoutStorageKey(scope);
  if (!key) return false;
  try {
    storage.setItem(key, JSON.stringify(canonicalizeWorkspaceLayout(layout)));
    return true;
  } catch {
    return false;
  }
}

export function workspaceSlot(
  layout: WorkspaceLayoutV1,
  slotId: WorkspaceSlotId,
): WorkspaceSlotV1 {
  return layout.slots[WORKSPACE_SLOT_IDS.indexOf(slotId)];
}

function cloneLayout(layout: WorkspaceLayoutV1): WorkspaceLayoutV1 {
  return {
    ...layout,
    slots: layout.slots.map((slot) => ({
      ...slot,
      conversations: slot.conversations.map((conversation) => ({
        ...conversation,
      })),
      activeTab: slot.activeTab ? { ...slot.activeTab } : null,
    })) as WorkspaceLayoutV1["slots"],
  };
}

function targetSlotId(
  layout: WorkspaceLayoutV1,
  requested?: WorkspaceSlotId,
): WorkspaceSlotId {
  const visible = PRESET_SLOT_IDS[layout.preset];
  if (requested && visible.includes(requested)) return requested;
  return visible.includes(layout.focusedSlotId)
    ? layout.focusedSlotId
    : (visible[0] ?? "slot-1");
}

function replaceActiveTab(
  layout: WorkspaceLayoutV1,
  conversation: WorkspaceConversationRef,
  requestedSlotId?: WorkspaceSlotId,
): WorkspaceLayoutV1 {
  const next = cloneLayout(layout);
  const slotId = targetSlotId(next, requestedSlotId);
  const slot = workspaceSlot(next, slotId);
  const normalized = parseConversationRef(conversation);
  if (!normalized) return layout;

  const activeIndex = slot.conversations.findIndex((candidate) =>
    workspaceConversationEquals(candidate, slot.activeTab),
  );
  const existingIndex = slot.conversations.findIndex((candidate) =>
    workspaceConversationEquals(candidate, normalized),
  );
  if (existingIndex >= 0) {
    if (activeIndex >= 0 && activeIndex !== existingIndex) {
      slot.conversations.splice(activeIndex, 1);
    }
  } else if (activeIndex >= 0) {
    slot.conversations.splice(activeIndex, 1, normalized);
  } else {
    slot.conversations.push(normalized);
  }
  slot.activeTab = normalized;
  next.focusedSlotId = slotId;
  return next;
}

function selectTab(
  layout: WorkspaceLayoutV1,
  slotId: WorkspaceSlotId,
  conversation: WorkspaceConversationRef,
): WorkspaceLayoutV1 {
  if (!PRESET_SLOT_IDS[layout.preset].includes(slotId)) return layout;
  const slot = workspaceSlot(layout, slotId);
  const selected = slot.conversations.find((candidate) =>
    workspaceConversationEquals(candidate, conversation),
  );
  if (!selected) return layout;
  const next = cloneLayout(layout);
  workspaceSlot(next, slotId).activeTab = { ...selected };
  next.focusedSlotId = slotId;
  return next;
}

function closeTab(
  layout: WorkspaceLayoutV1,
  slotId: WorkspaceSlotId,
  conversation: WorkspaceConversationRef,
): WorkspaceLayoutV1 {
  const slot = workspaceSlot(layout, slotId);
  const closedIndex = slot.conversations.findIndex((candidate) =>
    workspaceConversationEquals(candidate, conversation),
  );
  if (closedIndex < 0) return layout;

  const next = cloneLayout(layout);
  const nextSlot = workspaceSlot(next, slotId);
  nextSlot.conversations.splice(closedIndex, 1);
  if (workspaceConversationEquals(nextSlot.activeTab, conversation)) {
    nextSlot.activeTab =
      nextSlot.conversations[
        Math.min(closedIndex, nextSlot.conversations.length - 1)
      ] ?? null;
  }
  return next;
}

function mergeUnique(
  target: WorkspaceConversationRef[],
  additions: readonly WorkspaceConversationRef[],
): WorkspaceConversationRef[] {
  return dedupeConversations([...target, ...additions]);
}

export function setWorkspacePreset(
  layout: WorkspaceLayoutV1,
  preset: WorkspacePreset,
): WorkspaceLayoutV1 {
  if (layout.preset === preset) return layout;
  const next = cloneLayout(layout);
  const oldVisible = PRESET_SLOT_IDS[layout.preset];
  const nextVisible = PRESET_SLOT_IDS[preset];
  const focusedSurvives = nextVisible.includes(layout.focusedSlotId);
  const destinationId = focusedSurvives
    ? layout.focusedSlotId
    : (nextVisible[0] ?? "slot-1");
  const priorFocusedActive = workspaceSlot(
    layout,
    layout.focusedSlotId,
  ).activeTab;
  const destination = workspaceSlot(next, destinationId);

  for (const slotId of oldVisible) {
    if (nextVisible.includes(slotId)) continue;
    const removed = workspaceSlot(next, slotId);
    destination.conversations = mergeUnique(
      destination.conversations,
      removed.conversations,
    );
    removed.conversations = [];
    removed.activeTab = null;
  }

  if (!focusedSurvives && priorFocusedActive) {
    destination.activeTab =
      destination.conversations.find((conversation) =>
        workspaceConversationEquals(conversation, priorFocusedActive),
      ) ?? destination.activeTab;
  }
  if (!destination.activeTab && destination.conversations.length > 0) {
    destination.activeTab = destination.conversations[0] ?? null;
  }
  next.preset = preset;
  next.focusedSlotId = destinationId;
  return next;
}

function expandedPreset(preset: WorkspacePreset): WorkspacePreset | null {
  switch (preset) {
    case "single":
      return "columns-2";
    case "columns-2":
    case "rows-2":
      return "three";
    case "three":
      return "grid-4";
    case "grid-4":
      return null;
  }
}

export function openConversationInNewPane(
  layout: WorkspaceLayoutV1,
  conversation: WorkspaceConversationRef,
): OpenInNewPaneResult {
  const normalized = parseConversationRef(conversation);
  if (!normalized) {
    return { layout, opened: false, reason: null, slotId: null };
  }

  for (const slotId of PRESET_SLOT_IDS[layout.preset]) {
    const existing = workspaceSlot(layout, slotId).conversations.find(
      (candidate) => workspaceConversationEquals(candidate, normalized),
    );
    if (existing) {
      return {
        layout: selectTab(layout, slotId, existing),
        opened: true,
        reason: null,
        slotId,
      };
    }
  }

  let next = layout;
  let visible = PRESET_SLOT_IDS[next.preset];
  let emptyId = visible.find(
    (slotId) => workspaceSlot(next, slotId).conversations.length === 0,
  );
  if (!emptyId) {
    const nextPreset = expandedPreset(next.preset);
    if (!nextPreset) {
      return {
        layout,
        opened: false,
        reason: "maximum-panes",
        slotId: null,
      };
    }
    next = setWorkspacePreset(next, nextPreset);
    visible = PRESET_SLOT_IDS[next.preset];
    emptyId = visible.find(
      (slotId) => workspaceSlot(next, slotId).conversations.length === 0,
    );
  }
  if (!emptyId) {
    return {
      layout,
      opened: false,
      reason: "maximum-panes",
      slotId: null,
    };
  }

  next = cloneLayout(next);
  const slot = workspaceSlot(next, emptyId);
  slot.conversations = [normalized];
  slot.activeTab = normalized;
  next.focusedSlotId = emptyId;
  return { layout: next, opened: true, reason: null, slotId: emptyId };
}

export function reduceWorkspaceLayout(
  layout: WorkspaceLayoutV1,
  action: WorkspaceLayoutAction,
): WorkspaceLayoutV1 {
  switch (action.type) {
    case "focus-slot": {
      if (!PRESET_SLOT_IDS[layout.preset].includes(action.slotId))
        return layout;
      if (layout.focusedSlotId === action.slotId) return layout;
      return { ...layout, focusedSlotId: action.slotId };
    }
    case "replace-active-tab":
      return replaceActiveTab(layout, action.conversation, action.slotId);
    case "select-tab":
      return selectTab(layout, action.slotId, action.conversation);
    case "close-tab":
      return closeTab(layout, action.slotId, action.conversation);
    case "set-preset":
      return setWorkspacePreset(layout, action.preset);
    case "open-in-new-pane":
      return openConversationInNewPane(layout, action.conversation).layout;
    case "hide":
      return layout.visibility === "hidden"
        ? layout
        : { ...layout, visibility: "hidden" };
    case "restore":
      return layout.visibility === "visible"
        ? layout
        : { ...layout, visibility: "visible" };
  }
}

export function reconcileWorkspaceConversations(
  layout: WorkspaceLayoutV1,
  availableConversations: readonly WorkspaceConversationRef[],
): WorkspaceLayoutV1 {
  const available = new Set(
    availableConversations.map(workspaceConversationKey),
  );
  const next = cloneLayout(layout);
  for (const slot of next.slots) {
    slot.conversations = slot.conversations.filter((conversation) =>
      available.has(workspaceConversationKey(conversation)),
    );
    if (
      !slot.activeTab ||
      !slot.conversations.some((conversation) =>
        workspaceConversationEquals(conversation, slot.activeTab),
      )
    ) {
      slot.activeTab = slot.conversations[0] ?? null;
    }
  }
  return next;
}

export function projectWorkspaceLayout(
  layout: WorkspaceLayoutV1,
  compact: boolean,
): WorkspaceLayoutProjection {
  const hidden = layout.visibility === "hidden";
  return {
    focusedSlotId: layout.focusedSlotId,
    hidden,
    preset: compact ? "single" : layout.preset,
    visibleSlotIds: hidden
      ? []
      : compact
        ? [layout.focusedSlotId]
        : [...PRESET_SLOT_IDS[layout.preset]],
  };
}
