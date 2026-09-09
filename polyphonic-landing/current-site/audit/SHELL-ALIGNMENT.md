# App shell alignment — 9 September 2026

Grounded in the supplied current-app screenshots and read-only integrated source:
- AppSidebarPinnedHeader.tsx / AppSidebar.tsx: pinned search and primary navigation, scrolling conversation region.
- conversation-shell.css: Instrument Sans, neutral floor and raised conversation plane.
- MessageComposer.tsx / MessageComposerToolbar.tsx: Message… placeholder, text-and-send card, toolbar below.
- ExchangeReceiptRow.tsx: two-line names / Between agents receipt and turn count.
- ConversationContextPanel.tsx: conversation/resident drawer navigation.

Removed demo-only subtitle, suggested prompt chips, runtime chooser below chat, and invented progress-card output from the conversation. Work progress remains in the illustrative Activity/runtime views. Corrected rail proportions, DMs heading, unread indicators, profile placement, conversation measure, bubble spacing, composer colors/states and window glyphs. Split and drawer panels now occupy their own full-height column with their own header. No prototype character avatars were reintroduced.

Website controls remain deterministic. Voice control explicitly explains that recording is not connected; it never requests microphone access. All other product subpages remain illustrative and are not asserted to be exact native component reproductions. The native app and original supplied landing file were not modified.

Visually reviewed main chat, drawer, split, detached chat and 320px reflow. Regression suite covers navigation, send/draft preservation, detached synchronization, keyboard, reduced motion and cross-browser mobile. Mobile accessibility scanning is done at a settled page position rather than with provider links bisected by the sticky header.
