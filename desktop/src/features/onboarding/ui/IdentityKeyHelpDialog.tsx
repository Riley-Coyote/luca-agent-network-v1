import * as React from "react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { ONBOARDING_INK_ICON_CLASS } from "./OnboardingChrome";
import { OnboardingFooter } from "./OnboardingFooter";

const IDENTITY_KEY_HELP_SEEN_STORAGE_KEY =
  "buzz.machine-onboarding.identity-key-help-seen.v1";
const IDENTITY_KEY_HELP_DELAY_MS = 2_000;

function hasSeenIdentityKeyHelp(): boolean {
  try {
    return (
      window.localStorage.getItem(IDENTITY_KEY_HELP_SEEN_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
}

function rememberIdentityKeyHelpSeen() {
  try {
    window.localStorage.setItem(IDENTITY_KEY_HELP_SEEN_STORAGE_KEY, "true");
  } catch {
    // The help remains available for this visit if storage is unavailable.
  }
}

export function IdentityKeyHelpDialog() {
  const [isVisible, setIsVisible] = React.useState(hasSeenIdentityKeyHelp);

  React.useEffect(() => {
    if (isVisible) return;

    const timeout = window.setTimeout(() => {
      rememberIdentityKeyHelpSeen();
      setIsVisible(true);
    }, IDENTITY_KEY_HELP_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [isVisible]);

  return (
    <Dialog>
      <OnboardingFooter className="max-w-none">
        <DialogTrigger asChild>
          <Button
            className={`text-ink-muted transition-opacity duration-300 hover:text-foreground motion-reduce:transition-none ${
              isVisible ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            data-testid="identity-key-help-trigger"
            tabIndex={isVisible ? 0 : -1}
            type="button"
            variant="link"
          >
            What’s an owner identity?
          </Button>
        </DialogTrigger>
      </OnboardingFooter>
      <DialogContent
        className="buzz-onboarding-neutral-theme max-w-[47.5rem] -translate-y-5"
        closeButtonClassName={ONBOARDING_INK_ICON_CLASS}
        data-testid="identity-key-help-dialog"
        overlayVariant="transparent"
        surface="textured"
      >
        <div className="mx-auto w-full max-w-[35rem] py-14 text-left max-sm:py-6">
          <DialogTitle className="text-balance pr-8 text-3xl font-normal text-foreground">
            What’s an identity key?
          </DialogTitle>
          <DialogDescription
            asChild
            className="mt-6 space-y-4 text-pretty text-base leading-7 text-[color:var(--buzz-onboarding-backup-ink)]"
          >
            <div>
              <p>
                Luca uses a cryptographic owner identity instead of a
                traditional account. It’s created on your device and signs
                actions as you.
              </p>
              <p>
                Your identity belongs to you. Its private signing key stays in
                your system keychain; Luca never displays or copies it in setup.
                Protected recovery and export are not available yet, so do not
                rely on this setup as a recovery mechanism.
              </p>
              <p>
                If you’re new to Luca, create an owner identity. If you already
                have a compatible Nostr identity, you can connect it instead.
              </p>
            </div>
          </DialogDescription>
        </div>
      </DialogContent>
    </Dialog>
  );
}
