import { useResidentHarness } from "@/features/agents/ResidentHarnessContext";
import { cn } from "@/shared/lib/cn";
import {
  HARNESS_LABELS,
  HarnessLogo,
  harnessHasLogo,
} from "@/shared/ui/HarnessLogo";

/**
 * What a resident runs on, said quietly beside their name. The identity glyph
 * is their face; the harness is a fact about them — so it is small, in ghost
 * ink, and absent when unknown rather than replaced by a stand-in.
 */
export function ResidentHarnessMark({
  className,
  publicKey,
  size = 11,
}: {
  className?: string;
  publicKey: string;
  size?: number;
}) {
  const harness = useResidentHarness(publicKey);
  if (harness === null || !harnessHasLogo(harness)) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 self-center text-ink-ghost",
        className,
      )}
      data-testid="resident-harness-mark"
      title={`Runs on ${HARNESS_LABELS[harness]}`}
    >
      <HarnessLogo
        appearance="monochrome"
        decorative
        harness={harness}
        size={size}
      />
    </span>
  );
}
