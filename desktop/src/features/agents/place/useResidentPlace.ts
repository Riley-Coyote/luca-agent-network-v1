import { listen } from "@tauri-apps/api/event";
import * as React from "react";

import {
  getResidentPlace,
  listResidentPlaceWork,
  RESIDENT_PLACE_CONFLICT_PREFIX,
  setResidentPlaceEditing,
  type ResidentPlace,
  type ResidentPlaceContent,
  type ResidentPlaceWorkView,
  updateResidentPlace,
} from "@/shared/api/tauriResidentPlace";

type Draft = { content: ResidentPlaceContent; expectedRevision: number };

function copyContent(content: ResidentPlaceContent): ResidentPlaceContent {
  return {
    introduction: content.introduction,
    exploration: content.exploration,
    selectedWork: content.selectedWork ? { ...content.selectedWork } : null,
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isConflict(error: unknown): boolean {
  return errorText(error).includes(RESIDENT_PLACE_CONFLICT_PREFIX);
}

function isScopeChanged(error: unknown): boolean {
  return errorText(error).includes("resident-place-scope-changed");
}

function placeErrorMessage(error: unknown, fallback: string): string {
  const code = errorText(error).match(/resident-place-[a-z-]+/)?.[0];
  switch (code) {
    case "resident-place-invalid":
      return "This place couldn’t be saved. Check its text and selected work.";
    case "resident-place-unavailable":
      return "This private place is temporarily unavailable.";
    case "resident-place-corrupt":
      return "This private place couldn’t be read safely.";
    case "resident-place-resident-invalid":
    case "resident-place-resident-unmanaged":
    case "resident-place-resident-not-local":
    case "resident-place-resident-relay-mismatch":
      return "This resident doesn’t have a private place in this workspace.";
    case "resident-place-scope-changed":
      return "Your account or workspace changed. Open this resident again.";
    case "resident-place-work-unavailable":
    case "resident-place-work-conversation-mismatch":
    case "resident-place-conversation-unavailable":
      return "That work version is no longer available here. Choose another version.";
    case "resident-place-conversation-private-required":
      return "Selected work must come from a private conversation with this resident.";
    case "resident-place-authoring-disabled":
      return "Resident editing is turned off for this place.";
    default:
      return fallback;
  }
}

/** A local, scope-bound editor. A keyed caller remounts this on owner/workspace changes. */
export function useResidentPlace(residentPubkey: string) {
  const [place, setPlace] = React.useState<ResidentPlace | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [switching, setSwitching] = React.useState(false);
  const [work, setWork] = React.useState<ResidentPlaceWorkView[] | null>(null);
  const [workLoading, setWorkLoading] = React.useState(false);
  const [workError, setWorkError] = React.useState<string | null>(null);
  const alive = React.useRef(false);
  const readSerial = React.useRef(0);
  const workSerial = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const serial = ++readSerial.current;
    try {
      const next = await getResidentPlace(residentPubkey);
      if (!alive.current || serial !== readSerial.current) return null;
      setPlace(next);
      setReadError(null);
      setLoading(false);
      return next;
    } catch (error) {
      if (!alive.current || serial !== readSerial.current) return null;
      if (isScopeChanged(error)) {
        setPlace(null);
        setDraft(null);
      }
      setReadError(placeErrorMessage(error, "Couldn’t load this place."));
      setLoading(false);
      return null;
    }
  }, [residentPubkey]);

  React.useEffect(() => {
    alive.current = true;
    void refresh();
    const subscription = listen<{ residentPubkey: string }>(
      "luca://resident-place-changed",
      ({ payload }) => {
        if (alive.current && payload?.residentPubkey === residentPubkey)
          void refresh();
      },
    ).catch(() => () => {});
    return () => {
      alive.current = false;
      readSerial.current++;
      workSerial.current++;
      void subscription
        .then((unlisten) => unlisten())
        .catch(() => {
          // The event bridge may already have closed during a workspace switch.
        });
    };
  }, [refresh, residentPubkey]);

  const beginEdit = React.useCallback(() => {
    if (!place) return;
    setDraft({
      content: copyContent(place.content),
      expectedRevision: place.revision,
    });
    setConflict(false);
    setSaveError(null);
    setWork(null);
    setWorkError(null);
  }, [place]);

  const cancelEdit = React.useCallback(() => {
    if (saving) return;
    setDraft(null);
    setConflict(false);
    setSaveError(null);
    setWork(null);
  }, [saving]);

  const changeContent = React.useCallback((content: ResidentPlaceContent) => {
    setDraft((current) => (current ? { ...current, content } : null));
    setSaveError(null);
  }, []);

  const save = React.useCallback(async () => {
    if (
      !draft ||
      saving ||
      conflict ||
      place?.revision !== draft.expectedRevision ||
      draft.content.introduction.length > 1200 ||
      draft.content.exploration.length > 1600
    )
      return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await updateResidentPlace(residentPubkey, {
        expectedRevision: draft.expectedRevision,
        content: draft.content,
      });
      if (!alive.current) return;
      readSerial.current++;
      setPlace(next);
      setDraft(null);
      setConflict(false);
    } catch (error) {
      if (!alive.current) return;
      if (isScopeChanged(error)) {
        setPlace(null);
        setDraft(null);
      }
      if (isConflict(error)) {
        setConflict(true);
        setSaveError(
          "This place changed since you started editing. Your draft is still here.",
        );
        void refresh();
      } else {
        setSaveError(placeErrorMessage(error, "Couldn’t save this place."));
      }
    } finally {
      if (alive.current) setSaving(false);
    }
  }, [conflict, draft, place?.revision, refresh, residentPubkey, saving]);

  const reloadLatest = React.useCallback(async () => {
    setLoading(true);
    const latest = await refresh();
    if (!latest || !alive.current) return;
    setDraft({
      content: copyContent(latest.content),
      expectedRevision: latest.revision,
    });
    setConflict(false);
    setSaveError(null);
    setWork(null);
  }, [refresh]);

  const toggleEditing = React.useCallback(async () => {
    if (!place || switching || draft) return;
    setSwitching(true);
    setSaveError(null);
    try {
      const next = await setResidentPlaceEditing(
        residentPubkey,
        place.revision,
        !place.residentEditingEnabled,
      );
      if (!alive.current) return;
      readSerial.current++;
      setPlace(next);
    } catch (error) {
      if (!alive.current) return;
      if (isScopeChanged(error)) {
        setPlace(null);
        setDraft(null);
      }
      setSaveError(
        isConflict(error)
          ? "This place changed. The latest version is loading; try again after reviewing it."
          : placeErrorMessage(error, "Couldn’t change resident editing."),
      );
      if (isConflict(error)) void refresh();
    } finally {
      if (alive.current) setSwitching(false);
    }
  }, [draft, place, refresh, residentPubkey, switching]);

  const loadWork = React.useCallback(async () => {
    const serial = ++workSerial.current;
    setWorkLoading(true);
    setWorkError(null);
    try {
      const choices = await listResidentPlaceWork(residentPubkey);
      if (!alive.current || serial !== workSerial.current) return;
      setWork(choices.slice(0, 100));
    } catch (error) {
      if (!alive.current || serial !== workSerial.current) return;
      setWorkError(placeErrorMessage(error, "Couldn’t load eligible work."));
    } finally {
      if (alive.current && serial === workSerial.current) setWorkLoading(false);
    }
  }, [residentPubkey]);

  return {
    place,
    loading,
    readError,
    draft,
    saveError,
    conflict,
    saving,
    switching,
    work,
    workLoading,
    workError,
    refresh,
    beginEdit,
    cancelEdit,
    changeContent,
    save,
    reloadLatest,
    toggleEditing,
    loadWork,
  };
}
