import * as React from "react";

import type { BrowseDialogType } from "@/app/AppShellOverlays";
import type { ChannelBrowserTab } from "@/features/channels/ui/ChannelBrowserDialog";

type CreatedCallback = (channelId: string) => void;

export type OpenBrowseChannelsOptions = {
  /** The tab the browser opens on (All unless said). */
  tab?: ChannelBrowserTab;
};

export function useChannelBrowserDialog(onOpen: () => void) {
  const [browseDialogType, setBrowseDialogType] =
    React.useState<BrowseDialogType>(null);
  const [browseInitialTab, setBrowseInitialTab] =
    React.useState<ChannelBrowserTab>("all");
  const createSuccessRef = React.useRef<CreatedCallback | null>(null);

  const openBrowseChannels = React.useCallback(
    (onCreated?: CreatedCallback, options?: OpenBrowseChannelsOptions) => {
      // Some callers hand this straight to onClick, so the first argument may
      // be an event rather than a callback.
      createSuccessRef.current =
        typeof onCreated === "function" ? onCreated : null;
      setBrowseInitialTab(options?.tab ?? "all");
      setBrowseDialogType("stream");
      onOpen();
    },
    [onOpen],
  );

  const onBrowseDialogOpenChange = React.useCallback((open: boolean) => {
    if (!open) {
      createSuccessRef.current = null;
      setBrowseDialogType(null);
    }
  }, []);

  const getCreateSuccess = React.useCallback(
    () => createSuccessRef.current,
    [],
  );

  return {
    browseDialogType,
    browseInitialTab,
    openBrowseChannels,
    onBrowseDialogOpenChange,
    getCreateSuccess,
  };
}
