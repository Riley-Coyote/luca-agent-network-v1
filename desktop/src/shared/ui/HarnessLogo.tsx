import chatgptLogoUrl from "@/features/onboarding/assets/harness-logos/chatgpt.png?inline";
import claudeLogoUrl from "@/features/onboarding/assets/harness-logos/claude.png?inline";
import gooseLogoUrl from "@/features/onboarding/assets/harness-logos/goose.png?inline";
import grokLogoUrl from "@/features/onboarding/assets/harness-logos/grok-mark.svg?inline";
import kimiLogoUrl from "@/features/onboarding/assets/harness-logos/kimi-mark.svg?inline";
import type { RuntimeBinding } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";

/**
 * The harness a resident runs on — the thing the owner wants to know at a
 * glance wherever an agent is listed. Ids match the ACP runtime catalog ids
 * (`claude`, `codex`, `goose`, …) and the native bindings (`hermes`,
 * `openclaw`); `other` is any command we cannot name.
 */
export type HarnessId =
  | "claude"
  | "codex"
  | "goose"
  | "grok"
  | "kimi"
  | "hermes"
  | "openclaw"
  | "buzz-agent"
  | "other";

/** One map for every surface; the onboarding picker and Doctor read it too. */
export const HARNESS_LOGOS: Partial<Record<HarnessId, string>> = {
  claude: claudeLogoUrl,
  codex: chatgptLogoUrl,
  goose: gooseLogoUrl,
  grok: grokLogoUrl,
  kimi: kimiLogoUrl,
  // hermes / openclaw: no asset in the repo yet — drop SVGs into
  // features/onboarding/assets/harness-logos and register them here.
};

export const HARNESS_LABELS: Record<HarnessId, string> = {
  "buzz-agent": "Polyphonic runtime",
  claude: "Claude Code",
  codex: "Codex",
  goose: "Goose",
  grok: "Grok",
  hermes: "Hermes",
  kimi: "Kimi Code",
  openclaw: "OpenClaw",
  other: "Runtime",
};

export function harnessIdFromRuntimeId(
  id: string | null | undefined,
): HarnessId {
  const normalized = id?.trim().toLowerCase() ?? "";
  if (!normalized) return "other";
  if (normalized.includes("hermes")) return "hermes";
  if (normalized.includes("openclaw")) return "openclaw";
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("claude")) return "claude";
  if (normalized.includes("goose")) return "goose";
  if (normalized.includes("grok")) return "grok";
  if (normalized.includes("kimi")) return "kimi";
  if (normalized === "buzz-agent") return "buzz-agent";
  return "other";
}

/** The harness of a managed agent: a native binding wins over the command. */
export function harnessIdForAgent(agent: {
  agentCommand?: string | null;
  nativeRuntimeBinding?: RuntimeBinding | null;
}): HarnessId {
  const native = agent.nativeRuntimeBinding?.kind;
  if (native === "hermes" || native === "openclaw") return native;
  return harnessIdFromRuntimeId(agent.agentCommand);
}

/** Whether a harness has a drawable logo (vs. a monogram stand-in). */
export function harnessHasLogo(harness: HarnessId): boolean {
  return HARNESS_LOGOS[harness] !== undefined;
}

type HarnessLogoProps = {
  accessibleName?: string;
  appearance?: "monochrome" | "brand";
  className?: string;
  decorative?: boolean;
  harness: HarnessId;
  size?: number;
  testId?: string;
};

/**
 * A harness logo drawn either in the current ink or in its restrained brand
 * treatment. Monochrome mode uses the asset as an alpha mask; brand mode keeps
 * the source mark's colour. Harnesses without an asset render a quiet monogram.
 */
export function HarnessLogo({
  accessibleName,
  appearance = "monochrome",
  className,
  decorative = false,
  harness,
  size = 20,
  testId,
}: HarnessLogoProps) {
  const url = HARNESS_LOGOS[harness];
  const label = accessibleName ?? HARNESS_LABELS[harness];
  const accessibilityProps = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ "aria-label": label, role: "img" } as const);

  if (!url) {
    // Monogram: the harness initial in a soft tile. SVG text scales with the
    // box, so no font-size token is needed at any size.
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-[28%] bg-plate-hover text-ink-muted",
          className,
        )}
        data-harness={harness}
        data-testid={testId}
        style={{ height: size, width: size }}
        {...accessibilityProps}
      >
        <svg aria-hidden="true" className="block size-full" viewBox="0 0 20 20">
          <text
            dominantBaseline="central"
            fill="currentColor"
            fontSize="11"
            fontWeight="500"
            textAnchor="middle"
            x="10"
            y="10.5"
          >
            {HARNESS_LABELS[harness].slice(0, 1)}
          </text>
        </svg>
      </span>
    );
  }

  if (appearance === "brand") {
    return (
      <img
        alt={decorative ? "" : label}
        aria-hidden={decorative ? true : undefined}
        className={cn(
          "block shrink-0 object-contain",
          harness === "codex" && "brightness-0 dark:invert",
          harness === "grok" && "brightness-0 dark:brightness-100",
          harness === "kimi" &&
            "drop-shadow-[0_0_0.7px_rgba(0,0,0,0.9)] dark:drop-shadow-none",
          className,
        )}
        data-harness={harness}
        data-harness-appearance="brand"
        data-testid={testId}
        height={size}
        src={url}
        width={size}
      />
    );
  }

  const mask = `url("${url}")`;
  return (
    <span
      className={cn("inline-block shrink-0 bg-current", className)}
      data-harness={harness}
      data-testid={testId}
      style={{
        height: size,
        maskImage: mask,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: mask,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        width: size,
      }}
      {...accessibilityProps}
    />
  );
}
