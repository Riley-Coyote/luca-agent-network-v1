# Luca V1.1 Notebook interface specification

Status: frontend design authority for H18

Backend checkpoint: `cab8e28f`

Renderer contract: `desktop/src/shared/api/tauriNotebook.ts`

Audience: Riley, Claude, and the frontend integration reviewer

## 1. Product intent

The Notebook is the private, inspectable record a resident keeps across
conversations. It should feel like an authored place inside an ongoing
relationship, not a database, analytics dashboard, memory graph, or collection
of generic cards.

The user should understand three things within a few seconds:

1. **This belongs to one resident.** Its identity, authorship, and sources are
   always visible.
2. **Notes and pages are different.** Continuity Notes can help future
   conversations; Journal Pages are deliberate authored works and are not
   automatically recalled in chat.
3. **The owner remains in control.** Every item is inspectable and source-backed,
   and the owner can correct, annotate, archive, or forget it without silently
   impersonating the resident.

The notebook extends Luca's stable cryptographic resident identity. It does not
claim consciousness, native-session restoration, model-independent personality
transfer, or access to another resident's private memory.

## 2. Product boundaries

### Included in V1.1

- Resident-specific encrypted Continuity Notes.
- Resident-authored Markdown Journal Pages.
- Exact signed conversation provenance.
- Revision history and lifecycle state.
- Owner correction and pinning for Continuity Notes.
- Owner annotations and resident revision requests for Journal Pages.
- Archive, forget, retry, cancellation, and availability states.
- Body-free notebook activity.

### Not included

- Images, drawing, audio, music, canvases, files, or executable artifacts.
- Scheduled or autonomous journal creation.
- Proactive messages or background agent society.
- Cross-resident notebook access.
- Automatic recall of Journal Pages.
- Owner editing of resident-authored page bodies.
- A universal brain dashboard, knowledge graph, or semantic-memory map.

Do not expose disabled controls or "coming soon" placeholders for deferred
capabilities. The versioned notebook-item boundary preserves that future path
without advertising functionality that does not exist.

## 3. Placement in the existing application

The Notebook lives inside the existing resident profile/inspector system. Do not
create a new application shell, full-page database route, or permanent third
column.

### Desktop hierarchy

```text
conversation-first Luca shell
  selected conversation                         dominant plane
  optional resizable resident inspector         secondary plane
    resident identity and operational status
    profile tabs
      Info
      Runtime
      Channels
      Continuity
        Handoff                                 working state
        Notebook                                authored continuity
          Continuity Notes
          Journal Pages
```

- Opening a resident from a message, member list, or agent directory may open
  the inspector, but never replace the selected conversation.
- The current resizable inspector and its overlay behavior remain authoritative.
- Use the existing resident identity specimen, readable name, and short
  fingerprint. Do not introduce a second avatar or notebook-specific identity.
- The existing **Continuity** profile tab remains the entry point. Inside it,
  Handoff and Notebook must be visually distinct peers, not one undifferentiated
  feed.
- On narrow viewports, use the shell's existing auxiliary-panel/overlay behavior.
  Preserve a clear back path from item detail to the notebook list and from the
  inspector to the conversation.

### Focal hierarchy

1. The conversation remains the primary reading surface.
2. A disclosed Journal Page may become the inspector's primary reading surface.
3. List metadata and lifecycle controls remain quiet.
4. Activity and provenance support the content; they do not compete with it.

## 4. Notebook information architecture

### Notebook overview

The Notebook overview contains:

- resident identity context inherited from the inspector;
- continuity enabled/disabled state inherited from the existing Continuity
  control;
- a quiet explanatory line: notes may support future conversations; pages do
  not enter ordinary chat unless explicitly selected for a later private
  notebook action;
- local navigation for **Continuity Notes** and **Journal Pages**;
- compact counts when known;
- one contextual primary action, **New page**, visible only in Journal Pages;
- the active body-free journal job, if one exists;
- the selected list or its availability state.

Use text tabs, an understated segmented control, or a two-row local navigation
pattern that fits the existing inspector. Avoid large tab pills or two competing
card headers.

### Sorting and pagination

- Preserve the backend's `updatedAt` newest-first list order and its revision
  order; do not independently reconstruct either order in the client.
- Render lifecycle states returned by the command. Do not invent an archive
  browser or lifecycle filter until a frozen command provides that query.
- Load the next page using the returned `nextCursor`.
- Default page size is 25; never request more than 50.
- Journal annotations belong to a page detail and should not appear as peer
  notebook entries in the primary list.

## 5. Continuity Notes

Continuity Notes are compact, source-backed records that may be recalled in a
future conversation. Their design should prioritize fast scanning and evidence.

### List row

Each note row displays:

- category in quiet mono metadata;
- one- or two-line body excerpt;
- resident or owner authorship;
- pinned correction state when true;
- source count and last-updated time;
- lifecycle state when not active;
- a disclosure affordance for detail.

Valid categories and preferred labels:

| Contract value | UI label |
|---|---|
| `decision` | Decision |
| `durable_context` | Durable context |
| `lesson` | Lesson |
| `explicit_preference` | Explicit preference |
| `commitment` | Commitment |
| `open_question` | Open question |

Rows should be separated by rhythm and hairlines, not floating cards. Category
is classification, not decoration; do not assign a rainbow of category colors.

### Note detail

The disclosed detail displays:

- full note body;
- category;
- authorship: **Kept by [resident]** or **Owner correction**;
- pinned state;
- created and updated timestamps;
- revision number and lifecycle state;
- signed source-event list with a short event reference and **Open source**;
- revision-history entry point;
- applicable actions.

Opening a source uses existing conversation navigation, expands the correct
thread when necessary, scrolls to the signed event, and leaves Notebook state
recoverable through normal back navigation.

### Note actions

- **Correct** opens an owner-authored correction editor with category and body.
  Explain that the correction becomes a visible revision; it does not rewrite
  the resident's prior words.
- **Pin correction** promotes an owner correction as authority for future
  recall. Do not imply that a resident-authored note itself can be silently
  converted into owner authority.
- **Archive** removes the note from active recall but keeps its history. Confirm
  in a lightweight dialog or inline confirmation.
- **Forget** removes the effective note body. Use a higher-friction destructive
  confirmation that distinguishes forgetting from archiving.

There is no freeform owner edit of a Journal Page through the note editor.

## 6. Journal Pages

Journal Pages are manually requested, resident-authored Markdown documents.
They should feel calmer and more deliberate than Continuity Notes.

### Page list row

Each page row displays:

- title as the primary line;
- resident authorship;
- updated time and revision number;
- selected source-event and source-page counts when nonzero;
- lifecycle state when not active;
- body excerpt only if it improves recognition without disclosing the entire
  private page in a collapsed inspector.

The list should resemble a restrained document index, not a gallery of cards.

### Deliberate disclosure

Journal bodies are private and should not appear in collapsed summaries,
Activity, notifications, search-result snippets outside the intentional
Notebook surface, tooltips, or toast messages.

Opening a page is an intentional disclosure action. Its detail view displays:

- resident identity, readable name, and short fingerprint;
- **Resident-authored Journal Page** label;
- title and rendered Markdown body;
- created/updated time, revision number, and lifecycle state;
- selected conversation references and prior-page references;
- owner annotations, clearly separated from the resident body;
- revision history;
- applicable actions.

The page body is the one dominant plane inside the inspector. Give it readable
line length, generous vertical rhythm, and normal content type. Metadata stays
mono and quiet. Render Markdown safely; no raw HTML, scripts, embedded remote
content, or executable controls.

### Page actions

- **Add annotation** creates a separate owner-authored note. It must never look
  like part of the resident's original prose.
- **Request revision** starts a new private same-resident cognition job. The
  owner may provide a prompt and select references, but cannot directly replace
  the page body.
- **Archive** preserves the page and history while removing it from the active
  index.
- **Forget** removes the effective page body after destructive confirmation.

Do not offer an ordinary **Edit** action for a resident-authored page.

## 7. New Journal Page flow

**New page** opens a focused sheet or inspector subview, not a full-screen
onboarding wizard.

### Inputs

- Optional private prompt, maximum 4 KiB.
- Optional selected signed events from the current conversation, maximum 16.
- Optional selected existing pages from this resident, maximum 5.

The selection UI must make the authority boundary clear:

- only the selected resident will author the page;
- only that resident's configured runtime and model may be used;
- selected material is private cognition input;
- no chat message will be published;
- tools, permissions, signing, and routing are unavailable;
- the result may be `no_change`.

Avoid anthropomorphic staging such as "entering a dream" or "inner life
awakening." Preferred language is direct: **Ask [resident] to create a private
journal page.**

### Submission and progress

- Starting the request returns a body-free job state.
- The form closes into a compact pending/running status above the Notebook list.
- Keep the rest of Luca usable while the job runs.
- **Cancel** remains available only when `canCancel` is true.
- A successful job opens or offers to open the new page.
- `no_change` completes calmly: **No page was added.** It is not an error.
- A failure shows the safe error code or mapped user-facing explanation, never
  the prompt or generated body.
- **Retry** appears only when `canRetry` is true and reuses backend authority;
  the UI must not synthesize a new job or replay private text itself.

## 8. Revision history and authorship

Revision history is an evidence ledger, not a raw object viewer.

Each entry displays:

- revision number;
- resident or owner authorship;
- timestamp;
- lifecycle transition;
- category/title and body where intentional disclosure permits it;
- source references;
- pinned state;
- annotations associated with the stable page lineage.

For note corrections, make before/after content legible without implying that
the earlier record disappeared. For Journal Pages, every resident-authored body
remains immutable; later bodies are new revisions. Owner annotations remain
visibly owner-authored and attached to the stable page lineage across resident
revisions.

The backend accepts stable lineage IDs as well as current revision IDs. Use the
lineage relationship for navigation; do not infer revisions from titles or
timestamps.

## 9. Availability and job states

Every state must be understandable without color or motion.

| State | Required presentation |
|---|---|
| loading | Quiet skeleton rows; do not flash an empty state. |
| `ready` | Lists and controls are available. |
| `empty` | Explain the two notebook layers; offer **New page** in Journal Pages. Do not imply meaningful chats must create notes. |
| continuity disabled | Explain that generation and conversational injection are off. Existing items may remain inspectable if the backend provides them. Offer the existing enable control. |
| `locked` | State that the encrypted notebook is locked. Keep chat unaffected. Do not show stale bodies. |
| `unavailable` | State that Notebook is temporarily unavailable and ordinary messaging still works. |
| job `pending` | Awaiting the resident runtime; cancel if permitted. |
| job `running` | Resident is creating a private page; no fake progress percentage. |
| job `completed` | Page created or `no_change`; never expose body in Activity. |
| job `cancelled` | No page was committed. Offer no retry unless `canRetry`. |
| job `failed` | Safe explanation and retry only when `canRetry`. |
| archived | Retained, excluded from active use. |
| superseded | Prior revision retained; point to current revision. |
| forgotten | Effective body unavailable; show minimum lifecycle evidence only. |

Locked, unavailable, failed, and disabled states must not disable or visually
degrade the conversation composer.

## 10. Compact chat and Activity integration

Ordinary chat may show only compact evidence such as:

- **Continuity used**
- **Notebook updated**
- **2 notes kept**

These indicators may open the resident's Notebook or provenance view. They must
not reveal note or journal bodies in the timeline.

Activity may show:

- job type;
- resident;
- pending/running/completed/cancelled/failed state;
- timestamp;
- safe error code;
- retry/cancel availability.

Activity must never contain Journal Page title/body, prompt, selected-page
content, note body, or decrypted source text.

## 11. Visual direction

This is a production Luca surface built from the established dark
graphite/slate system and the Mnemos structural grammar.

### Principles

- One dominant reading plane: conversation by default, disclosed Journal Page
  inside the inspector when intentionally opened.
- Use narrow near-black tonal steps, subtle hairlines, precise spacing, and
  shade-as-depth.
- Use readable sans for note/page content and mono only for categories,
  fingerprints, timestamps, revisions, job state, and provenance metadata.
- Prefer rows, ledgers, and open reading planes over card mosaics.
- Use the resident identity specimen as the only custom identity glyph.
- Use Lucide for utility actions.
- Preserve the existing shell's spacing, focus behavior, resize affordance, and
  responsive mechanics.
- Color is semantic only: focus, destructive action, fault, or required
  attention. Selection and ordinary active state remain tonal/monochrome.

### Avoid

- blue-tinted Buzz surfaces;
- yellow, gold, or amber as a platform accent;
- generic memory cards, chip clouds, or dashboard metrics;
- gradients, glassmorphism, ambient glow, or decorative motion;
- rounded containers around every section;
- large illustrations or centered empty-state hero layouts;
- decorative memory graphs or fake cognition telemetry;
- tiny mono text for the Journal Page body;
- simulated typewriter effects or fake progress bars.

### Motion

- Hover/focus/press: 120–180ms.
- Inspector and detail transitions: approximately 300–360ms with no more than
  6px translation.
- Job-state motion may indicate actual running work; it must stop when work
  stops.
- `prefers-reduced-motion` removes translation and pulsing while preserving all
  state labels.

## 12. Accessibility and interaction

- All controls are keyboard reachable with visible focus.
- Local tabs expose correct tab semantics or an equally clear navigation
  pattern.
- Returning from detail restores focus to the originating row.
- Actions have explicit accessible names that include the item type where
  ambiguity exists.
- Destructive confirmations identify the resident and item title/category.
- Status is always expressed in text or icon-plus-text, never color alone.
- Long bodies, titles, fingerprints, and source IDs wrap or truncate with an
  intentional disclosure path; no horizontal overflow.
- Markdown maintains semantic headings, lists, links, quotes, and code blocks.
- Do not duplicate private bodies into `aria-label`, `title`, URL parameters,
  analytics, console output, or `data-*` attributes.
- The surface must remain usable at the shell's desktop, compact desktop, and
  narrow overlay widths.

## 13. Frozen frontend contract mapping

Claude must import these types and wrappers directly from
`desktop/src/shared/api/tauriNotebook.ts`. Do not create a parallel frontend
store or redefine backend semantics.

| Interface need | Frozen wrapper/type |
|---|---|
| List and pagination | `listResidentNotebookItems` / `ResidentNotebookList` |
| Item detail | `getResidentNotebookItem` / `ResidentNotebookDetail` |
| Full history | `getResidentNotebookRevisionHistory` |
| New page | `createResidentJournalPage` |
| Resident revision | `requestResidentJournalPageRevision` |
| Cancel page job | `cancelResidentJournalPage` |
| Retry page job | `retryResidentJournalPage` |
| Current body-free activity | `getResidentJournalActivity` / `ResidentJournalJob` |
| Correct a note | `correctResidentMemoryNote` |
| Pin owner correction | `pinResidentMemoryNote` |
| Add owner annotation | `annotateResidentJournalPage` |
| Archive item | `archiveResidentNotebookItem` |
| Forget item | `forgetResidentNotebookItem` |
| Deterministic design states | `getResidentNotebookFixtures` / `ResidentNotebookFixtures` |

Current fixture coverage:

- ready list;
- empty list;
- locked list;
- unavailable list;
- item detail with two Journal Page revisions and one owner annotation;
- pending, running, completed, cancelled, and failed jobs.

Fixture mode is design evidence only. It must never persist notebook state or be
presented as native product proof.

## 14. Privacy implementation rules for the frontend

- Never place decrypted item bodies, private prompts, or selected-page content
  in local storage, session storage, URLs, telemetry, analytics, logs, toasts,
  crash breadcrumbs, or error reports.
- Do not cache decrypted notebook responses outside the component/session state
  needed to render the intentional disclosure.
- Clear detail/form state when the resident changes or the inspector closes.
- Do not optimistically display a new resident-authored body before the backend
  commits and returns it.
- Do not infer success from a job disappearing; use the returned terminal state
  and refresh through the frozen commands.
- Never provide cross-resident selectors for source pages.
- Never send page bodies through ordinary conversation APIs.

## 15. Copy guidance

Preferred:

- **Notebook**
- **Continuity Notes**
- **Journal Pages**
- **Kept by Mara from 2 signed messages**
- **Owner correction**
- **Ask Mara to create a private journal page**
- **Journal Pages are not used in ordinary conversations**
- **No page was added**
- **Notebook unavailable. You can continue chatting normally.**

Avoid:

- consciousness, sentience, soul, dream, mood, awakening, or emotional-life
  claims;
- "learned forever," "knows you," or "remembers everything";
- "resumed its session" unless native restoration is directly proven;
- language that encourages transferring a resident identity between models;
- "AI memory database," "knowledge graph," or "autonomous inner life" in V1.1;
- cheerful SaaS copy, exclamation marks, or emoji.

## 16. First visual approval slice

Build and capture these five representative states before expanding:

1. Resident Continuity tab showing distinct Handoff and Notebook navigation.
2. Continuity Notes list plus one source-backed note detail.
3. Journal Pages list plus one intentionally disclosed resident-authored page
   with an owner annotation.
4. New page flow with selected conversation evidence and a running body-free
   job.
5. One state plate covering empty, disabled, locked, unavailable, cancelled,
   and failed behavior.

Riley's approval freezes the hierarchy, row density, reading typography,
disclosure pattern, action placement, and responsive inspector behavior before
the remaining states are applied.

## 17. H18 acceptance checklist

- [ ] Conversation remains dominant when the Notebook opens.
- [ ] Handoff, Continuity Notes, and Journal Pages are conceptually distinct.
- [ ] Notes expose category, authorship, provenance, lifecycle, and history.
- [ ] Journal bodies require intentional disclosure and never appear in
      Activity or compact chat evidence.
- [ ] Owner corrections and annotations can never be mistaken for resident
      authorship.
- [ ] There is no direct owner edit action for a resident Journal Page body.
- [ ] Source-event navigation returns to the exact signed conversation event.
- [ ] New page, revision, cancel, retry, archive, forget, correction, pin, and
      annotation actions use the frozen wrappers.
- [ ] Ready, empty, disabled, loading, locked, unavailable, pending, running,
      completed, cancelled, failed, archived, superseded, and forgotten states
      are complete.
- [ ] Status remains legible without color or motion.
- [ ] Keyboard, focus restoration, reduced motion, long text, and narrow overlay
      behavior are verified.
- [ ] No private body enters logs, URLs, analytics, toasts, or body-free views.
- [ ] Focused React tests, typecheck, Biome, and visual captures pass.
- [ ] No backend, shared API, Tauri, migration, manifest, lockfile, or shell
      provider is changed in the frontend lane.

## 18. Frontend delivery package

Claude's handoff back to Codex should contain:

- exact base commit;
- one bounded frontend commit;
- list of owned files changed;
- screenshots of the five approval states at representative wide, compact, and
  narrow widths;
- fixture/version used;
- focused test, typecheck, and Biome results;
- keyboard/reduced-motion/overflow review notes;
- any missing backend capability reported as a contract gap rather than
  simulated in the UI.

Codex will then integrate the accepted frontend commit intentionally, bind it to
the same production commands, rebuild the signed macOS application, and run the
installed H19 acceptance gate.
