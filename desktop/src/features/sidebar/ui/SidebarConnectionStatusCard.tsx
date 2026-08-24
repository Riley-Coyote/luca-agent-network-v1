import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";

import { channelsQueryKey } from "@/features/channels/hooks";
import { describeConnectionError } from "@/features/sidebar/ui/connectionStatusCopy";
import {
  SidebarCompactActionCard,
  type SidebarActionCardSurface,
} from "@/shared/ui/sidebar-action-card";
import { Spinner } from "@/shared/ui/spinner";

type SidebarConnectionStatusCardProps = {
  className?: string;
  errorMessage: string;
  surface?: SidebarActionCardSurface;
  testId?: string;
};

/**
 * The app's connection voice when the relay ANSWERED and the answer was no
 * use — a 404 for the community, an auth refusal, a 500. (The other half,
 * "the relay is not reachable at all", is `SidebarRelayConnectionCard`; the
 * two are mutually exclusive by construction in `useSidebarRelayConnectionCard`,
 * which is why they share one slot.)
 *
 * Three properties this state has to have, all of which the raw red string it
 * replaces lacked:
 *
 *   CONTAINED — it is an object in the footer, not loose text in the channel
 *   list. Same card, same shade, same shape as the reconnect state beside it,
 *   so connection trouble always looks like connection trouble.
 *
 *   ACTIONABLE — the card IS the retry. Retry re-asks for the conversation
 *   list; there is no separate "reconnect" to explain, and no dead end.
 *
 *   SELF-CLEARING — nothing dismisses it and nothing has to. The card is
 *   mounted by the presence of a query error, so the moment a refetch
 *   succeeds it is gone. A dismissable version of a persistent problem is a
 *   way to make the app look fine while it isn't.
 */
export function SidebarConnectionStatusCard({
  className,
  errorMessage,
  surface,
  testId = "sidebar-connection-status",
}: SidebarConnectionStatusCardProps) {
  const queryClient = useQueryClient();
  const [isRetrying, setIsRetrying] = React.useState(false);
  const isMountedRef = React.useRef(true);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const copy = describeConnectionError(errorMessage);

  const handleRetry = React.useCallback(() => {
    if (isRetrying) {
      return;
    }

    setIsRetrying(true);
    void queryClient
      .refetchQueries({ queryKey: channelsQueryKey })
      .finally(() => {
        // A successful refetch unmounts this card mid-flight, so the state
        // update has to be guarded rather than assumed safe.
        if (isMountedRef.current) {
          setIsRetrying(false);
        }
      });
  }, [isRetrying, queryClient]);

  return (
    <SidebarCompactActionCard
      actionAriaLabel="Retry the connection"
      actionDisabled={isRetrying}
      actionTestId={`${testId}-retry`}
      className={className}
      description={isRetrying ? "Checking the connection" : copy.detail}
      icon={
        isRetrying ? (
          <Spinner aria-hidden="true" className="h-5 w-5 border-2" />
        ) : (
          <AlertCircle aria-hidden="true" className="h-5 w-5" />
        )
      }
      iconKey={isRetrying ? "retrying" : "problem"}
      onAction={handleRetry}
      role="status"
      surface={surface}
      testId={testId}
      title={isRetrying ? "Retrying" : copy.title}
    />
  );
}
