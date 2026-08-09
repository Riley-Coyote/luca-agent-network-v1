import * as React from "react";

export type SidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  isRailDisabled: boolean;
  isResizing: boolean;
  setIsResizing: (isResizing: boolean) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number | ((width: number) => number)) => void;
  toggleSidebar: () => void;
};

export const SidebarContext = React.createContext<SidebarContextProps | null>(
  null,
);

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

export function useOptionalSidebar() {
  return React.useContext(SidebarContext);
}
