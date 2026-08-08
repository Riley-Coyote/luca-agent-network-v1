# Project-room blackout shell

## Product model

- The left edge is a stable global dock: Home, Inbox, Agents, Activity, projects, Settings, and owner identity.
- The adjacent navigator is contextual. Home shows direct conversations and loose rooms. A project shows only the rooms and working context attached to that project.
- A direct message is never owned by a project. A room may have one project home.
- Selecting any room or direct conversation opens its timeline immediately. Buzz/Luca event, unread, search, attachment, thread, and runtime semantics remain canonical.
- Replies expand inline. The right rail remains optional inspection space rather than a second required messaging surface.

## Material hierarchy

- Pure black is reserved for the application floor and global dock.
- Navigator, conversation, inspector, raised controls, and hover states use narrow neutral steps above black.
- Depth comes from tonal separation, hairlines, and one restrained directional edge. No gradients or ambient glow.
- The composer is compact, nearly the same value as the conversation plane, and uses a subtle top edge plus a short shadow.

## Composer contract

- Preserve rich text, mentions, emoji, attachments, formatting, reply/edit state, drag-and-drop, sending, and accessibility behavior.
- Passive layout is one compact row: add menu, editor, optional utilities, microphone affordance, round send control.
- The add menu groups secondary actions rather than permanently occupying the reading plane.
- Voice input remains visibly unavailable until a real dictation path exists; the UI must not simulate recording.

## Responsive behavior

- Desktop uses dock + contextual navigator + one dominant conversation card.
- The existing off-canvas sidebar behavior remains the mobile navigation mechanism.
- The right inspector remains optional and responsive.

## Non-goals

- No messaging transport, protocol, storage, runtime, identity, continuity, or permissions changes.
- No automatic project creation from repositories in this slice.
- No fabricated working directory, voice, or agent state.
