# Security and Lifecycle

Artifact content is untrusted input even when a trusted resident produced it.
The resident may be compromised, the model may have followed malicious source
instructions, or a local file may change between selection and capture.

## Trust matrix

| Component | May do | May not do |
|---|---|---|
| Owner UI | request import, preview, rename, pin, revert, export, delete | receive resident keys or raw broker capability |
| Resident model | request bounded artifact operations | select owner identity, widen root, sign, upload, run preview commands |
| Artifact-only MCP mode | send bound request to artifact broker | expose shell/file/messaging tools or leak capability material to model or shell descendants |
| ACP host | bind resident/session/turn/conversation and provision MCP | choose artifact bytes or treat content as authority |
| Desktop artifact service | validate, snapshot, hash, store, version, emit safe receipt | publish to relay implicitly or execute artifact code |
| Canvas renderer | display explicit selected version | access local paths, Tauri IPC, application origin, or ambient network |
| Relay | retain normal conversation events | receive artifact bytes/paths in static V1 |

## Separate capabilities

The artifact broker is a distinct local capability from:

- resident/owner signing broker;
- managed permission channel;
- relay credentials;
- provider credentials;
- general Tauri invoke access.

It must use a separate descriptor/token, protocol name, schema, validator,
timeout, maximum frame size, and error namespace. Possession authorizes only a
request that still passes desktop-side binding and policy checks.

## Descendant isolation

1. The desktop creates the artifact broker endpoint for one managed runtime
   session epoch.
2. The ACP host receives only the bootstrap information needed to provision the
   designated artifact MCP server. The trusted ACP adapter necessarily sees the
   standard `mcpServers` command/environment projection.
3. Provider/model prompts and shell/tool processes do not inherit it.
4. The artifact-only MCP process consumes the bootstrap descriptor, duplicates
   it safely, sets close-on-exec, closes the inherited original, and removes
   bootstrap state from its environment.
5. Commands spawned by the shell tool, nested shells, package scripts, and
   subprocesses cannot inspect or use the broker descriptor/token.
6. Runtime restart invalidates the old session epoch and endpoint.

Positive tests prove the MCP artifact operation works. Negative tests inspect
direct and nested descendants for descriptor, argv, environment, and endpoint
access.

## Path capture policy

`WorkspaceFile.relative_path` is always resolved against the desktop-bound
working root for the turn. The model cannot supply or replace that root.

Validation order:

1. reject absolute, empty, NUL-containing, drive-qualified, UNC, and invalid
   UTF-8 paths;
2. normalize separators and reject `.`/`..` escape semantics;
3. open beneath the authorized directory using no-follow semantics where the
   platform allows;
4. reject symlinks for static V1 rather than guessing target policy;
5. read from the opened handle, not by reopening the string path;
6. validate regular-file type and size;
7. sniff MIME from bytes;
8. hash while copying to staging;
9. revalidate relevant file identity/metadata before commit;
10. atomically publish the managed snapshot.

The source binding is convenience metadata. The managed snapshot is the
durable version authority.

## MIME and content policy

- Declared kind, filename extension, and declared MIME are hints.
- Sniffed MIME and renderer allowlists decide preview behavior.
- A mismatch is recorded and may downgrade to `file`; it never selects a more
  powerful renderer.
- Archives, executables, disk images, packages, and unknown binary data are
  catalog/download-only.
- SVG is never trusted as application markup.
- HTML is never sanitized into the application DOM; isolation is mandatory.
- Artifact bodies are not fed back into system prompts automatically.

## Static HTML sandbox

Required iframe sandbox:

```text
sandbox="allow-scripts"
```

Forbidden flags include `allow-same-origin`, `allow-top-navigation`,
`allow-popups`, `allow-forms`, `allow-downloads`, `allow-modals`, and storage
access escapes.

The desktop injects a versioned CSP before the artifact body:

```text
default-src 'none';
base-uri 'none';
connect-src 'none';
form-action 'none';
frame-src 'none';
frame-ancestors 'none';
img-src data: blob:;
font-src data:;
media-src data: blob:;
object-src 'none';
script-src 'unsafe-inline';
style-src 'unsafe-inline';
```

The exact packaged-WebKit behavior is a `GA0` reconnaissance item. If an
equivalent fail-closed sandbox cannot be proven, HTML source is viewable but
Preview remains unavailable. The implementation may not weaken isolation to
make the demo pass.

## Renderer boundary

- Preview receives bytes, MIME, title, and version—not filesystem paths.
- Object URLs are created in trusted UI code and revoked deterministically.
- Generated content cannot call `window.__TAURI__`, invoke commands, read app
  storage, navigate the parent, or post trusted messages into Luca.
- Any `postMessage` handling is deny-by-default and validates origin, source
  window, schema, size, and nonce. Static V1 requires no generated-content
  message bridge.
- Canvas does not preserve iframe state between versions or reopen.

## Relay, observer, and diagnostics policy

Static V1 publishes no artifact event or body to the relay.

Allowed in local invalidation events and safe diagnostics:

- artifact ID;
- version;
- kind;
- lifecycle/preview state;
- safe error code;
- byte count and duration buckets.

Forbidden:

- body or excerpt;
- absolute or relative source path;
- filename when it may disclose private context, unless shown only in owner UI;
- broker endpoint/token/descriptor;
- raw SQL/filesystem/provider errors;
- owner/resident secret or signing material;
- generated HTML console output in default logs.

The existing ACP observer feed may display the tool name and safe result. It
must not carry artifact bodies or source paths into owner-scoped relay frames.

## Identity and community switching

Every catalog query and mutation binds `owner_pubkey`. If the underlying app
switches identity/community without a full process restart:

- renderer caches and object URLs are cleared;
- open Canvas state closes;
- artifact query caches reset;
- provisional receipts from the old scope cannot link to new messages;
- the native service rejects cross-owner IDs even if the renderer retains one.

Any module-level artifact cache must add a reset function to the existing
community-state reset boundary.

## Failure and restart behavior

| Failure | Required outcome |
|---|---|
| DB unavailable | Tool fails safely; conversation continues |
| Disk full | No partial committed version; staged data cleaned or quarantined |
| Crash during capture | Relaunch removes or reconciles stale staging entries |
| Crash after blob publish before row commit | Unreferenced blob is later garbage collected |
| Missing committed blob | Mark corrupt/unavailable; retain metadata and receipt |
| Turn cancelled after artifact commit | Keep artifact; receipt becomes interrupted |
| Final publication fails | Keep artifact in Library; do not claim linked message |
| Duplicate request after restart | Return original receipt |
| Update race | One append wins; loser receives conflict with current version |
| Source moved/deleted | Snapshot remains; source binding becomes missing |
| Renderer crash | Canvas reports failure; app and conversation remain usable |

## Delete and retention

- Initial delete is a soft tombstone scoped to the owner.
- Restore revives metadata and versions while blobs remain retained.
- Purge is an explicit owner action or retention job after a visible retention
  window.
- Garbage collection uses database reachability, not refcount assumptions alone.
- Export happens before purge only when the owner requests it; no silent backup
  claim is made.

## Security acceptance suite

At minimum, use synthetic fixtures for:

- `../` and encoded traversal;
- absolute/UNC/drive paths;
- symlink escape and symlink swap;
- oversized text, image, broker frame, and decompression bomb;
- extension/MIME mismatch;
- HTML fetch/XHR/WebSocket/navigation/form/pop-up attempts;
- parent DOM, localStorage, cookie, Tauri, clipboard, and top-navigation access;
- SVG scripts, event handlers, external references, and foreign objects;
- duplicate idempotency key with same and different bytes;
- concurrent expected-version updates;
- stale session epoch and wrong resident/conversation/owner;
- direct and nested descriptor inheritance;
- identity/community switch with open Canvas;
- artifact-store absence during an otherwise successful final response;
- artifact/secret scan of evidence and fixtures.

No P0/P1 security finding is accepted for the integrated static candidate.
