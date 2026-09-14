import * as React from "react";

/**
 * Luca's opening offer lives inside Luca's greeting row, but sending goes
 * through the conversation's real send path, which the row does not own. The
 * pane provides it here; the row reads it. `active` is false once the owner
 * has said anything, and the offer retires.
 */
export type LucaGreetingChoicesContextValue = {
  activeMessageId: string | null;
  triggerId: string | null;
  responseIds: ReadonlySet<string>;
  options: readonly string[];
  onChoose: (choice: string) => void | Promise<void>;
};

export const LucaGreetingChoicesContext =
  React.createContext<LucaGreetingChoicesContextValue | null>(null);
