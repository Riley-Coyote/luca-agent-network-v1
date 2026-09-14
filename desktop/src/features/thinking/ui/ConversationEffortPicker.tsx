import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  getThinkingEffortLabel,
  ThinkingEffortControl,
  type ThinkingEffortControlProps,
} from "./ThinkingEffortControl";

export type ConversationEffortPickerProps = ThinkingEffortControlProps & {
  residents: Array<{ pubkey: string; name: string }>;
  selectedPubkey: string | null;
  onSelectResident: (pubkey: string) => void;
  disabled?: boolean;
};

export function ConversationEffortPicker({
  residents,
  selectedPubkey,
  onSelectResident,
  disabled = false,
  active = true,
  testId = "conversation-thinking-effort",
  ...control
}: ConversationEffortPickerProps) {
  const [open, setOpen] = React.useState(false);
  const selectedResident = residents.find(
    (resident) => resident.pubkey === selectedPubkey,
  );
  const selectedLevel = control.effort.supported
    ? control.effort.values.find(
        (level) => level.value === control.effort.value,
      )
    : undefined;
  const label = selectedLevel ? getThinkingEffortLabel(selectedLevel) : null;

  React.useEffect(() => {
    if (!active || disabled) setOpen(false);
  }, [active, disabled]);

  return (
    <Popover open={open && active && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="thinking-effort-picker__trigger text-xs"
          data-testid="conversation-effort-picker"
          aria-label={
            label ? `Thinking effort: ${label}` : "Thinking effort settings"
          }
          disabled={disabled}
        >
          <span>Thinking{label ? ` · ${label}` : ""}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="thinking-effort-picker__content border-0"
        data-testid="conversation-effort-popover"
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
                type="button"
                key={resident.pubkey}
                className="thinking-effort-picker__resident text-xs"
                aria-pressed={resident.pubkey === selectedPubkey}
                onClick={() => onSelectResident(resident.pubkey)}
              >
                <span className="min-w-0 truncate">{resident.name}</span>
                {resident.pubkey === selectedPubkey && (
                  <Check size={13} aria-hidden="true" />
                )}
              </button>
            ))}
          </fieldset>
        )}
        {residents.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Choose a resident to set thinking effort.
          </p>
        ) : (
          <>
            <ThinkingEffortControl
              {...control}
              active={active && open && Boolean(selectedResident)}
              testId={testId}
            />
            {residents.length > 1 && selectedResident && (
              <p className="thinking-effort-picker__note text-2xs">
                Settings apply to {selectedResident.name}.
              </p>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
