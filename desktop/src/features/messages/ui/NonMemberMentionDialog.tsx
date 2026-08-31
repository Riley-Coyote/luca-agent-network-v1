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
  error: string | null;
  isInvitePending: boolean;
  names: string[];
  onDismiss: () => void;
  onDoNothing: () => void;
  onInvite: () => void;
  open: boolean;
};

export function NonMemberMentionDialog({
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
          <AlertDialogTitle>Add people to this chat?</AlertDialogTitle>
          <AlertDialogDescription>
            {names.join(", ")} {names.length === 1 ? "is" : "are"} not in this
            chat. Add them, or send without adding them.
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
            Send without adding
          </Button>
          <Button
            disabled={isInvitePending}
            onClick={onInvite}
            size="sm"
            type="button"
          >
            {isInvitePending ? "Adding…" : "Add and send"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
