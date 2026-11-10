import {
  LAB_DM_ID,
  LAB_OWNER,
  LAB_RESIDENTS,
  LAB_ROOMS,
  type LabRoomKey,
  type LabTurn,
} from "../labScene";

export const CONVERSATION_STUDY_KEY =
  "ui-design-lab.polyphonic.conversation-polish.v1";
export const LIVING_INK_ROOM = "2dc1e09a-56af-4a34-96f2-5b76d9f12082";

export const SCENES = [
  { id: "conversation", name: "Conversation", channel: LAB_DM_ID },
  { id: "rich", name: "Code & formatting", channel: LAB_ROOMS.fieldNotes.id },
  { id: "group", name: "Multiple agents", channel: LAB_ROOMS.polyphonic.id },
  { id: "ink", name: "Living Ink", channel: LIVING_INK_ROOM },
  { id: "empty", name: "Empty chat", channel: LAB_ROOMS.drafts.id },
] as const;
export type Scene = (typeof SCENES)[number]["id"];
export type Direction = "before" | "after";
export type View = { direction: Direction; scene: Scene; light: boolean };
export const DEFAULT_VIEW: View = {
  direction: "after",
  scene: "conversation",
  light: false,
};

export function normalizeView(value: unknown): View {
  const v = value as Partial<View> | null;
  return {
    direction: v?.direction === "before" ? "before" : "after",
    scene: SCENES.some((scene) => scene.id === v?.scene)
      ? (v?.scene as Scene)
      : "conversation",
    light: v?.light === true,
  };
}

export function designBrief(view: View) {
  return `Polyphonic beta.14 · approved conversation polish and Living Ink preview

Direction: ${view.direction === "after" ? "Updated" : "Previous"}.
Scene: ${SCENES.find((scene) => scene.id === view.scene)?.name}.
Theme: ${view.light ? "Paper" : "Vitesse Black"}.

The preview renders the real App, MessageRow, Markdown and MessageComposer through the isolated shell-lab mock bridge. The messages and integrations are simulated; no provider is contacted. Browser material is the app's existing fallback, not proof of native Liquid Glass.

Before restores the previous 37rem reading measure, 6px vertical row padding, 2px column gap and -2px body offset in this lab only.
After uses the updated production components: timeline message rows alone gain a 48rem maximum measure (768 CSS px at the default root size), 16px vertical row padding, an 8px incoming author-to-body gap with no negative offset, and secondary 13px author text using the existing muted ink. Narrow panes retain the original 20px side gutters. Reading type and Markdown formatting are unchanged.

Living Ink uses Ghost mobile's Oct 27 pigment, bleeding fronts, resting clock and press spring through selectable browser text. Spatial sampling and word-by-word colour arrival are browser adaptations, not a pixel-identical Metal renderer. Existing pause, pressure, tempo, wet light and echo marks remain. Reduced motion holds a legible still field; forced colours use system text. Replay expression is a local reader action, not a send or model request.

The composer, its width and material, shell, glass, rail, agent marks, top/bottom edge effects, task cards and permissions are unchanged. Attribution remains in multi-agent chats. Preserve text-size preferences, streaming identity, selection and keyboard access. No account or installed app is changed by this preview.`;
}

const owner = LAB_OWNER.pubkey;
const luca = LAB_RESIDENTS.luca.pubkey;
const vektor = LAB_RESIDENTS.vektor.pubkey;
const anima = LAB_RESIDENTS.ziggy.pubkey;
const inlineCode = String.fromCharCode(96);
const turn = (from: string, minutesAgo: number, text: string): LabTurn => ({
  from,
  minutesAgo,
  text,
});

export const LIVING_INK_TRANSCRIPT: LabTurn[] = [
  turn(owner, 18, "Show me what you mean by words that feel alive."),
  turn(
    luca,
    16,
    "Not everything needs to move. Sometimes the difference is in how a few words arrive.\n\n[I'm glad you're here.](ink:warmth?breathe)\n\nThe colour has a little life of its own. The rest of the page stays quiet.",
  ),
  turn(owner, 13, "And when you're still working something out?"),
  turn(
    luca,
    11,
    "[I think there's something here, but I want to leave room for it to change.](ink:curiosity~calm?wet&drift)\n\nThat stays open until you answer. It isn't a certainty dressed up as one.",
  ),
  turn(
    vektor,
    8,
    "[Let the idea take shape.](ink:#4285ff~#a65cff~#ff4f91?wave)\n\nOne current through the words, not a different colour for every label.",
  ),
  turn(
    luca,
    4,
    "And when the answer matters, [this is the part I'd keep.](ink:resolve?land)\n\n[We don't have to rush it.](ink:calm?hold=0.7&linger) A pause can be part of what is said.",
  ),
];

/** Public, synthetic content. Never import a real conversation into this study. */
export const CONVERSATION_TRANSCRIPT: LabTurn[] = [
  turn(
    owner,
    48,
    "I have a few things moving at once. Can you help me figure out what to focus on today?",
  ),
  turn(
    luca,
    46,
    "I'd start with the thing that lets someone else move forward. You have a working update, a few rough edges, and a launch note waiting on a decision. The useful question is which of those is actually holding someone up.\n\nWhat's the one thing you'd feel relieved to finish before lunch?",
  ),
  turn(
    owner,
    39,
    "The update. I want it to feel finished, but I don't want another week of polishing things nobody will notice.",
  ),
  turn(
    luca,
    36,
    "Then let's draw a small finish line. The update needs to be dependable, easy to understand, and pleasant to use. It doesn't need another feature.\n\nI'd give the walkthrough one uninterrupted pass. Anything that blocks a real action gets fixed. Anything that makes you hesitate gets a closer look. Everything else goes on a short list for later.\n\nThat leaves you with a release you can explain in a sentence, rather than a collection of improvements you're still trying to make fit together.",
  ),
  turn(owner, 28, "That feels right. Can you turn that into a short plan?"),
  turn(
    luca,
    24,
    "Yes. Three things, in order:\n\n1. **Use it like someone new.** Start a conversation, ask another agent to help, and come back to the result.\n2. **Fix the moments that interrupt you.** A confusing label or a jump in the layout matters more than another setting.\n3. **Write the release note from what works.** If a change needs a long explanation, it probably isn't the headline.\n\nI'll keep the smaller ideas together so they don't disappear. You can focus on the walkthrough.",
  ),
  turn(
    luca,
    16,
    "One thing to keep: the conversation should feel like the place you return to, not a control panel you have to manage. That's the test I'd use for the little decisions too.",
  ),
];

export const CONVERSATION_ROOM_TRANSCRIPTS: Record<LabRoomKey, LabTurn[]> = {
  drafts: [],
  fieldNotes: [
    turn(
      owner,
      48,
      "Show me the implementation plan, including the small code change and what we'll check.",
    ),
    turn(
      vektor,
      42,
      `Here's the smallest useful pass. The message renderer stays in place; only the conversation's layout rules change.

## Give each turn room

Widen the reply lane on a roomy desktop, then use a stronger gap between messages than between paragraphs. The name belongs to its reply, but it shouldn't be pressed against the first line.

- **Keep the existing components.** No alternate Markdown renderer or hand-built composer.
- **Make the hierarchy predictable.**
  - The response is the primary reading layer.
  - Names identify the speaker; runtime details stay secondary.
  - Lists keep their nested structure and paragraph breaks.

### A small, scoped change

~~~css
/* Study only: the composer keeps its original measure. */
[data-conversation-study="after"]
  [data-timeline-item-key][data-luca-reading-plane] {
  max-width: 48rem;
}
~~~

The selector matters more than the number. Changing the shared ${inlineCode}--mn-reading-measure${inlineCode} would also resize the composer, so that isn't the right lever for this comparison.

| Surface | What changes | What stays |
| --- | --- | --- |
| Replies | Width and turn spacing | Inter, size and formatting |
| Author line | A clear gap above the reply | Names and attribution |
| Composer | Nothing | Geometry, material and actions |

> More space between ideas is useful. More decoration between them isn't.

## What I'll check

1. Read a short exchange and a long response at the same text size.
2. Switch between the two treatments without losing the draft.
3. Check a narrow pane, both themes, and keyboard focus.

The long-file example ${inlineCode}desktop/src/features/messages/ui/MessageRow.tsx${inlineCode} should wrap without pushing the conversation off the page. A wider code block can scroll inside its own box.`,
    ),
  ],
  polyphonic: [
    turn(
      owner,
      52,
      "I'd like both of you to look at the release note. What should lead?",
    ),
    turn(
      luca,
      48,
      "The simplest promise: you can stay in one conversation and bring other agents into the work. The dashboard and the new controls are supporting details, not the story.",
    ),
    turn(
      anima,
      42,
      "I'd make that concrete. Start with a small situation someone recognizes: you're halfway through an idea, you ask for help, and the right person picks up the next part.\n\nShow the exchange, not a list of capabilities. The experience is what makes the claim believable.",
    ),
    turn(owner, 36, "So one example, rather than a tour of every screen?"),
    turn(
      luca,
      31,
      "Exactly. One request, a quiet handoff, and a useful answer coming back. Let people see what they can do before asking them to learn how everything is arranged.",
    ),
    turn(
      anima,
      24,
      "And leave a little air around that answer. A conversation has turns; it shouldn't read like three people all edited the same paragraph.",
    ),
  ],
};
