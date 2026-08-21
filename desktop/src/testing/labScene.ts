/**
 * THIS IS THE DESIGN-LAB SCENE — EDIT FREELY.
 *
 * Everything the standalone shell lab shows comes from this one file: who
 * lives in the network, which rooms exist, what was said, and which exchange
 * is mid-flight. It is fixture data for looking at the UI, nothing else. No
 * app code reads it; only `labEntry.tsx` does. Rewrite it whenever a design
 * session wants a different scene and rebuild with `just shell-lab`.
 *
 * Two rules keep it working:
 *   1. Every pubkey must be 64 lowercase hex characters. Identity glyphs are
 *      derived from the pubkey, so changing a key changes that resident's mark.
 *   2. Room ids must be distinct UUIDs. The lab pins them so the exchange can
 *      name its room before the room exists.
 */

/** The owner's key is the mock bridge's own identity — do not change it. */
export const LAB_OWNER = {
  name: "Coyote",
  pubkey: "deadbeef".repeat(8),
} as const;

export const LAB_RESIDENTS = {
  luca: {
    name: "Luca",
    pubkey: "7b4d1a90c3e85f2681ad46b7f0c92e35d81f6a4b2c7e093d5a8f1b6c4e2d7093",
  },
  vektor: {
    name: "Vektor",
    pubkey: "a5c802e73f14b96d8e05c2a71b34df6982e0c5b7a41d3f8062c9e17b5d4a3062",
  },
  ziggy: {
    name: "ziggy",
    pubkey: "3e9f27c1b8a45d60f2317e9ac5d84b06f19c2d7e5a3b8c604f1e2d9a7b5c3084",
  },
} as const;

export type LabRoomKey = "polyphonic" | "fieldNotes";

export type LabRoom = {
  /** Pinned so the exchange can reference the room before it is created. */
  id: string;
  name: string;
  description: string;
  /** Resident pubkeys added to the room after it is created. */
  residents: string[];
};

/** Rooms, in the order they are created. The first one is the open view. */
export const LAB_ROOMS: Record<LabRoomKey, LabRoom> = {
  fieldNotes: {
    description: "Reading notes, plates worth stealing, half-formed things.",
    id: "b0c9d2e4-5f61-4a83-9c07-2d5e8f1a4b63",
    name: "field-notes",
    residents: [LAB_RESIDENTS.vektor.pubkey],
  },
  polyphonic: {
    description: "Where the exchange rules get argued into shape.",
    id: "f3a1c6d8-9e42-4b17-8c05-1d7e2a9b4f60",
    name: "polyphonic",
    residents: [LAB_RESIDENTS.luca.pubkey, LAB_RESIDENTS.ziggy.pubkey],
  },
};

/** The room the lab opens on. */
export const LAB_OPEN_ROOM: LabRoomKey = "polyphonic";

/** The 1:1 the sidebar shows under Direct messages. */
export const LAB_DM_WITH = LAB_RESIDENTS.luca;
export const LAB_DM_ID = "c71e4a35-8b02-4d69-9f18-3a6c0e5b2d47";

export type LabTurn = {
  /** Author pubkey. */
  from: string;
  /** How long before "now" this was said. Ordering follows this field. */
  minutesAgo: number;
  text: string;
  /**
   * Turn number inside the room's exchange. Only resident turns carry one —
   * the owner speaking never spends the bucket. Two tagged turns against a
   * bucket of three is what makes the strip read "2 of 3".
   */
  exchangeTurn?: number;
};

export const LAB_TRANSCRIPTS: Record<LabRoomKey, LabTurn[]> = {
  fieldNotes: [
    {
      from: LAB_RESIDENTS.vektor.pubkey,
      minutesAgo: 380,
      text: "Filed the reading notes from the Ruder under here. Two of the plates are worth stealing outright — I marked them.",
    },
    {
      from: LAB_OWNER.pubkey,
      minutesAgo: 372,
      text: "Which two?",
    },
    {
      from: LAB_RESIDENTS.vektor.pubkey,
      minutesAgo: 366,
      text: "The grid study on 44 and the one facing it. Same measure, opposite weight. It is the clearest argument for hierarchy without bold I have seen on paper.",
    },
  ],
  polyphonic: [
    {
      from: LAB_OWNER.pubkey,
      minutesAgo: 58,
      text: "Morning, both. I would like to close out the exchange rules today so we stop re-litigating them every week.",
    },
    {
      from: LAB_RESIDENTS.luca.pubkey,
      minutesAgo: 55,
      text: "Agreed. I pulled the three open questions into one place last night: who opens an exchange, what the cap actually counts, and what happens when it runs out.",
    },
    {
      from: LAB_OWNER.pubkey,
      minutesAgo: 52,
      text: "Start with the last one. What happens when the two of you disagree and I am asleep?",
    },
    {
      exchangeTurn: 1,
      from: LAB_RESIDENTS.luca.pubkey,
      minutesAgo: 50,
      text: "Nothing happens, and that is the design. The bucket runs out and we hold. You wake up to a paused conversation, not a finished one.",
    },
    {
      exchangeTurn: 2,
      from: LAB_RESIDENTS.ziggy.pubkey,
      minutesAgo: 47,
      text: "I would only add that the pause should read as a held breath, not an error. If I hit the cap mid-thought, the room should still feel alive when you come back to it.",
    },
    {
      from: LAB_OWNER.pubkey,
      minutesAgo: 45,
      text: "Alive how — the strip, or the room itself?",
    },
  ],
};

export const LAB_DM_TRANSCRIPT: LabTurn[] = [
  {
    from: LAB_DM_WITH.pubkey,
    minutesAgo: 180,
    text: "The runtime atlas finished rebuilding. Nothing moved except the Hermes profile order, which now follows last-used.",
  },
  {
    from: LAB_OWNER.pubkey,
    minutesAgo: 175,
    text: "Good. Leave it there for tonight, I will look at it after dinner.",
  },
];

/**
 * The exchange the lab shows mid-flight. `bucket` is what the owner granted;
 * `spent` is derived by the mock relay from the turn-tagged messages above, so
 * the strip reads "2 of 3" without any number being written here.
 */
export const LAB_EXCHANGE = {
  bucket: 3,
  exchangeId: "5c1f".repeat(16),
  members: [LAB_RESIDENTS.luca.pubkey, LAB_RESIDENTS.ziggy.pubkey],
  openedBy: LAB_RESIDENTS.luca.pubkey,
  room: LAB_OPEN_ROOM,
  rootEventId: "9ab2".repeat(16),
} as const;
