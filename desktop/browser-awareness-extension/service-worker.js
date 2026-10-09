"use strict";

const BROWSER_PROTOCOL = "polyphonic.browser-awareness.v1";
const NATIVE_HOST = "chat.polyphonic.browser_awareness";
const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_EXCERPT_BYTES = 4096;
const KINDS = ["visit", "bookmark", "excerpt"];
const encoder = new TextEncoder();

function safeUrl(value) {
  try {
    if (typeof value !== "string" || encoder.encode(value).length > 4096) return null;
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (url.pathname.includes("%")) return null;
    const path = url.pathname.toLowerCase();
    if (/(?:^|\/)(?:login|log-in|signin|sign-in|auth|oauth|callback|password|reset-password|credentials|checkout|payment)(?:\/|$)/.test(path)) return null;
    url.search = "";
    url.hash = "";
    return encoder.encode(url.href).length <= 2048 ? url.href : null;
  } catch { return null; }
}

function safeOrigin(value) {
  const sanitized = safeUrl(value);
  return sanitized ? new URL(sanitized).origin : null;
}

function sensitiveText(value) {
  return /(?:bearer\s+|api[ _-]?key|private[ _-]?key|password\s*[:=]|secret\s*[:=]|nsec1[a-z0-9]+|sk-[a-z0-9]{16,})/i.test(value);
}

function validEvent(event) {
  if (!event || !KINDS.includes(event.kind) || !safeUrl(event.url) || safeUrl(event.url) !== event.url) return false;
  if (event.incognito !== false || event.credential_context !== false || event.excluded !== false || event.scope_verified !== true) return false;
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1 || !Number.isSafeInteger(event.browser_time_ms) || event.browser_time_ms < 0) return false;
  if (typeof event.event_id !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(event.event_id)) return false;
  if (event.title !== null && (typeof event.title !== "string" || encoder.encode(event.title).length > 256 || sensitiveText(event.title))) return false;
  if (event.kind === "excerpt") {
    if (typeof event.excerpt !== "string" || !event.excerpt.trim() || encoder.encode(event.excerpt).length > MAX_EXCERPT_BYTES || sensitiveText(event.excerpt)) return false;
  } else if (event.excerpt !== null) return false;
  return encoder.encode(JSON.stringify(event)).length <= MAX_PAYLOAD_BYTES;
}

// Self-contained for scripting.executeScript's isolated world. Never reads field
// values, cookies, storage, frames or hidden DOM. Unsupported safety is denied.
function inspectReaderPage(includeSelection, expectedUrl) {
  const denied = (reason) => ({allowed: false, reason});
  const actual = new URL(location.href);
  actual.search = "";
  actual.hash = "";
  if (typeof expectedUrl !== "string" || actual.href !== expectedUrl) return denied("document_changed");
  if (!document || document.contentType !== "text/html") return denied("unsupported_document");
  if (document.querySelector("form,input,textarea,iframe,embed,object,[contenteditable='true'],[is]")) return denied("interactive_or_unverifiable_page");
  const nodes = document.querySelectorAll("*");
  if (nodes.length > 5000) return denied("page_bound");
  for (const node of nodes) {
    // Closed shadow roots cannot be inspected. Reject custom/shadow components.
    if (node.localName.includes("-") || node.shadowRoot) return denied("unverifiable_component");
  }
  const sensitive = /(?:bearer\s+|api[ _-]?key|private[ _-]?key|password\s*[:=]|secret\s*[:=]|nsec1[a-z0-9]+|sk-[a-z0-9]{16,})/i;
  const title = (document.title || "").slice(0, 128);
  if (sensitive.test(title)) return denied("credential_text");
  let excerpt = null;
  if (includeSelection) {
    const selection = window.getSelection();
    const parent = selection?.anchorNode?.parentElement;
    if (!parent || parent.closest("[hidden],[aria-hidden='true'],[data-sensitive],[data-private],pre,code,input,textarea,[contenteditable]")) return denied("unsafe_selection");
    const style = getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden" || !parent.getClientRects().length) return denied("hidden_selection");
    excerpt = selection.toString().trim();
    if (!excerpt || new TextEncoder().encode(excerpt).length > 4096 || sensitive.test(excerpt)) return denied("unsafe_selection");
  }
  return {allowed: true, url: actual.href, title, excerpt};
}

function createWorker(api) {
  let prefs;
  let port = null;
  let collectionEnabled = false;
  let allowedKinds = [];
  let capturing = false;
  let historyEvent = null;
  const pending = new Map();
  const changed = new Map();
  const ready = (async () => {
    await api.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"});
    const saved = (await api.storage.local.get("profile")).profile || {};
    prefs = {
      profile_instance_id: saved.profile_instance_id || `profile-${crypto.randomUUID()}`,
      token: typeof saved.token === "string" ? saved.token : null,
      sequence: Number.isSafeInteger(saved.sequence) ? saved.sequence : 0,
      visits: saved.visits === true,
      bookmarks: saved.bookmarks === true,
      excerpts: saved.excerpts === true,
      origins: Array.isArray(saved.origins) ? saved.origins.map(safeOrigin).filter(Boolean).slice(0, 8) : [],
    };
    await save();
    syncHistoryListener();
  })();
  async function save() { await api.storage.local.set({profile: prefs}); }
  function projection() {
    return {paired: !!prefs.token, profile_instance_id: prefs.profile_instance_id, visits: prefs.visits, bookmarks: prefs.bookmarks, excerpts: prefs.excerpts, origins: prefs.origins, collection_enabled: collectionEnabled};
  }
  function connect() {
    if (port) return;
    port = api.runtime.connectNative(NATIVE_HOST);
    port.onMessage.addListener((frame) => {
      if (frame?.protocol !== BROWSER_PROTOCOL || typeof frame.request_id !== "string") return;
      const item = pending.get(frame.request_id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(frame.request_id);
      if (frame.response?.kind === "rejected") item.reject(new Error(frame.response.code || "unavailable"));
      else item.resolve(frame.response);
    });
    port.onDisconnect.addListener(() => {
      // Consume Chrome's diagnostic without exposing native paths or payloads.
      void api.runtime.lastError;
      port = null;
      collectionEnabled = false;
      allowedKinds = [];
      changed.clear();
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("unavailable")); }
      pending.clear();
    });
  }
  async function rpc(request) {
    await ready;
    if (pending.size >= 8) throw new Error("busy");
    connect();
    const request_id = `request-${crypto.randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(request_id); reject(new Error("unavailable")); }, 3000);
      pending.set(request_id, {resolve, reject, timer});
      try { port.postMessage({protocol: BROWSER_PROTOCOL, request_id, request}); }
      catch { clearTimeout(timer); pending.delete(request_id); reject(new Error("unavailable")); }
    });
  }
  function applyStatus(response) {
    if (response?.profile_instance_id !== prefs.profile_instance_id || typeof response.collection_enabled !== "boolean" || !Array.isArray(response.allowed_kinds)) throw new Error("invalid_binding");
    collectionEnabled = response.collection_enabled;
    allowedKinds = response.allowed_kinds.filter((kind) => KINDS.includes(kind));
    if (!collectionEnabled) changed.clear();
  }
  async function status() {
    await ready;
    if (!prefs.token) return projection();
    applyStatus(await rpc({kind: "status", profile_instance_id: prefs.profile_instance_id, token: prefs.token}));
    return projection();
  }
  async function pair(code) {
    await ready;
    const response = await rpc({kind: "pair", profile_instance_id: prefs.profile_instance_id, pairing_code: code});
    if (response?.kind !== "paired" || typeof response.token !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(response.token)) throw new Error("invalid_pairing");
    applyStatus(response);
    prefs.token = response.token;
    await save();
    return projection();
  }
  async function update(config) {
    await ready;
    const origins = (config.origins || []).map(safeOrigin).filter(Boolean);
    if (!origins.length || origins.length > 8) throw new Error("choose_origin");
    prefs.origins = [...new Set(origins)];
    prefs.visits = config.visits === true;
    prefs.bookmarks = config.bookmarks === true;
    prefs.excerpts = config.excerpts === true;
    changed.clear();
    await save();
    syncHistoryListener();
    return projection();
  }
  async function preflight(tab, gesture, includeSelection) {
    const url = safeUrl(tab?.url);
    if (!url || tab.incognito !== false || !prefs.origins.includes(new URL(url).origin)) throw new Error("unsafe_scope");
    // A previous activeTab gesture is never used to justify passive capture.
    if (!gesture && !await api.permissions.contains({origins: [`${new URL(url).origin}/*`]})) throw new Error("origin_permission_required");
    const results = await api.scripting.executeScript({target: {tabId: tab.id, frameIds: [0]}, func: inspectReaderPage, args: [includeSelection, url]});
    if (results.length !== 1 || results[0].frameId !== 0 || results[0].result?.allowed !== true || results[0].result.url !== url) throw new Error("unsafe_page");
    const current = await api.tabs.get(tab.id);
    if (current.incognito !== false || safeUrl(current.url) !== url) throw new Error("document_changed");
    return {url, result: results[0].result};
  }
  async function emit(kind, tab, gesture) {
    await ready;
    if (capturing || !prefs.token) return false;
    capturing = true;
    try {
      await status();
      if (!collectionEnabled || !allowedKinds.includes(kind)) return false;
      const check = await preflight(tab, gesture, kind === "excerpt");
      if (!collectionEnabled || !allowedKinds.includes(kind)) return false;
      const signature = JSON.stringify([kind, check.url, check.result.title, check.result.excerpt]);
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(signature)))].map((x) => x.toString(16).padStart(2, "0")).join("");
      const key = `${kind}:${tab.id}`;
      if (changed.get(key) === digest) return false;
      prefs.sequence += 1;
      if (!Number.isSafeInteger(prefs.sequence)) throw new Error("sequence_bound");
      await save(); // Persist only the counter/settings, never the captured body.
      const event = {event_id: `event-${crypto.randomUUID()}`, sequence: prefs.sequence, browser_time_ms: Date.now(), kind, url: check.url, title: check.result.title || null, excerpt: kind === "excerpt" ? check.result.excerpt : null, incognito: false, credential_context: false, excluded: false, scope_verified: true};
      if (!validEvent(event)) throw new Error("unsafe_payload");
      const response = await rpc({kind: "observe", profile_instance_id: prefs.profile_instance_id, token: prefs.token, event});
      if (response?.kind !== "receipt" || response.event_id !== event.event_id || response.admitted !== true) throw new Error("not_admitted");
      changed.set(key, digest);
      if (changed.size > 128) changed.delete(changed.keys().next().value);
      return true;
    } finally { capturing = false; }
  }
  async function visit(item) {
    await ready;
    if (!prefs.visits || !prefs.token || !await api.permissions.contains({permissions: ["history"]})) return false;
    await status();
    if (!collectionEnabled || !allowedKinds.includes("visit")) return false;
    const url = safeUrl(item?.url);
    if (!url) return false;
    const origin = new URL(url).origin;
    if (!prefs.origins.includes(origin) || !await api.permissions.contains({origins: [`${origin}/*`]})) return false;
    // HistoryItem has no private-tab provenance. Only a currently resolvable,
    // normal tab on an explicitly allowed origin can corroborate this event.
    const tabs = await api.tabs.query({});
    const tab = tabs.find((candidate) => candidate.incognito === false && safeUrl(candidate.url) === url);
    return tab ? emit("visit", tab, false) : false;
  }
  async function share(kind) {
    await ready;
    if ((kind === "excerpt" && !prefs.excerpts) || (kind === "bookmark" && !prefs.bookmarks)) throw new Error("not_enabled");
    await status();
    if (!prefs.token || !collectionEnabled || !allowedKinds.includes(kind)) return {admitted: false};
    const [tab] = await api.tabs.query({active: true, currentWindow: true});
    if (kind === "bookmark") {
      if (!await api.permissions.contains({permissions: ["bookmarks"]})) throw new Error("bookmark_permission_required");
      if (!tab || tab.incognito !== false || !(await api.bookmarks.search({url: tab.url})).length) throw new Error("no_current_bookmark");
    }
    return {admitted: await emit(kind, tab, true)};
  }
  const onVisited = (item) => { void visit(item).catch(() => {}); };
  function syncHistoryListener() {
    if (prefs?.visits && api.history?.onVisited && !historyEvent) {
      historyEvent = api.history.onVisited;
      historyEvent.addListener(onVisited);
    } else if (!prefs?.visits && historyEvent) {
      try { historyEvent.removeListener(onVisited); } catch { /* Permission removal may already disconnect the API. */ }
      historyEvent = null;
    }
  }
  // Optional API bindings may appear only after the explicit permission request.
  api.permissions.onAdded?.addListener(() => { syncHistoryListener(); });
  api.permissions.onRemoved.addListener(() => { collectionEnabled = false; allowedKinds = []; changed.clear(); syncHistoryListener(); });
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== api.runtime.id || !sender.url?.startsWith(api.runtime.getURL(""))) return false;
    const work = async () => {
      switch (message?.kind) {
        case "status": await ready; return projection();
        case "pair": return pair(message.code);
        case "configure": return update(message.config);
        case "share_excerpt": return share("excerpt");
        case "share_bookmark": return share("bookmark");
        default: throw new Error("unsupported_request");
      }
    };
    void work().then((result) => respond({ok: true, result})).catch(() => respond({ok: false, code: "unavailable_or_not_permitted"}));
    return true;
  });
  return {ready, visit, share, pair, update, status, projection};
}

globalThis.BrowserAwarenessCore = {safeUrl, safeOrigin, sensitiveText, validEvent, inspectReaderPage, createWorker};
if (typeof chrome !== "undefined" && chrome.runtime?.id) createWorker(chrome);
