export const CONVERSATION_APPEARANCE_VERSION = 3 as const;

export type ConversationAppearancePreferenceV3 = {
  version: typeof CONVERSATION_APPEARANCE_VERSION;
  /** Show agent names and runtime attribution above their replies. */
  agentNamesInMessages: boolean;
};

export const DEFAULT_CONVERSATION_APPEARANCE: ConversationAppearancePreferenceV3 =
  {
    version: CONVERSATION_APPEARANCE_VERSION,
    agentNamesInMessages: true,
  };
