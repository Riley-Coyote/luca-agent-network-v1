/**
 * The notebook's reading position belongs to the owner, not to a notebook
 * record. Keep this deliberately small: ids and named anchors only.
 */
export type NotebookView = "notes" | "pages";

export type NotebookViewScope = {
  ownerPubkey: string;
  workspaceId: string;
  residentPubkey: string;
};

export type NotebookViewState = {
  version: 1;
  view: NotebookView;
  selected: { itemId: string; revision: number | null } | null;
  listAnchor: string | null;
  detailAnchor: "body" | "sources" | "annotations" | "history" | null;
  updatedAt: number;
};

const PREFIX = "luca.notebook-view.v1:";
const MAX_SCOPED_ENTRIES = 40;
const MAX_SERIALIZED_BYTES = 900;

export const EMPTY_NOTEBOOK_VIEW_STATE: Omit<NotebookViewState, "updatedAt"> = {
  version: 1,
  view: "notes",
  selected: null,
  listAnchor: null,
  detailAnchor: null,
};

function normalizeScopePart(value: string): string {
  return value.trim().toLowerCase();
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function validRevision(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0)
  );
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function notebookViewStorageKey(scope: NotebookViewScope): string {
  return `${PREFIX}${encodeURIComponent(normalizeScopePart(scope.ownerPubkey))}:${encodeURIComponent(normalizeScopePart(scope.workspaceId))}:${encodeURIComponent(normalizeScopePart(scope.residentPubkey))}`;
}

function parse(value: string | null): NotebookViewState | null {
  if (!value || value.length > MAX_SERIALIZED_BYTES) return null;
  try {
    const candidate: unknown = JSON.parse(value);
    if (!candidate || typeof candidate !== "object") return null;
    const state = candidate as Partial<NotebookViewState>;
    const selected = state.selected;
    const validSelected =
      selected === null ||
      (typeof selected === "object" &&
        selected !== null &&
        validId(selected.itemId) &&
        validRevision(selected.revision));
    const validDetailAnchor =
      state.detailAnchor === null ||
      state.detailAnchor === "body" ||
      state.detailAnchor === "sources" ||
      state.detailAnchor === "annotations" ||
      state.detailAnchor === "history";
    if (
      state.version !== 1 ||
      (state.view !== "notes" && state.view !== "pages") ||
      !validSelected ||
      (state.listAnchor !== null && !validId(state.listAnchor)) ||
      !validDetailAnchor ||
      typeof state.updatedAt !== "number" ||
      !Number.isFinite(state.updatedAt)
    ) {
      return null;
    }
    return {
      version: 1,
      view: state.view,
      selected,
      listAnchor: state.listAnchor,
      detailAnchor: state.detailAnchor ?? null,
      updatedAt: state.updatedAt,
    };
  } catch {
    return null;
  }
}

export function readNotebookViewState(
  scope: NotebookViewScope | null,
): NotebookViewState | null {
  if (!scope) return null;
  const localStorage = storage();
  if (!localStorage) return null;
  const key = notebookViewStorageKey(scope);
  try {
    const state = parse(localStorage.getItem(key));
    if (!state && localStorage.getItem(key) !== null)
      localStorage.removeItem(key);
    return state;
  } catch {
    return null;
  }
}

function prune(localStorage: Storage, keepKey: string): void {
  const entries: Array<{ key: string; updatedAt: number }> = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX) || key === keepKey) continue;
      const state = parse(localStorage.getItem(key));
      if (state) entries.push({ key, updatedAt: state.updatedAt });
      else localStorage.removeItem(key);
    }
    entries.sort((a, b) => a.updatedAt - b.updatedAt);
    const excess = Math.max(0, entries.length - (MAX_SCOPED_ENTRIES - 1));
    for (const entry of entries.slice(0, excess)) {
      localStorage.removeItem(entry.key);
    }
  } catch {
    // Storage can be disabled or revoked while the app is running.
  }
}

export function writeNotebookViewState(
  scope: NotebookViewScope | null,
  state: Omit<NotebookViewState, "updatedAt">,
): boolean {
  if (!scope) return false;
  const localStorage = storage();
  if (!localStorage) return false;
  const key = notebookViewStorageKey(scope);
  const value: NotebookViewState = {
    version: 1,
    view: state.view,
    selected: state.selected
      ? { itemId: state.selected.itemId, revision: state.selected.revision }
      : null,
    listAnchor: state.listAnchor,
    detailAnchor: state.detailAnchor,
    updatedAt: Date.now(),
  };
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_SERIALIZED_BYTES) return false;
  try {
    prune(localStorage, key);
    if (localStorage.getItem(key) !== serialized)
      localStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

export function isNotebookRequestCurrent(
  request: {
    residentPubkey: string;
    scopeKey: string | null;
    generation: number;
  },
  current: {
    residentPubkey: string;
    scopeKey: string | null;
    generation: number;
  },
): boolean {
  return (
    request.residentPubkey === current.residentPubkey &&
    request.scopeKey === current.scopeKey &&
    request.generation === current.generation
  );
}
