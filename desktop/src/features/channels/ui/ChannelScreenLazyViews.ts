import * as React from "react";

// Keep this import boundary available to Rollup even though ChannelScreen now
// consumes ChannelPane directly. It prevents the pane's larger shared graph
// from being folded into the application entry chunk.
export const ChannelPane = React.lazy(async () => {
  const module = await import("@/features/channels/ui/ChannelPane");
  return { default: module.ChannelPane };
});

export const ForumView = React.lazy(async () => {
  const module = await import("@/features/forum/ui/ForumView");
  return { default: module.ForumView };
});

export const UserProfilePanel = React.lazy(async () => {
  const module = await import("@/features/profile/ui/UserProfilePanel");
  return { default: module.UserProfilePanel };
});
