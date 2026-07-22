import { Info, LockKeyhole } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { ONBOARDING_PRIMARY_CTA_CLASS } from "./OnboardingChrome";
import { OnboardingFooter } from "./OnboardingFooter";
import {
  type OnboardingTransitionDirection,
  OnboardingSlideTransition,
} from "./OnboardingSlideTransition";
type BackupStepProps = {
  direction: OnboardingTransitionDirection;
  onBack: () => void;
  onNext: () => void;
};

/**
 * Owner identity disclosure. The private key remains in the OS keychain;
 * setup never reads, displays, or copies plaintext key material.
 */
export function BackupStep({ direction, onBack, onNext }: BackupStepProps) {
  return (
    <OnboardingSlideTransition
      className="flex min-h-0 w-full flex-col items-center"
      data-testid="onboarding-page-backup"
      direction={direction}
      transitionKey={`backup-${direction}`}
    >
      <div className="flex w-full max-w-[500px] shrink-0 flex-col text-center">
        <h1 className="text-title font-normal text-foreground">
          Your owner identity is secured
        </h1>
        <p className="mt-5 text-sm leading-6 text-foreground/80">
          Luca created a cryptographic identity for you. Its private signing key
          stays in your system keychain and is never shown or copied during
          setup.
        </p>
      </div>

      <div className="flex w-full max-w-[1040px] flex-1 flex-col justify-center py-10">
        <div
          className="mx-auto w-full max-w-[500px] rounded-xl border border-border/70 bg-muted/30 px-6 py-5 text-left"
          data-testid="onboarding-recovery-disclosure"
        >
          <div className="flex items-start gap-3">
            <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-foreground/70" />
            <div>
              <h2 className="text-sm font-medium text-foreground">
                Protected recovery is not available yet
              </h2>
              <p className="mt-2 text-sm leading-6 text-foreground/75">
                A protected export and import flow is planned for a later Luca
                update. Until then, this setup cannot export your identity and
                cannot reveal or copy its private key.
              </p>
              <Button
                aria-disabled="true"
                className="mt-4 h-8 px-3 text-xs"
                data-testid="onboarding-protected-export-unavailable"
                disabled
                type="button"
                variant="outline"
              >
                Protected export — unavailable
              </Button>
            </div>
          </div>
        </div>
        <p className="mx-auto mt-6 flex max-w-[440px] items-start justify-center gap-1.5 text-center text-xs leading-5 text-[var(--buzz-onboarding-backup-ink)]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Never share a private key. Anyone with one can act as its owner.
          </span>
        </p>
      </div>

      <OnboardingFooter>
        <Button
          className={ONBOARDING_PRIMARY_CTA_CLASS}
          data-testid="onboarding-next"
          onClick={onNext}
          type="button"
        >
          Next
        </Button>

        <Button
          className="h-9 rounded-full bg-foreground/10 px-6 hover:bg-foreground/15"
          data-testid="onboarding-back"
          onClick={onBack}
          type="button"
          variant="ghost"
        >
          Back
        </Button>
      </OnboardingFooter>
    </OnboardingSlideTransition>
  );
}
