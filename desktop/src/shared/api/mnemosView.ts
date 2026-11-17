import { invoke } from "@tauri-apps/api/core";

export const mnemosSections = [
  "memories",
  "standing",
  "journal",
  "notes",
  "handoffs",
  "beliefs",
] as const;
export type MnemosSection = (typeof mnemosSections)[number];
export type ViewScope = {
  agent_id: string;
  person_id: string;
  project_scope: string;
};
export type ViewStatus = {
  grant: string | null;
  scope: ViewScope | null;
  readerReady: boolean;
  /** The resident remembers with the connected store, not only shown it. */
  linked: boolean;
  /** The person's own `mnemos` command is installed on this Mac. */
  mnemosReady: boolean;
};
/** One of the person's Mnemos minds on this Mac, offered for linking. */
export type MindChoice = {
  id: string;
  name: string;
  memories: number;
  /** The day of its newest memory, YYYY-MM-DD. */
  newest: string | null;
};
export type ViewItem = {
  text: string;
  clipped: boolean;
  author?: "agent" | "person";
};
export type ViewCounts = {
  memories: { active: number; dormant: number; archived: number };
  notes: { all: number; unread: number };
  standing: number;
  journal: number;
  handoffs: number;
  beliefs: number;
};
export type MnemosPage =
  | { kind: "summary"; counts: ViewCounts }
  | { kind: "items"; items: ViewItem[]; nextCursor: string | null };
export const mnemosView = {
  status: (residentPubkey: string) =>
    invoke<ViewStatus>("mnemos_view_status", { residentPubkey }),
  connect: (residentPubkey: string, scope: ViewScope) =>
    invoke<boolean>("connect_mnemos_view", { residentPubkey, scope }),
  minds: (residentPubkey: string) =>
    invoke<MindChoice[]>("mnemos_minds", { residentPubkey }),
  link: (residentPubkey: string, mind: string) =>
    invoke<boolean>("link_mnemos_mind", { residentPubkey, mind }),
  disconnect: (residentPubkey: string, grant: string) =>
    invoke<void>("disconnect_mnemos_view", { residentPubkey, grant }),
  read: (
    residentPubkey: string,
    grant: string,
    section: MnemosSection | "summary",
    cursor: string | null = null,
  ) =>
    invoke<MnemosPage>("read_mnemos_view", {
      residentPubkey,
      grant,
      section,
      cursor,
    }),
};
