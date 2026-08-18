import * as React from "react";

/**
 * In a direct conversation the reply row is the only indicator that a reply is
 * coming, so it is also where the owner stops it. The pane owns the cancel path
 * (exact receipts, outcomes, toasts); the row reads this to know whether the
 * resident it is showing can be stopped, and to say "stopping" while that is
 * in flight. Absent in rooms, where the activity shelf carries Stop instead.
 */
export type ResidentStopContextValue = {
  canStop: (pubkey: string) => boolean;
  isStopping: (pubkey: string) => boolean;
  onStop: (pubkey: string) => void;
};

export const ResidentStopContext =
  React.createContext<ResidentStopContextValue | null>(null);
