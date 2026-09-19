import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  getResidentRuntimeTier,
  setResidentAccessLevel,
} from "@/shared/api/residentCapabilities";
import type { ResidentAccessLevel } from "@/shared/api/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
// Reuses the effort picker's toolbar-chip chrome (trigger/content/header/
// residents/note) — those classes are generic popover-picker styling, not
// specific to thinking effort, and sharing them keeps every composer picker
// visually consistent without a second stylesheet to keep in sync.
import "@/features/thinking/ui/thinking-effort.css";

import { AccessLevelPicker } from "./ResidentCapabilitySettings";

export type ConversationAccessPickerProps = {
  residents: Array<{ pubkey: string; name: string }>;
  selectedPubkey: string | null;
  onSelectResident: (pubkey: string) => void;
  disabled?: boolean;
};

const levelLabels: Record<"standard" | "full", string> = {
  standard: "Work in my project",
  full: "Don't ask me",
};

/** A resident still on the retired "restricted" (Manual) rung reads here as
 * the level it will actually run at — see AccessLevelPicker's doc comment. */
function displayLevel(level: ResidentAccessLevel): "standard" | "full" {
  return level === "full" ? "full" : "standard";
}

/**
 * The owner's access level for one resident, set from the composer and
 * applied without leaving the conversation (beta.13 P1). Same visual
 * language as `ConversationEffortPicker`, and the same underlying control
 * (`AccessLevelPicker`) Settings uses, so the two modes and the "Don't ask
 * me" confirmation never drift between the composer and Settings.
 */
export function ConversationAccessPicker({
  residents,
  selectedPubkey,
  onSelectResident,
  disabled = false,
}: ConversationAccessPickerProps) {
  const [open, setOpen] = React.useState(false);
  const queryClient = useQueryClient();
  const selectedResident = residents.find(
    (resident) => resident.pubkey === selectedPubkey,
  );

  const tier = useQuery({
    queryKey: ["resident-runtime-tier", selectedPubkey] as const,
    queryFn: () => getResidentRuntimeTier(selectedPubkey ?? ""),
    enabled: Boolean(selectedPubkey),
    refetchOnWindowFocus: false,
    retry: false,
  });

  React.useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const label = tier.data ? levelLabels[displayLevel(tier.data.level)] : null;

  const [pending, setPending] = React.useState(false);
  const setLevel = async (level: ResidentAccessLevel) => {
    if (!selectedPubkey) return;
    setPending(true);
    try {
      await setResidentAccessLevel(selectedPubkey, level);
      await queryClient.invalidateQueries({
        queryKey: ["resident-runtime-tier", selectedPubkey],
      });
      await queryClient.invalidateQueries({
        queryKey: ["resident-capability-settings"],
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={label ? `Access: ${label}` : "Access level settings"}
          className="thinking-effort-picker__trigger text-xs"
          data-testid="conversation-access-picker"
          disabled={disabled}
          type="button"
        >
          <span>Access{label ? ` · ${label}` : ""}</span>
          <ChevronDown aria-hidden="true" size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="thinking-effort-picker__content border-0"
        collisionPadding={12}
        data-testid="conversation-access-popover"
        side="top"
        sideOffset={8}
      >
        {residents.length === 1 && (
          <p className="thinking-effort-picker__header text-xs">
            {residents[0].name}
          </p>
        )}
        {residents.length > 1 && (
          <fieldset className="thinking-effort-picker__residents">
            <legend className="sr-only">Resident settings</legend>
            {residents.map((resident) => (
              <button
                aria-pressed={resident.pubkey === selectedPubkey}
                className="thinking-effort-picker__resident text-xs"
                key={resident.pubkey}
                onClick={() => onSelectResident(resident.pubkey)}
                type="button"
              >
                <span className="min-w-0 truncate">{resident.name}</span>
                {resident.pubkey === selectedPubkey && (
                  <Check aria-hidden="true" size={13} />
                )}
              </button>
            ))}
          </fieldset>
        )}
        {residents.length === 0 || !selectedPubkey ? (
          <p className="text-xs text-muted-foreground">
            Choose a resident to set its access level.
          </p>
        ) : (
          <div className="p-1">
            <AccessLevelPicker
              disabled={pending || tier.isLoading}
              onChange={(level) => void setLevel(level)}
              subjectLabel={selectedResident?.name ?? "This resident"}
              value={tier.data?.level ?? "standard"}
            />
            {tier.data && (
              <p className="thinking-effort-picker__note text-2xs">
                {tier.data.control === "native_mode"
                  ? "Applies right away."
                  : "Applies the next time this resident starts."}
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
