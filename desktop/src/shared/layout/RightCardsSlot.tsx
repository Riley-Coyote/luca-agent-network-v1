import * as React from "react";

/**
 * The slot beside the conversation card where right-hand panes render as
 * their own cards on the floor. Panes that live deep inside the routed tree
 * (the conversation drawer, the thread panel) portal into it so they can sit
 * beside the conversation card instead of inside it, while keeping their
 * React context. `null` means "no slot here — render inline as before".
 */
const RightCardsSlotContext = React.createContext<HTMLElement | null>(null);

export function RightCardsSlotProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);
  const value = React.useMemo(() => ({ slot, setSlot }), [slot]);
  return (
    <RightCardsSlotSetterContext.Provider value={value.setSlot}>
      <RightCardsSlotContext.Provider value={value.slot}>
        {children}
      </RightCardsSlotContext.Provider>
    </RightCardsSlotSetterContext.Provider>
  );
}

const RightCardsSlotSetterContext = React.createContext<
  ((element: HTMLElement | null) => void) | null
>(null);

/** Render exactly once, as the flex sibling after the conversation card. */
export function RightCardsSlot() {
  const setSlot = React.useContext(RightCardsSlotSetterContext);
  return <div data-luca-right-cards ref={setSlot ?? undefined} />;
}

export function useRightCardsSlot(): HTMLElement | null {
  return React.useContext(RightCardsSlotContext);
}

/**
 * Keep a nested conversation from borrowing the shell's global inspector.
 * The provider is always present so changing pane focus does not remount the
 * conversation tree; focus only changes which slot value it can see.
 */
export function RightCardsSlotBoundary({
  children,
  isolate,
}: {
  children: React.ReactNode;
  isolate: boolean;
}) {
  const parentSlot = React.useContext(RightCardsSlotContext);
  return (
    <RightCardsSlotContext.Provider value={isolate ? null : parentSlot}>
      {children}
    </RightCardsSlotContext.Provider>
  );
}
