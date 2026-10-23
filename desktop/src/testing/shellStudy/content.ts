/**
 * What the shell study shows: a week of Sam's conversations with Luca, the
 * projects, the agents and the fleets, and the places beside them. Sample data
 * only; the names match the lab's ad scene (Tidepool, Atlas, Wren).
 *
 * Every chat has exactly one home (docs/luca/rail-system/SPEC.md): a project's
 * rooms live under the project, a group under Fleets, a 1:1 under its agent.
 */

export type Message = {
  /** "Sam" is the owner; anyone else is a resident. */
  from: string;
  at: string;
  text: string;
};

export type Session = {
  id: string;
  title: string;
  unread?: boolean;
  working?: boolean;
  messages: Message[];
};

export type HomeKind = "luca" | "project" | "agent" | "fleet";

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
    ],
    sessions: [
      {
        id: "luca-week",
        title: "The week ahead",
        messages: [
          {
            from: "Luca",
            at: "Sun 7:40 PM",
            text: "Here's the week as it stands: the Tidepool review Monday, the studio walk-through Tuesday, and Saturday's low tide for the field guide photos.",
          },
          {
            from: OWNER,
            at: "Sun 7:52 PM",
            text: "Keep Friday clear.",
          },
        ],
      },
      {
        id: "luca-reading",
        title: "Reading list",
        messages: [
          {
            from: "Luca",
            at: "Thu 10:05 PM",
            text: "Four pieces saved this week. The one on tide-pool succession is the only long one; the rest are under ten minutes.",
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
    id: "design",
    kind: "fleet",
    name: "Design team",
    sessions: [
      {
        id: "design-rail",
        title: "Rail glass review",
        messages: [
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
      },
      {
        id: "design-type",
        title: "Type ramp",
        messages: [
          {
            from: "Wren",
            at: "Mon",
            text: "Fewer sizes: 11, 14, 16 and 20 cover everything in the shell.",
          },
        ],
      },
    ],
  },
  {
    id: "luca-wren",
    kind: "fleet",
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

export const SECTIONS: { kind: HomeKind; title: string; add: string }[] = [
  { kind: "project", title: "Projects", add: "New project" },
  { kind: "agent", title: "Agents", add: "New agent" },
  { kind: "fleet", title: "Fleets", add: "New fleet" },
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
        label: "Settings",
        rows: [
          { title: "Appearance", detail: "Vitesse Black" },
          { title: "Notifications", detail: "Mentions and direct messages" },
          { title: "Agents and runtimes", detail: "3 runtimes ready" },
          { title: "Privacy", detail: "Everything stays on this Mac" },
        ],
      },
    ],
  },
};
