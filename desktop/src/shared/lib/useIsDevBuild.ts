import * as React from "react";

import { getBuildIdentity } from "@/shared/api/buildIdentity";

/**
 * True when the running bundle is dev-identified (its identifier ends in
 * `.dev`). Starts false so release builds never flash a `DEV` mark.
 */
export function useIsDevBuild(): boolean {
  const [isDev, setIsDev] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void getBuildIdentity().then((identity) => {
      if (!cancelled) {
        setIsDev(identity.isDev);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return isDev;
}
