import type {
  Channel,
  Identity,
  Profile,
  RelayEvent,
} from "@/shared/api/types";
import type { ConversationProjectContext } from "@/features/luca/context/ConversationContextComposerSurface";

export type ChannelScreenProps = {
  activeChannel: Channel | null;
  /**
   * When non-null, the main channel composer auto-submits once on mount after
   * loading the draft identified by this key. The route component clears the
   * `?autoSend` search param after the submit fires so back-navigation does
   * not re-trigger. Value must match the composer's `effectiveDraftKey`.
   */
  autoSendDraftKey: string | null;
  currentIdentity?: Identity;
  currentProfile?: Profile;
  projectContext?: ConversationProjectContext | null;
  /** Stable width of this conversation's shell when it is rendered in a tile. */
  shellWidthPx?: number;
  /** Whether the full project room navigator is actually beside this screen. */
  projectNavigatorVisible?: boolean;
  onCloseForumPost: () => void;
  onSelectForumPost: (postId: string) => void;
  selectedForumPostId: string | null;
  targetForumReplyId: string | null;
  targetMessageEvents: RelayEvent[];
  targetMessageId: string | null;
};
