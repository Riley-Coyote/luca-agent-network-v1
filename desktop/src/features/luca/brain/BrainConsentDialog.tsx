import { LockKeyhole, ShieldCheck } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export function BrainConsentDialog({
  consentCopy,
  isConnecting,
  onConfirm,
  onOpenChange,
  open,
  sourceLabel,
}: {
  consentCopy: string;
  isConnecting: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  sourceLabel: string;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-describedby="brain-consent-description"
        className="max-w-lg border border-border/70 bg-background"
        data-testid="brain-consent-dialog"
      >
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-card/50 text-muted-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <DialogTitle>Connect {sourceLabel}</DialogTitle>
          <DialogDescription
            className="text-sm leading-relaxed"
            id="brain-consent-description"
          >
            {consentCopy}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2.5 rounded-xl border border-border/55 bg-card/25 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
          <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Access starts with every current resident and automatically extends to
          residents you add later. You can exclude any resident in Details.
        </div>
        <DialogFooter>
          <Button
            disabled={isConnecting}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button disabled={isConnecting} onClick={onConfirm} type="button">
            {isConnecting ? "Connecting" : "Connect for all residents"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
