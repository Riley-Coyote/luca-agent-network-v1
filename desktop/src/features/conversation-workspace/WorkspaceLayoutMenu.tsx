import {
  Columns2,
  Grid2X2,
  LayoutPanelLeft,
  PanelsTopLeft,
  Rows2,
  Square,
} from "lucide-react";
import * as React from "react";

import type { WorkspacePreset } from "./workspaceLayout";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

const PRESETS: Array<{
  preset: WorkspacePreset;
  label: string;
  icon: typeof Square;
}> = [
  { preset: "single", label: "Single pane", icon: Square },
  { preset: "columns-2", label: "Two columns", icon: Columns2 },
  { preset: "rows-2", label: "Two rows", icon: Rows2 },
  { preset: "three", label: "Three panes", icon: LayoutPanelLeft },
  { preset: "grid-4", label: "Four panes", icon: Grid2X2 },
];

type WorkspaceLayoutControls = {
  onPresetChange: (preset: WorkspacePreset) => void;
  preset: WorkspacePreset;
};

const WorkspaceLayoutControlsContext =
  React.createContext<WorkspaceLayoutControls | null>(null);

export function WorkspaceLayoutControlsProvider({
  children,
  onPresetChange,
  preset,
}: React.PropsWithChildren<WorkspaceLayoutControls>) {
  const value = React.useMemo(
    () => ({ onPresetChange, preset }),
    [onPresetChange, preset],
  );
  return (
    <WorkspaceLayoutControlsContext.Provider value={value}>
      {children}
    </WorkspaceLayoutControlsContext.Provider>
  );
}

export function WorkspaceLayoutMenuButton() {
  const controls = React.useContext(WorkspaceLayoutControlsContext);
  if (!controls) return null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Choose conversation layout"
          data-testid="workspace-layout-menu"
          data-workspace-pane-local-control
          size="icon"
          title="Conversation layout"
          type="button"
          variant="ghost"
        >
          <PanelsTopLeft />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuRadioGroup
          onValueChange={(value) =>
            controls.onPresetChange(value as WorkspacePreset)
          }
          value={controls.preset}
        >
          {PRESETS.map(({ icon: Icon, label, preset }) => (
            <DropdownMenuRadioItem
              data-testid={`workspace-preset-${preset}`}
              key={preset}
              value={preset}
            >
              <Icon aria-hidden className="mr-2" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
