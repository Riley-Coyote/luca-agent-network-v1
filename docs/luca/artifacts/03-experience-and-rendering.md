# Experience and Rendering

## Information architecture

```text
Library                    /library
Artifact detail            /library/:artifactId
Conversation Canvas        /channels/:channelId?artifact=<id>&artifactVersion=<n>
```

The route generator may choose its conventional file spelling. The URL state is
normative: selected artifact and selected version survive refresh, back, and
forward navigation.

## Library

Library is a top-level personal surface, not a project mode.

### Primary layout

- Quiet header with `Library`, search, grid/list toggle, import, and storage
  status.
- Filter row or compact sidebar for All, Recent, Pinned, Images, Documents,
  Code, HTML, PDF, Other, project, and resident.
- Main grid/list containing non-executing previews.
- Selected artifact opens a detail plane or navigates to its detail route while
  preserving list scroll/filter state.

### Card content

- stable thumbnail or type preview;
- title and kind;
- creating resident identity;
- project or conversation label when available;
- updated time and version count;
- pinned, missing-source, preview-unavailable, or deleted state.

HTML cards never instantiate iframes. Image cards use real bounded thumbnails;
text/code/Markdown use escaped excerpts; other types use restrained type
previews. No decorative gradient is required to make the wall feel finished.

### Empty state

> Things you and your residents make will appear here.

Actions: `Import a file` and `Open a conversation`. The empty state does not
pretend artifact creation is already configured when no resident has the tool.

## Canvas

One `ArtifactCanvas` component powers conversation and Library detail.

### Header

- title;
- type and creating resident;
- version selector (`v2 of 3`);
- Preview / Source / Versions tabs as supported;
- open full screen, download/export, source conversation, more actions, close.

### Preview tab

- Uses the renderer selected from sniffed MIME plus artifact kind.
- Maintains a stable loading frame to avoid layout jumps.
- Displays an explicit unsupported or failed state with download/reveal actions.
- Never silently falls back from rejected HTML to unsafe DOM insertion.

### Source tab

- Text-based kinds show read-only source using the existing code/Markdown
  typography and zoom-safe type scale.
- Binary kinds show metadata, hash, dimensions when known, and file actions.
- Static V1 is not an editor. “Edit” means ask a resident in the source
  conversation or edit the source file externally and publish another version.

### Versions tab

- chronological versions with author/turn/message/time;
- selected version preview;
- diff for text-based adjacent or selected versions;
- `Revert to this version` creates a new version after expected-version check;
- no history rewrite or destructive “make current” mutation.

## Conversation integration

### Provisional card

While a managed turn is active, a committed artifact may appear as a
provisional local timeline item keyed by its receipt. It clearly says the
resident is still working. It is not presented as part of the signed final.

### Linked card

After final publication, the card anchors immediately after the corresponding
signed message. It shows title, type, preview state, version, and `Open Canvas`.
Virtualized timeline projection must treat the card as a deterministic local
decoration, not a relay message with fake authorship.

### Auto-open policy

Canvas auto-opens when all are true:

1. this is the first committed artifact in the active turn;
2. the owner is viewing the artifact's conversation;
3. the owner has not manually dismissed Canvas for that turn;
4. no modal, channel-management flow, or explicit profile/activity inspection
   currently owns focus.

Updates refresh an already-open artifact. Background artifacts show a receipt
and optional notification but do not change the current route.

### Pane coexistence

The conversation right auxiliary pane already hosts activity and profile
inspection. Canvas joins the same URL-backed panel state machine:

- only one auxiliary content owner is visible at a time;
- opening Canvas captures the prior pane so Back can return to it;
- Close returns to the conversation without rewriting message selection;
- narrow layouts use a standalone full-width pane;
- thread focus and artifact selection remain distinct states.

## Renderer policy

### Markdown, text, and code

- Reuse existing Markdown and Shiki components.
- Escape raw text.
- Respect root `rem` zoom; do not add pixel text sizes.
- Bound source rendering and offer download for oversized content.

### Images

- Create object URLs from bounded bytes and revoke them on unmount/version
  change.
- Preserve aspect ratio and metadata.
- Support zoom/pan only inside the Canvas, with keyboard reset.
- Reject decompression bombs by decoded dimensions and byte bounds.

### SVG

- Treat as image bytes via an object URL.
- Do not inject SVG markup into the application DOM.
- External resource loading is unavailable.

### HTML

- Render only inside an iframe with `sandbox="allow-scripts"` and no
  `allow-same-origin`, forms, popups, top navigation, downloads, or modals.
- Inject the versioned static-preview CSP before any user content.
- Do not expose Tauri globals, app cookies, local storage, parent DOM, clipboard,
  filesystem, or network.
- Stop execution immediately on unmount by removing the iframe.
- A sandbox/CSP initialization failure yields no preview.

### PDF

- Attempt a bounded blob/object preview only where the packaged webview proves
  support.
- Always retain download/export.
- Never claim a consistent inline PDF renderer until installed-app evidence
  proves it on supported platforms.

## Meaningful states

Every Library and Canvas surface must design and test:

- loading metadata;
- loading body;
- empty Library;
- capturing/provisional;
- ready;
- new version available;
- version conflict;
- unsupported type;
- preview rejected;
- corrupt or missing blob;
- source moved/missing;
- artifact service unavailable;
- soft deleted/restored;
- owner identity changed;
- no resident artifact-tool capability.

## Accessibility and desktop behavior

- All controls are keyboard reachable with visible focus.
- Canvas open/close announces title and state without moving screen-reader focus
  into generated content automatically.
- Generated HTML iframe has a descriptive title and is skipped in tab order
  until the owner explicitly enters preview interaction.
- Escape exits preview interaction before closing Canvas.
- Reduced motion removes slide/refresh transitions.
- Zoom works because readable text uses the existing rem scale.
- Long titles, filenames, error messages, and 10,000-item Library states are
  tested for overflow and virtualization behavior.

## Static-bundle seam — deferred behavior

The model reserves `ArtifactVersion.entrypoint` and multiple `ArtifactFile`
rows so a future version can snapshot an `index.html` plus relative assets.
Static V1 does not expose a bundle tool or custom-protocol server. No current
task may smuggle dev-server execution through this seam.
