export const CONVERSATION_APPEARANCE_VERSION = 2 as const;

export type ConversationAppearancePreferenceV2 = {
  version: typeof CONVERSATION_APPEARANCE_VERSION;
  /** Show agent names above their replies; runtime attribution appears on hover. */
  agentNamesInMessages: boolean;
};

export const DEFAULT_CONVERSATION_APPEARANCE: ConversationAppearancePreferenceV2 =
  {
    version: CONVERSATION_APPEARANCE_VERSION,
    agentNamesInMessages: false,
  };
