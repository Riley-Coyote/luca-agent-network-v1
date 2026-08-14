import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";

type NonMemberMentionDialogProps = {
  createsGroupDm?: boolean;
  error: string | null;
  isInvitePending: boolean;
  names: string[];
  onDismiss: () => void;
  onDoNothing: () => void;
  onInvite: () => void;
  open: boolean;
};

export function NonMemberMentionDialog({
  createsGroupDm = false,
  error,
  isInvitePending,
  names,
  onDismiss,
  onDoNothing,
  onInvite,
  open,
}: NonMemberMentionDialogProps) {
  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onDismiss();
        }
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {createsGroupDm
              ? "Create a group DM?"
              : "Mention people outside this channel?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {createsGroupDm ? (
              <>
                Adding {names.join(", ")} creates a separate group DM. This
                conversation stays unchanged.
              </>
            ) : (
              <>
                {names.join(", ")} {names.length === 1 ? "is" : "are"} not in
                this channel. Invite them to the channel, or send without
                inviting them.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <Button
            disabled={isInvitePending}
            onClick={onDoNothing}
            size="sm"
            type="button"
            variant="outline"
          >
            {createsGroupDm ? "Send without adding" : "Do nothing"}
          </Button>
          <Button
            disabled={isInvitePending}
            onClick={onInvite}
            size="sm"
            type="button"
          >
            {isInvitePending
              ? createsGroupDm
                ? "Creating…"
                : "Inviting..."
              : createsGroupDm
                ? "Create group DM"
                : "Invite"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
