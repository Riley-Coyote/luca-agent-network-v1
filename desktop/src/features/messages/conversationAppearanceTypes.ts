export const CONVERSATION_APPEARANCE_VERSION = 1 as const;

export type ConversationAppearancePreferenceV1 = {
  version: typeof CONVERSATION_APPEARANCE_VERSION;
  /** Show the trusted resident identity mark in the message gutter. */
  residentMarksInMessages: boolean;
};

export const DEFAULT_CONVERSATION_APPEARANCE: ConversationAppearancePreferenceV1 =
  {
    version: CONVERSATION_APPEARANCE_VERSION,
    residentMarksInMessages: true,
  };
