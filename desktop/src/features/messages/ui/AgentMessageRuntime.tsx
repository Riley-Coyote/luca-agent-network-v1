import { useResidentHarness } from "@/features/agents/ResidentHarnessContext";
import { residentMarkKind } from "@/features/channels/lib/residentIdentity";
import { HARNESS_LABELS, HARNESS_LOGOS } from "@/shared/ui/HarnessLogo";

/** Secondary attribution for the resident's current runtime, never its identity. */
export function AgentMessageRuntime({
  publicKey,
  personaId,
}: {
  publicKey: string;
  personaId?: string | null;
}) {
  const managedHarness = useResidentHarness(publicKey);
  const kind = residentMarkKind(personaId);
  const harness = kind === "custom" ? managedHarness : kind;
  const logo = harness ? HARNESS_LOGOS[harness] : undefined;
  if (!logo || !harness) return null;
  const label = `Current runtime: ${HARNESS_LABELS[harness]}`;
  return (
    <span
      aria-label={label}
      className="luca-message-runtime inline-block size-3 shrink-0 self-center bg-current text-muted-foreground"
      data-testid="message-runtime"
      role="img"
      style={{
        maskImage: `url("${logo}")`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
      }}
      title={label}
    />
  );
}
