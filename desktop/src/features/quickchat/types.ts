export type QuickChatResident = {
  pubkey: string;
  name: string;
  detail?: string;
};
export type QuickChatMessage = {
  id: string;
  role: "owner" | "assistant";
  text: string;
  pending?: boolean;
};
export type QuickChatContext = {
  route: string;
  screen: string;
  capturedAt: string;
  text: string;
  targets: Array<{ id: string; label: string }>;
};
export type QuickChatImage = { dataUrl: string; name: string };
export type QuickChatEffort = {
  supported: boolean;
  configId?: string;
  values: Array<{ value: string; label: string }>;
  value: string | null;
  pending: boolean;
  reason?: string;
  /** Where the levels came from: this conversation's live runtime report, or
   * the last one it made, remembered across restarts. */
  source?: "runtime" | "remembered";
  /** True only when nothing has ever been reported for this conversation. */
  awaitingFirstReply?: boolean;
};
export type QuickChatViewModel = {
  channelId: string | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  residents: QuickChatResident[];
  selectedPubkey: string | null;
  selectResident: (pubkey: string) => void;
  messages: QuickChatMessage[];
  draft: string;
  setDraft: (text: string) => void;
  busy: boolean;
  error: string | null;
  send: () => Promise<void>;
  stop: () => void;
  newChat: () => void;
  openFullConversation: () => void;
  openAgentSetup: () => void;
  contextEnabled: boolean;
  setContextEnabled: (enabled: boolean) => void;
  context: QuickChatContext | null;
  refreshContext: () => void;
  image: QuickChatImage | null;
  setImage: (image: QuickChatImage | null) => void;
  capture: () => Promise<void>;
  capturing: boolean;
  effortPosition: number;
  setEffortPosition: (position: number) => void;
  effort: QuickChatEffort;
  setEffort: (value: string) => void;
  width: number;
  height: number;
  setSize: (width: number, height: number) => void;
  scrollTop: number;
  setScrollTop: (top: number) => void;
};
