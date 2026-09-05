import { Bot } from "lucide-react";

import { formatOwnerLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type { UserSearchResult } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";

import { formatRecipientName } from "./useNewMessageRecipients";

const RESULT_ROW_INSET_DIVIDER_CLASS =
  "after:pointer-events-none after:absolute after:bottom-0 after:left-[3.75rem] after:right-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden";
function RecipientIdentity({
  displayName,
  pubkey,
}: {
  displayName: string;
  pubkey: string;
}) {
  return (
    <span
      className="block min-w-0 truncate text-sm font-medium tracking-tight"
      data-testid={`new-dm-name-${pubkey}`}
      title={`${displayName} · ${pubkey}`}
    >
      {displayName}
    </span>
  );
}

/**
 * A single selectable person/agent row in the new-message directory. Extracted
 * from the former NewDirectMessageDialog so the compose page renders identical
 * rows (avatar, agent badge, owner label, and a stable, readable name).
 */
export function NewMessageResultRow({
  currentPubkey,
  disabled,
  isAlreadySelected = false,
  isKeyboardHighlighted = false,
  onSelect,
  ownerProfiles,
  user,
}: {
  currentPubkey?: string;
  disabled: boolean;
  isAlreadySelected?: boolean;
  isKeyboardHighlighted?: boolean;
  onSelect: (user: UserSearchResult) => void;
  ownerProfiles?: UserProfileLookup;
  user: UserSearchResult;
}) {
  const name = formatRecipientName(user);
  const ownerLabel = formatOwnerLabel(
    user.ownerPubkey,
    currentPubkey,
    ownerProfiles,
  );

  return (
    <div
      className={cn("relative", RESULT_ROW_INSET_DIVIDER_CLASS)}
      data-keyboard-highlighted={isKeyboardHighlighted ? "true" : undefined}
    >
      <button
        aria-label={`${isAlreadySelected ? "Already added" : "Add"} ${name}`}
        aria-selected={isAlreadySelected || isKeyboardHighlighted}
        className={cn(
          "group/dm-result flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 ease-out hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
          isKeyboardHighlighted && "bg-muted/40",
        )}
        data-testid={`new-dm-result-${user.pubkey}`}
        disabled={disabled}
        id={`new-dm-option-${user.pubkey}`}
        onClick={() => onSelect(user)}
        role="option"
        tabIndex={-1}
        type="button"
      >
        {user.isAgent ? (
          <AgentIdentitySpecimen
            accessibleName={name}
            className="shrink-0"
            publicKey={user.pubkey}
            size={32}
          />
        ) : (
          <ProfileAvatar
            avatarUrl={user.avatarUrl}
            className="h-8 w-8 text-xs shadow-none"
            iconClassName="h-4 w-4"
            label={name}
          />
        )}
        <div className="min-w-0 flex-1">
          {user.isAgent ? (
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex min-w-0 flex-1">
                  <RecipientIdentity displayName={name} pubkey={user.pubkey} />
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Bot
                    aria-hidden="true"
                    className="h-3 w-3"
                    data-testid="new-dm-agent-icon"
                  />
                  agent
                </span>
              </div>
              {ownerLabel ? (
                <span className="block truncate text-xs text-muted-foreground">
                  managed by {ownerLabel}
                </span>
              ) : null}
            </div>
          ) : (
            <RecipientIdentity displayName={name} pubkey={user.pubkey} />
          )}
        </div>
      </button>
    </div>
  );
}
