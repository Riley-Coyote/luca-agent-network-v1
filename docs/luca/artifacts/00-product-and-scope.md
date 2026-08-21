# Product and Scope

## Product promise — settled

When a resident makes something, it should become a durable object the owner can
see and return to—not a transient code block lost inside a long conversation.

The Artifact Library owns durable created things. The Canvas is the contextual
surface used to inspect one of those things. Conversation remains the place
where intent, iteration, authorship, and response chronology live.

## Terms

- **Artifact:** a stable local object with identity, provenance, and versions.
- **Artifact version:** an immutable snapshot of one artifact at one point in
  its iteration history.
- **Artifact file:** one file within a version. Static V1 normally has one.
- **Library:** the owner-facing collection, search, and management surface.
- **Canvas:** the shared preview/source/version surface used from conversation
  and Library.
- **Source binding:** optional local-only information connecting a snapshot to
  the working file from which it was captured.
- **Artifact receipt:** local metadata binding an artifact version to the
  owner, resident, conversation, turn, and—when available—signed final message.

The existing relay-backed Markdown “Channel Canvas” is not an artifact Canvas.
Its user-facing name becomes **Room brief**. Its existing event kind and
transport may remain unchanged.

## Primary journeys

### Resident creates an artifact

1. The resident calls `artifact_create` with inline UTF-8 content or a relative
   file path inside the turn's authorized working root.
2. The desktop-owned artifact service validates, snapshots, hashes, and commits
   version 1 atomically.
3. A local receipt is emitted only after the durable commit.
4. The active conversation shows a provisional card while the turn is active.
5. When the final message is accepted, the receipt binds to that signed message.
6. The Canvas auto-opens only when the current focus policy permits it.

### Resident iterates an artifact

1. The resident calls `artifact_update` with the artifact ID and
   `expected_current_version`.
2. A version mismatch fails safely and returns the current version; it never
   overwrites or forks silently.
3. A successful update appends a new immutable version.
4. An already-open Canvas refreshes in place. A background update does not
   steal focus.

### Owner browses Library

1. Library opens at `/library` and defaults to recent artifacts.
2. The owner searches or filters by type, project, resident, conversation,
   state, or pinned status.
3. Selecting an artifact opens its detail/Canvas view without losing the list
   position.
4. The owner can return to the source conversation, download a version, reveal
   an authorized source file, pin, rename, or delete.

### Owner imports a local file

1. The owner chooses a file through a native picker or drops it into Library.
2. Luca snapshots the file into managed storage by default.
3. The original absolute path stays native-only and is never returned as normal
   renderer metadata.
4. If the source later moves, the durable snapshot still works; only “reveal
   source” becomes unavailable.

## Static V1 scope

| Capability | Static V1 | Deferred |
|---|---|---|
| Local catalog and search | Required | Cross-device shared catalog |
| Immutable versions | Required | Multi-writer collaboration |
| Resident create/update/read/list tools | Required | Arbitrary plugin tool marketplace |
| Conversation artifact cards | Required, local overlay | Relay-synchronized cards |
| Image preview | Required | Image editing suite |
| Markdown/text/code preview | Required | Full IDE |
| SVG preview | Required as non-executing image content | Interactive SVG scripting |
| Standalone HTML preview | Required in opaque sandbox | External network access |
| PDF preview | Best available native inline preview plus download | PDF editing |
| Arbitrary files | Catalog, metadata, download/reveal | Universal inline renderer |
| Multi-file static bundle | Schema seam only | Initial release behavior |
| Agent-started loopback dev server preview and hot reload | Required | Remote/LAN browsing and Luca-owned process launch |
| Infinite board/whiteboard | No | Separate future artifact kind |
| Relay upload/share | Explicit future action | Automatic upload |

## Supported kinds

The stored `kind` is semantic; MIME sniffing remains authoritative for preview
safety.

| Kind | Initial renderer |
|---|---|
| `image` | Blob-backed image with zoom and metadata |
| `markdown` | Existing sanitized Markdown pipeline |
| `text` | Escaped text with wrapping controls |
| `code` | Existing Shiki-backed code presentation |
| `svg` | Blob-backed image; never injected into the application DOM |
| `html` | Sandboxed opaque-origin iframe with injected restrictive CSP |
| `pdf` | Bounded object/iframe preview when supported; otherwise download |
| `file` | Metadata, source provenance, download/reveal |
| `app` | Source-bound project metadata plus an ephemeral loopback preview session |

`static_bundle`, `mermaid`, editable document formats, audio, and video may be
added later without changing artifact identity or version semantics.

## Artifact states

```text
capturing -> ready
capturing -> failed
ready -> preview_unavailable
ready -> source_missing
ready -> deleted
preview_unavailable -> ready
source_missing -> ready
deleted -> restored | purged
```

- `failed` means no committed version exists for that attempt.
- `preview_unavailable` does not make the artifact unavailable for download.
- `source_missing` does not invalidate the managed snapshot.
- `deleted` is reversible until background garbage collection purges unreferenced
  blobs after the retention window.

## Functional requirements

1. Artifact identity is stable across versions, relaunch, and resident runtime
   replacement.
2. Every committed version has a content hash and complete provenance.
3. Version creation is atomic across metadata and referenced managed bytes.
4. The same idempotency key cannot create duplicate versions.
5. Revert appends a copy of an older version; it never rewrites history.
6. Library opens and searches without loading artifact bodies.
7. Conversation loads without artifact storage; missing artifacts degrade to a
   local unavailable state and never break message rendering.
8. Closing or disabling Canvas does not cancel or block a resident turn.
9. No background preview executes merely because a Library card scrolls into
   view.
10. User-visible failures name what remains safe and what can be retried.

## Performance targets — targets, not current claims

- Commit a 1 MiB text artifact locally in under 300 ms p95 on the supported
  reference Mac.
- Render Canvas chrome within one frame of opening; expensive content resolves
  behind a stable loading state.
- Show a ready receipt in the active conversation within 250 ms of durable
  commit.
- Search 10,000 metadata rows in under 150 ms p95 using SQLite FTS/indexes.
- Library must not instantiate executable HTML previews in its grid.

## First acceptance demonstration

The first integrated demo must prove:

- create HTML v1;
- automatic Canvas open;
- durable local conversation card;
- update to v2 using optimistic version control;
- view v1 and v2;
- diff and revert-as-v3;
- close, relaunch, find in Library, and return to the source conversation;
- network attempts, parent access, Tauri access, and path traversal fail;
- messaging still succeeds when the artifact service is unavailable.
- an agent-started loopback app attaches, hot reloads, survives Canvas
  close/reopen, reports server loss, and prepares an unsent restart request.
