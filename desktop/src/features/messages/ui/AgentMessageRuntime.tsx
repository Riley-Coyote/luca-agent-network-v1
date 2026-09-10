import { useResidentHarness } from "@/features/agents/ResidentHarnessContext";
import { HARNESS_LABELS, HarnessLogo } from "@/shared/ui/HarnessLogo";

/** Secondary attribution for the resident's current runtime, never its identity. */
export function AgentMessageRuntime({ publicKey }: { publicKey: string }) {
  const harness = useResidentHarness(publicKey);
  if (!harness) return null;
  const label = `Current runtime: ${HARNESS_LABELS[harness]}`;
  return (
    <span
      aria-label={label}
      className="inline-flex size-3 shrink-0 self-center text-muted-foreground opacity-60"
      data-testid="message-runtime"
      role="img"
      title={label}
    >
      <HarnessLogo decorative harness={harness} size={12} />
    </span>
  );
}
