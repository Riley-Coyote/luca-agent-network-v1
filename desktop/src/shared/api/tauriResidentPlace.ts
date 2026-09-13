import { invoke } from "@tauri-apps/api/core";

/** A pinned immutable work version, never a moving latest-version pointer. */
export type ResidentPlaceWork = { artifactId: string; version: number };
/** Deliberately authored presentation; never assembled into a runtime prompt. */
export type ResidentPlaceContent = {
  introduction: string;
  exploration: string;
  selectedWork: ResidentPlaceWork | null;
};
export type ResidentPlaceWorkView = ResidentPlaceWork & {
  title: string;
  kind: string;
  conversationId: string | null;
  availability: "available" | "unavailable";
};
export type ResidentPlace = {
  residentPubkey: string;
  revision: number;
  residentEditingEnabled: boolean;
  visibility: "private";
  content: ResidentPlaceContent;
  author: { kind: "owner" | "resident"; pubkey: string } | null;
  updatedAt: number | null;
  selectedWork: ResidentPlaceWorkView | null;
};
export type ResidentPlaceUpdate = {
  expectedRevision: number;
  content: ResidentPlaceContent;
};
export const RESIDENT_PLACE_CONFLICT_PREFIX = "resident_place_conflict:";
export function getResidentPlace(
  residentPubkey: string,
): Promise<ResidentPlace> {
  return invoke("get_resident_place", { residentPubkey });
}
export function updateResidentPlace(
  residentPubkey: string,
  input: ResidentPlaceUpdate,
): Promise<ResidentPlace> {
  return invoke("update_resident_place", { residentPubkey, input });
}
export function setResidentPlaceEditing(
  residentPubkey: string,
  expectedRevision: number,
  enabled: boolean,
): Promise<ResidentPlace> {
  return invoke("set_resident_place_editing", {
    residentPubkey,
    expectedRevision,
    enabled,
  });
}
export function listResidentPlaceWork(
  residentPubkey: string,
): Promise<ResidentPlaceWorkView[]> {
  return invoke("list_resident_place_work", { residentPubkey });
}
