import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";

/**
 * An app's own way in: a new conversation, found to the app. The one
 * handler behind the `+` on an app's home in the Chats rail (WP-34) and the
 * "New conversation" at the end of the app's page head (BETA14_RELEASE.md
 * WP-37, Decided 3), so both do exactly the same thing.
 */
export function useNewAppConversation() {
  const { goNewMessage } = useAppNavigation();
  return React.useCallback(
    (family: string) => goNewMessage({ runtime: family }),
    [goNewMessage],
  );
}
