import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import { createVisionDataAdapter } from "@/vision-demo/VisionDataAdapter";
import { useDemoRuntime } from "@/vision-demo/demoRuntime";

export type InspectorSelection =
  | { kind: "agent"; id: string }
  | { kind: "memory"; id: string }
  | { kind: "receipt"; id: string }
  | { kind: "continuity"; id: string };

type VisionModeValue = {
  data: ReturnType<typeof createVisionDataAdapter>;
  inspector: InspectorSelection | null;
  setInspector: (selection: InspectorSelection | null) => void;
  isInspectorPinned: boolean;
  setInspectorPinned: (pinned: boolean) => void;
  isSidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  isNavigatorOpen: boolean;
  setNavigatorOpen: (open: boolean) => void;
};

const VisionModeContext = createContext<VisionModeValue | null>(null);

export function VisionModeProvider({ children }: { children: ReactNode }) {
  const runtime = useDemoRuntime();
  const data = useMemo(() => createVisionDataAdapter(runtime), [runtime]);
  const [inspector, setInspector] = useState<InspectorSelection | null>(null);
  const [isInspectorPinned, setInspectorPinned] = useState(false);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isNavigatorOpen, setNavigatorOpen] = useState(false);

  const value = useMemo(
    () => ({
      data,
      inspector,
      setInspector,
      isInspectorPinned,
      setInspectorPinned,
      isSidebarCollapsed,
      setSidebarCollapsed,
      isNavigatorOpen,
      setNavigatorOpen,
    }),
    [data, inspector, isInspectorPinned, isSidebarCollapsed, isNavigatorOpen],
  );

  return (
    <VisionModeContext.Provider value={value}>
      {children}
    </VisionModeContext.Provider>
  );
}

export function useVisionMode() {
  const value = useContext(VisionModeContext);
  if (!value) {
    throw new Error("useVisionMode must be used within VisionModeProvider");
  }
  return value;
}
