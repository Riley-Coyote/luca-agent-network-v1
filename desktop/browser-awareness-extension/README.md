# Browser-awareness candidate source

Source only. Not installed, registered, launched, or native/browser-certified.
This is one explicitly paired Chromium profile, not a universal browser adapter.
The current plain popup is functional source, not visually verified product UI.

## Boundary

Pairing, Chrome permissions, app observation grants, retention/promotion, and
provider egress are independent. All features start off. Chrome's optional
`history`/`bookmarks` permission does not authorize page text. `activeTab` is a
temporary user-gesture permission, never passive all-page access.
See [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
and [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

- Visits use changed `history.onVisited` events, not `history.search` or a profile
  database scan. Each event needs a resolvable normal tab, an explicitly stored
  allowed origin, persistent Chrome permission for that origin, and a privacy
  preflight. If any of those cannot be established, drop the event.
- That preflight requires content access. If the owner has not granted it, visits
  at that site are unavailable; the adapter never quietly asks for more access.
  It returns no page text for visits.
- Bookmarks are explicit current-page sharing after a click and a bounded exact
  URL lookup. There is no global `onCreated` feed: the bookmarks API does not
  provide private-tab provenance. Existing bookmark provenance is not represented
  as proof of a historical regular-mode visit.
- Excerpts require a separate local setting, current app `excerpt` grant and user
  click. Only selected visible text is returned, never full-page scraping.
- Incognito is `not_allowed`; normal-tab checks are still explicit. See
  [Chrome's incognito contract](https://developer.chrome.com/docs/extensions/reference/manifest/incognito).
- Reader pages containing forms/inputs, editable content, frames, custom/shadow
  components or excessive DOM size are unsupported and denied before selection.
  No field values, cookies, storage, passwords or network headers are read.
  Known credential text/routes are rejected; URL userinfo is rejected, query and
  fragments are removed, ambiguous encoded paths are unsupported.

The conservative reader supports only a narrow subset of pages. This is not a
claim that arbitrary plaintext can always be classified as non-secret. Site
exclusions and profile/class grants are also enforced independently by the app.
Every accepted excerpt is untrusted reference data, not instructions or authority.

## Transport / parent integration

Development extension ID: `cgeconjecinkbflofoimhcegaiebecgg` (manifest public key).
Native host name: `chat.polyphonic.browser_awareness`.

The parent owns the installed native-host manifest and its exact
`allowed_origins: ["chrome-extension://cgeconjecinkbflofoimhcegaiebecgg/"]`,
packaged executable/early-main entry, and private bootstrap. No registration is
performed here. Native host lookup paths differ by browser/user-data directory;
Chrome for Testing locations changed at Chrome 146. Verify the actual supported
browser/version during disposable proof, not by guessing its normal profile path.
See [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

`browser_bridge.rs` provides strict client/reply/event DTOs and
`start_browser_bridge(BrowserBridgeConfig, BrowserHostCallback)`. Supply an
existing canonical private internal transport directory (0700), a random bridge
capability and one exact extension origin. Darwin socket paths must stay short.
The bridge creates only its random 0600 UDS; shutdown removes only that same
owned socket inode. No TCP endpoint or broad repository MCP authority is exposed.

`browser_native_host.rs::run_browser_native_host(config, reader, writer)` is a
standalone helper entry. Parent checks Chrome's caller-origin argument against
the installed manifest and supplies the fixed private endpoint/capability.
Frames use 4-byte native-order lengths and a stricter 64 KiB limit. Stdout is
protocol only. Callback work must be synchronous/bounded: no model call, UI wait,
account sign-in, or native action inside transport.

Wire operations are only `pair`, `status`, and `observe`. No wire owner, resident,
device, path, model, tools, or arbitrary RPC operation exists. The callback must:

1. Require a short-lived app-issued one-time pairing challenge, rate-limit attempts
   and issue a new random profile token only after current owner confirmation.
2. Bind that token to extension ID + local-only profile instance + current app
   installation/owner + selected companion, then store only protected token
   material/hash. A client-chosen profile ID alone proves nothing.
3. Return per-kind `allowed_kinds` and `collection_enabled`; pairing is not a grant.
4. On every observation, independently authenticate pairing, current
   `LiveAwarenessOwner`, deny/Pause state, class and origin grants. Derive
   principals/device, source IDs, host capture time and observation sequencing
   in host authority. Browser timestamps/flags are untrusted collector claims.
5. Pass admitted bytes through the existing awareness controller's same-lock
   buffer/deny boundary. Retention/promotion/egress are not implied.

The extension stores profile settings, token and sequence only in local trusted
extension storage, never Chrome Sync or page storage. No content script, external
messaging listener, DOM message bridge or web-accessible token exists. The native
port is extension-only; native messaging is unavailable to web pages/content
scripts directly. See [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging),
[external messaging](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable)
and [storage access levels](https://developer.chrome.com/docs/extensions/reference/api/storage).

Native messaging and extension ID do not identify a profile on their own. Pair
each profile independently; copied/cloned browser profile state is not a new
attested identity. This boundary protects against webpages impersonating the
extension, not an unrestricted malicious local process reading the user's files.
Disconnect is unavailable, not idle/fresh; events are dropped rather than stored
for a catch-up storm. No observation body is persisted by the extension.

## Small proof / checks

Synthetic source checks: `node --test desktop/browser-awareness-extension/tests/*.test.mjs`.
Rust tests are owned source fixtures for parent compilation; no native browser
proof is claimed by them. Parent also declares both Rust modules under `cfg(unix)`.

Later proof uses a fresh internal-SSD user-data directory with no real history,
accounts or bookmarks. Explicitly load this unpacked extension and register the
candidate host for that disposable directory only. Then prove:

1. Before pairing/grants, no reference is ingested. Profile B cannot use profile
   A's pairing; a wrong extension origin/token is rejected.
2. A static safe article visit emits bounded query-free metadata; repeated
   unchanged state is suppressed. No excerpt appears without its separate click.
3. Incognito, credential-form, excluded-origin and changed-document sentinels
   never reach admission. Missing site permission reports unavailable/drops.
4. Pause/revoke while an event is pending denies it. Restart/reconnect preserves
   profile binding without replaying a body or resurrecting withdrawn access.
5. A fixture webpage's external message cannot invoke pairing/native ingress.

The Chrome service worker may restart. Native ports keep it alive on supported
Chrome versions, but correctness cannot depend on that; state is reloaded and
app authority is queried before capture. See [service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
No real install, history/tab inspection, browser launch, model, build, cache
cleanup or installed-app replacement was performed for this source lane.
