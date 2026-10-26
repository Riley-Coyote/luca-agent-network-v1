/**
 * What the shell study shows: a week of Sam's conversations with Luca, the
 * projects, the agents, the people and the rooms, and the places beside them.
 * Sample data only; the names match the lab's ad scene (Tidepool, Atlas, Wren).
 *
 * Every chat has exactly one home (docs/luca/rail-system/SPEC.md, amended
 * 2026-10-25): a project's rooms live under the project; Luca's side
 * conversations (Luca asking an agent or a connected app) under Luca; a 1:1
 * under its agent, or under People for a person; anything with several
 * members, or a shared room, under Rooms by its own name.
 */

export type Message = {
  /** "Sam" is the owner; anyone else is a resident. */
  from: string;
  at: string;
  text: string;
  /** A side conversation Luca is holding, shown in this conversation as a
   *  small live card that opens it (NAVIGATION.md, Chats). */
  side?: { home: string; session: string };
};

export type Session = {
  id: string;
  title: string;
  unread?: boolean;
  working?: boolean;
  /** How long ago it was last active, said quietly at the row's end. */
  ago?: string;
  messages: Message[];
};

export type HomeKind = "luca" | "project" | "agent" | "person" | "room";

export type Home = {
  id: string;
  kind: HomeKind;
  name: string;
  /** The home's own conversation: Luca's thread, an agent's 1:1, a group
   *  that has no named sessions. A project has none: it opens its last room. */
  main?: Message[];
  sessions: Session[];
  unread?: boolean;
  working?: boolean;
};

export const OWNER = "Sam";

export const HOMES: Home[] = [
  {
    id: "luca",
    kind: "luca",
    name: "Luca",
    main: [
      {
        from: "Luca",
        at: "9:12 AM",
        text: "Morning. Three things came in overnight: Atlas finished the runtime atlas, Wren drafted Monday, and the Tidepool landing copy is waiting on your notes.",
      },
      {
        from: OWNER,
        at: "9:14 AM",
        text: "Start with the landing copy. What changed since Tuesday?",
      },
      {
        from: "Luca",
        at: "9:14 AM",
        text: "Wren cut the hero line to seven words and moved pricing below the fold. Atlas checked every claim against the field guide; two needed softer wording, and they're marked in the draft.",
      },
      {
        from: OWNER,
        at: "9:20 AM",
        text: "Good. Leave pricing where it is, I'll read the rest after lunch.",
      },
      {
        from: "Luca",
        at: "9:21 AM",
        text: "Luca is asking Atlas whether the release notes are ready for your read.",
        side: { home: "luca", session: "luca-atlas" },
      },
    ],
    sessions: [
      {
        id: "luca-atlas",
        title: "Atlas · release notes",
        working: true,
        messages: [
          {
            from: "Luca",
            at: "9:21 AM",
            text: "Sam reads after lunch. Are the release notes ready for that, or should I hold them?",
          },
          {
            from: "Atlas",
            at: "9:23 AM",
            text: "Two lines left: the cache change and the update feed. Ready by noon.",
          },
        ],
      },
      {
        id: "luca-claude",
        title: "Claude Code · the build",
        ago: "1h",
        messages: [
          {
            from: "Luca",
            at: "8:02 AM",
            text: "The studio site's build fails on the image step. Can you find out why and fix it?",
          },
          {
            from: "Claude Code",
            at: "8:19 AM",
            text: "A renamed folder. Fixed, and the build passes again.",
          },
        ],
      },
    ],
  },
  {
    id: "tidepool",
    kind: "project",
    name: "Tidepool",
    sessions: [
      {
        id: "tidepool-landing",
        ago: "2h",
        title: "Landing page copy",
        messages: [
          {
            from: "Wren",
            at: "8:31 AM",
            text: "Hero, draft three: “A field guide that grows with the shore.” Seven words, no exclamation marks.",
          },
          {
            from: "Atlas",
            at: "8:44 AM",
            text: "Checked against the field guide. “Grows” holds up: the guide adds a chapter each season.",
          },
          {
            from: OWNER,
            at: "9:02 AM",
            text: "Keep it. Can the subhead say who it's for?",
          },
          {
            from: "Wren",
            at: "9:03 AM",
            text: "For families who go out at low tide. Drafting two versions now.",
          },
        ],
      },
      {
        id: "tidepool-chapter",
        ago: "1d",
        title: "Chapter nine",
        messages: [
          {
            from: "Atlas",
            at: "Yesterday",
            text: "Chapter nine is the anemones. I've pulled the 2019 survey so we can compare this spring's count against it.",
          },
          {
            from: OWNER,
            at: "Yesterday",
            text: "Lead with whatever changed most.",
          },
        ],
      },
    ],
  },
  {
    id: "studio",
    kind: "project",
    name: "Studio site",
    unread: true,
    sessions: [
      {
        id: "studio-home",
        ago: "3h",
        title: "Homepage",
        messages: [
          {
            from: "Wren",
            at: "Tue",
            text: "The homepage is down to one image and one sentence. The rest moved to the work pages.",
          },
        ],
      },
      {
        id: "studio-shop",
        ago: "20m",
        title: "Shop",
        unread: true,
        messages: [
          {
            from: "Atlas",
            at: "10:12 AM",
            text: "The print sizes are in. A3 and A2 only; the A1 proofs came back soft.",
          },
        ],
      },
    ],
  },
  {
    id: "fieldguide",
    kind: "project",
    name: "Field guide",
    sessions: [
      {
        id: "fieldguide-index",
        ago: "4d",
        title: "Index",
        messages: [
          {
            from: "Atlas",
            at: "Mon",
            text: "The index covers chapters one to eight. Nine goes in when the anemone count does.",
          },
        ],
      },
    ],
  },
  {
    id: "atlas",
    kind: "agent",
    name: "Atlas",
    working: true,
    main: [
      {
        from: "Atlas",
        at: "8:05 AM",
        text: "Two things running: release notes for beta 14, and a check of every claim in the landing copy.",
      },
    ],
    sessions: [
      {
        id: "atlas-runtime",
        ago: "9h",
        title: "Runtime atlas",
        messages: [
          {
            from: "Atlas",
            at: "Last night",
            text: "The runtime atlas finished rebuilding. Nothing moved except the Hermes profile order, which now follows last-used.",
          },
          {
            from: OWNER,
            at: "Last night",
            text: "Good. Leave it there for tonight, I will look at it after dinner.",
          },
        ],
      },
      {
        id: "atlas-release",
        title: "Release notes",
        working: true,
        messages: [
          {
            from: "Atlas",
            at: "10:20 AM",
            text: "Drafting the beta 14 notes now: the black floor, the card's grain, and the new rail. Four lines each.",
          },
        ],
      },
    ],
  },
  {
    id: "wren",
    kind: "agent",
    name: "Wren",
    main: [
      {
        from: "Wren",
        at: "7:58 AM",
        text: "Calendar's clear until ten. I moved the dentist to Thursday.",
      },
    ],
    sessions: [
      {
        id: "wren-monday",
        ago: "1d",
        title: "Monday plan",
        messages: [
          {
            from: "Wren",
            at: "8:10 AM",
            text: "Here's Monday, in the order it wants to happen: the Tidepool review at 10, the studio walk-through at 1, and an open hour at 4 for whatever the review turns up.",
          },
          {
            from: OWNER,
            at: "8:16 AM",
            text: "Move the walk-through to Tuesday. Monday's full enough.",
          },
          {
            from: "Wren",
            at: "8:16 AM",
            text: "Done: Tuesday at 1, and Monday's one o'clock is open again. I told the studio.",
          },
        ],
      },
      {
        id: "wren-tides",
        ago: "2d",
        title: "The tide tables",
        messages: [
          {
            from: "Wren",
            at: "Yesterday",
            text: "Lowest water this week is Saturday at 6:41 AM, a minus tide. That's the morning for the tide pool photos.",
          },
          { from: OWNER, at: "Yesterday", text: "Book it." },
        ],
      },
    ],
  },
  {
    id: "codex",
    kind: "agent",
    name: "Codex",
    main: [
      {
        from: "Codex",
        at: "Yesterday",
        text: "Every Polyphonic build compiles in one shared cache now. Nothing else needed to change.",
      },
    ],
    sessions: [],
  },
  {
    id: "mara",
    kind: "person",
    name: "Mara",
    main: [
      {
        from: "Mara",
        at: "Yesterday",
        text: "Saturday's low tide is at 6:40. I can be at the cove by six with the long lens.",
      },
      {
        from: OWNER,
        at: "Yesterday",
        text: "Perfect. Luca will send you the shot list tonight.",
      },
    ],
    sessions: [],
  },
  {
    id: "design-rail",
    kind: "room",
    name: "Rail glass review",
    main: [
      {
        from: "Luca",
        at: "11:02 AM",
        text: "Two directions for the frame: black, with glass marking where you are, or glass, with the marks in the card's own black.",
      },
      {
        from: "Wren",
        at: "11:04 AM",
        text: "The second makes the card feel like the one solid thing in the window.",
      },
      {
        from: "Atlas",
        at: "11:05 AM",
        text: "Worth reading the rail's words over a bright desktop before choosing.",
      },
    ],
    sessions: [],
  },
  {
    id: "design-type",
    kind: "room",
    name: "Type ramp",
    main: [
      {
        from: "Wren",
        at: "Mon",
        text: "Fewer sizes: 11, 14, 16 and 20 cover everything in the shell.",
      },
    ],
    sessions: [],
  },
  {
    id: "luca-wren",
    kind: "room",
    name: "Luca + Wren",
    main: [
      {
        from: "Luca",
        at: "Tue",
        text: "Wren and I split the week: I keep the inbox, Wren keeps the calendar.",
      },
      {
        from: "Wren",
        at: "Tue",
        text: "And neither of us books anything before nine.",
      },
    ],
    sessions: [],
  },
];

/** The Chats rail's sections after Luca (NAVIGATION.md). Agents has no + of
 *  its own: a new agent is made in Agents, or by asking Luca. People and Rooms
 *  show only once there is one. */
export const SECTIONS: { kind: HomeKind; title: string; add?: string }[] = [
  { kind: "project", title: "Projects", add: "New project" },
  { kind: "agent", title: "Agents" },
  { kind: "person", title: "People" },
  { kind: "room", title: "Rooms", add: "New room" },
];

export type PlaceId =
  | "conversations"
  | "library"
  | "agents"
  | "activity"
  | "brain"
  | "settings";

export type PlaceRow = { title: string; detail: string; note?: string };

/** The pages the places open in the card. */
export const PLACE_PAGES: Record<
  Exclude<PlaceId, "conversations">,
  { title: string; groups: { label: string; rows: PlaceRow[] }[] }
> = {
  library: {
    title: "Library",
    groups: [
      {
        label: "Recent",
        rows: [
          {
            title: "Tidepool landing copy",
            detail: "Draft three",
            note: "Today",
          },
          {
            title: "Field guide, chapter nine",
            detail: "Outline",
            note: "Yesterday",
          },
          {
            title: "Rail glass plates",
            detail: "12 images",
            note: "Yesterday",
          },
          { title: "Runtime atlas", detail: "Table", note: "Oct 21" },
          { title: "Studio homepage", detail: "Page", note: "Oct 20" },
        ],
      },
    ],
  },
  agents: {
    title: "Agents",
    groups: [
      {
        label: "Agents",
        rows: [
          { title: "Luca", detail: "Claude Code", note: "Resident" },
          { title: "Atlas", detail: "Codex", note: "Working" },
          { title: "Wren", detail: "Hermes", note: "Ready" },
          { title: "Codex", detail: "Codex", note: "Ready" },
        ],
      },
      {
        label: "Runtimes",
        rows: [
          { title: "Claude Code", detail: "On this Mac", note: "Ready" },
          { title: "Codex", detail: "On this Mac", note: "Ready" },
          { title: "Hermes", detail: "On this Mac", note: "Ready" },
        ],
      },
    ],
  },
  activity: {
    title: "Activity",
    groups: [
      {
        label: "Today",
        rows: [
          {
            title: "Atlas started Release notes",
            detail: "Atlas",
            note: "10:20 AM",
          },
          {
            title: "Wren moved the walk-through to Tuesday",
            detail: "Wren",
            note: "8:16 AM",
          },
          {
            title: "Luca filed notes on the landing copy",
            detail: "Luca",
            note: "9:14 AM",
          },
          {
            title: "Atlas rebuilt the runtime atlas",
            detail: "Atlas",
            note: "Last night",
          },
        ],
      },
    ],
  },
  brain: {
    title: "Brain",
    groups: [
      {
        label: "What Luca remembers",
        rows: [
          { title: "Sam reads long drafts after lunch", detail: "Habit" },
          {
            title: "Tidepool's pricing stays below the fold",
            detail: "Decision",
          },
          { title: "Nothing is booked before nine", detail: "Preference" },
          {
            title: "The field guide adds a chapter each season",
            detail: "Fact",
          },
        ],
      },
    ],
  },
  settings: {
    title: "Settings",
    groups: [
      {
        label: "General",
        rows: [
          { title: "Notifications", detail: "Mentions and direct messages" },
          { title: "Agents and runtimes", detail: "3 runtimes ready" },
          { title: "Privacy", detail: "Everything stays on this Mac" },
        ],
      },
    ],
  },
};

// ── every place's own rail (docs/luca/rail-system/NAVIGATION.md) ─────
// The icons pick the place, the rail lists what's in it, the card shows the
// one thing picked. Chats keeps the homes above; these are the others.

/** The places with a rail of their own, beside Chats. */
export type ListPlace = "agents" | "activity" | "library" | "settings";

export type RailItem = {
  id: string;
  title: string;
  /** A quiet word at the row's end: a state, a count. */
  note?: string;
  /** The place's own first row, set apart (Luca, in Agents). */
  main?: boolean;
};

export type RailSection = { title?: string; add?: string; items: RailItem[] };

export const PLACE_RAILS: Record<ListPlace, RailSection[]> = {
  agents: [
    { items: [{ id: "luca", title: "Luca", note: "working", main: true }] },
    {
      title: "Agents",
      add: "New agent",
      items: [
        { id: "atlas", title: "Atlas", note: "working" },
        { id: "wren", title: "Wren", note: "resting" },
      ],
    },
    {
      title: "Connected",
      items: [
        { id: "claude-code", title: "Claude Code" },
        { id: "codex", title: "Codex" },
        { id: "hermes", title: "Hermes" },
      ],
    },
    {
      title: "Groups",
      add: "New group",
      items: [{ id: "design-team", title: "Design team" }],
    },
  ],
  activity: [
    {
      items: [
        { id: "needs-you", title: "Needs you", note: "2" },
        { id: "now", title: "Now" },
        { id: "side", title: "Side conversations" },
      ],
    },
    {
      title: "Signed record",
      items: [
        { id: "record-luca", title: "Luca" },
        { id: "record-atlas", title: "Atlas" },
        { id: "record-wren", title: "Wren" },
      ],
    },
  ],
  library: [
    {
      title: "Made",
      add: "Import",
      items: [
        { id: "all", title: "All" },
        { id: "prototypes", title: "Prototypes" },
        { id: "apps", title: "Apps" },
        { id: "images", title: "Images" },
        { id: "documents", title: "Documents" },
        { id: "code", title: "Code" },
      ],
    },
    {
      title: "Skills",
      items: [
        { id: "skills", title: "All" },
        { id: "skills-claude", title: "Claude Code" },
        { id: "skills-codex", title: "Codex" },
      ],
    },
    { items: [{ id: "deleted", title: "Recently deleted" }] },
  ],
  settings: [
    {
      title: "Account",
      items: [
        { id: "profile", title: "Profile & identity" },
        { id: "security", title: "Security & backup" },
      ],
    },
    {
      title: "Experience",
      items: [
        { id: "appearance", title: "Appearance" },
        { id: "notifications", title: "Notifications" },
        { id: "devices", title: "Mobile & devices" },
        { id: "shortcuts", title: "Shortcuts" },
      ],
    },
    {
      title: "Agent system",
      items: [
        { id: "agent-settings", title: "Agents" },
        { id: "connections", title: "Connections & MCP" },
        { id: "permissions", title: "Defaults & permissions" },
      ],
    },
    {
      title: "Application",
      items: [
        { id: "diagnostics", title: "Diagnostics" },
        { id: "updates", title: "Updates" },
        { id: "about", title: "About" },
      ],
    },
  ],
};

/** The row each place opens on. */
export const FIRST_PICK: Record<ListPlace, string> = {
  agents: "luca",
  activity: "needs-you",
  library: "all",
  settings: "appearance",
};

export type PlaceCard = {
  eyebrow?: string;
  title: string;
  /** A mind's space: Notebook, Self, Settings (the first is open). */
  tabs?: string[];
  groups: { label: string; rows: PlaceRow[] }[];
};

const notebook = (rows: PlaceRow[]): PlaceCard["groups"] => [
  { label: "Today", rows },
];

const MIND_TABS = ["Notebook", "Self", "Settings"];

/** What the card shows for each rail row, by `place:row`. A row with no card
 *  of its own shows its title and a quiet line. */
export const PLACE_CARDS: Record<string, PlaceCard> = {
  "agents:luca": {
    eyebrow: "Working with Atlas on the release notes",
    title: "Luca",
    tabs: MIND_TABS,
    groups: notebook([
      {
        title: "Should the Tidepool page say preview or beta?",
        detail: "Asks you",
        note: "now",
      },
      {
        title: "Drafted the release notes with Atlas",
        detail: "For you",
        note: "10:20 AM",
      },
      {
        title: "Asked Claude Code to fix the failing build",
        detail: "For you",
        note: "1:40 AM",
      },
      {
        title: "Started a drawing: tide pools at night",
        detail: "Their own",
        note: "3:30 AM",
      },
      {
        title: "A quiet night. I like the hour before Sam wakes.",
        detail: "Journal",
        note: "4:05 AM",
      },
    ]),
  },
  "agents:atlas": {
    eyebrow: "Rebuilding the runtime atlas",
    title: "Atlas",
    tabs: MIND_TABS,
    groups: notebook([
      {
        title: "Release notes, second pass",
        detail: "For you",
        note: "10:20 AM",
      },
      {
        title: "Rebuilt the runtime atlas",
        detail: "For you",
        note: "1:02 AM",
      },
    ]),
  },
  "agents:wren": {
    eyebrow: "Resting",
    title: "Wren",
    tabs: MIND_TABS,
    groups: notebook([
      {
        title: "Moved the walk-through to Tuesday",
        detail: "For you",
        note: "8:16 AM",
      },
    ]),
  },
  "agents:claude-code": {
    eyebrow: "Connected · on this Mac",
    title: "Claude Code",
    groups: [
      {
        label: "Sessions",
        rows: [
          { title: "Fix the failing build", detail: "Luca", note: "1:40 AM" },
          { title: "Landing copy pass", detail: "Sam", note: "Yesterday" },
          { title: "Rail glass plates", detail: "Luca", note: "Oct 23" },
        ],
      },
    ],
  },
  "agents:codex": {
    eyebrow: "Connected · on this Mac",
    title: "Codex",
    groups: [
      {
        label: "Sessions",
        rows: [
          { title: "Runtime atlas table", detail: "Atlas", note: "1:02 AM" },
          { title: "Release script check", detail: "Atlas", note: "Oct 22" },
        ],
      },
    ],
  },
  "agents:design-team": {
    eyebrow: "Group",
    title: "Design team",
    groups: [
      {
        label: "Members",
        rows: [
          { title: "Luca", detail: "Claude Code" },
          { title: "Wren", detail: "Hermes" },
        ],
      },
    ],
  },
  "activity:needs-you": {
    title: "Needs you",
    groups: [
      {
        label: "Waiting on you",
        rows: [
          {
            title: "Should the Tidepool page say preview or beta?",
            detail: "Luca asks",
            note: "now",
          },
          {
            title: "OK to run the release script?",
            detail: "Atlas asks",
            note: "9:40 AM",
          },
        ],
      },
    ],
  },
  "activity:now": {
    title: "Now",
    groups: PLACE_PAGES.activity.groups,
  },
  "activity:side": {
    title: "Side conversations",
    groups: [
      {
        label: "Today",
        rows: [
          {
            title: "Luca asked Atlas about the release notes",
            detail: "3 turns",
            note: "10:18 AM",
          },
          {
            title: "Wren told Luca the walk-through moved",
            detail: "1 turn",
            note: "8:16 AM",
          },
          {
            title: "Luca asked Claude Code to fix the build",
            detail: "5 turns",
            note: "1:40 AM",
          },
        ],
      },
    ],
  },
  "library:all": { title: "All", groups: PLACE_PAGES.library.groups },
  "library:documents": {
    title: "Documents",
    groups: [
      {
        label: "Recent",
        rows: PLACE_PAGES.library.groups[0].rows.filter((row) =>
          ["Draft three", "Outline"].includes(row.detail),
        ),
      },
    ],
  },
  "library:images": {
    title: "Images",
    groups: [
      {
        label: "Recent",
        rows: PLACE_PAGES.library.groups[0].rows.filter(
          (row) => row.detail === "12 images",
        ),
      },
    ],
  },
};
