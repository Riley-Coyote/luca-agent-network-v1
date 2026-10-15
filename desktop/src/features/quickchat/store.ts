export type QuickChatRoom = {
  channelId: string | null;
  ready: boolean;
  draft: string;
  scrollTop: number;
  effortPosition: number;
  effortChosen: boolean;
};
export type QuickChatState = {
  selectedPubkey: string | null;
  width: number;
  height: number;
  rooms: Record<string, QuickChatRoom>;
  companionRooms: Record<string, QuickChatRoom>;
};
export const emptyRoom = (): QuickChatRoom => ({
  channelId: null,
  ready: false,
  draft: "",
  scrollTop: 0,
  effortPosition: 1,
  effortChosen: false,
});
export const emptyQuickChat = (): QuickChatState => ({
  selectedPubkey: null,
  width: 420,
  height: 560,
  rooms: {},
  companionRooms: {},
});
export function quickChatStorageKey(owner: string, community: string) {
  return `luca:quickchat:v1:${encodeURIComponent(community)}:${owner.toLowerCase()}`;
}
export function readQuickChat(
  storage: Pick<Storage, "getItem">,
  key: string,
): QuickChatState {
  try {
    const raw = JSON.parse(storage.getItem(key) ?? "null");
    if (!raw || typeof raw !== "object") return emptyQuickChat();
    const readRooms = (input: unknown) => {
      const rooms: Record<string, QuickChatRoom> = {};
      for (const [pubkey, value] of Object.entries(
        input && typeof input === "object" ? input : {},
      )) {
        const room = value as Partial<QuickChatRoom> | null;
        if (!room || !/^[a-f0-9]{64}$/i.test(pubkey)) continue;
        rooms[pubkey] = {
          effortChosen: room.effortChosen === true,
          effortPosition:
            typeof room.effortPosition === "number" &&
            Number.isFinite(room.effortPosition)
              ? Math.max(0, Math.min(3, room.effortPosition))
              : 1,
          channelId: typeof room.channelId === "string" ? room.channelId : null,
          ready: room.ready === true,
          draft: typeof room.draft === "string" ? room.draft : "",
          scrollTop:
            typeof room.scrollTop === "number" &&
            Number.isFinite(room.scrollTop)
              ? Math.max(0, room.scrollTop)
              : 0,
        };
      }
      return rooms;
    };
    return {
      selectedPubkey:
        typeof raw.selectedPubkey === "string" ? raw.selectedPubkey : null,
      width: Number.isFinite(raw.width)
        ? Math.max(340, Math.min(900, raw.width))
        : 420,
      height: Number.isFinite(raw.height)
        ? Math.max(380, Math.min(1000, raw.height))
        : 560,
      rooms: readRooms(raw.rooms),
      companionRooms: readRooms(raw.companionRooms),
    };
  } catch {
    return emptyQuickChat();
  }
}
export function updateQuickChatRoom(
  state: QuickChatState,
  pubkey: string,
  patch: Partial<QuickChatRoom>,
  companion = false,
): QuickChatState {
  const collection = companion ? "companionRooms" : "rooms";
  return {
    ...state,
    [collection]: {
      ...state[collection],
      [pubkey]: { ...(state[collection]?.[pubkey] ?? emptyRoom()), ...patch },
    },
  };
}
export function newQuickChat(
  state: QuickChatState,
  pubkey: string,
): QuickChatState {
  return { ...state, rooms: { ...state.rooms, [pubkey]: emptyRoom() } };
}
/** Retain the created channel before attachment so a failed setup retries it. */
export async function prepareQuickChatRoom(
  room: QuickChatRoom,
  create: () => Promise<string>,
  attach: (id: string) => Promise<unknown>,
  save: (patch: Partial<QuickChatRoom>) => void,
): Promise<string> {
  const id = room.channelId ?? (await create());
  if (!room.channelId) save({ channelId: id, ready: false });
  if (!room.ready) {
    await attach(id);
    save({ ready: true });
  }
  return id;
}
