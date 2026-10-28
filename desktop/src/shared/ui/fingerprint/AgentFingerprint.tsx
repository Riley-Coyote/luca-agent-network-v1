import * as React from "react";

import { useCanonicalLucaPubkey } from "@/features/luca/canonicalLucaResident";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { AgentMark } from "@/shared/ui/AgentMark";

import {
  assignFingerprintKinds,
  type FingerprintResident,
  fingerprintSeed,
  kindFromSeed,
} from "./kinds";
import {
  type FingerprintMarkHandle,
  type FingerprintVariant,
  fingerprintRenderer,
} from "./renderer";

/**
 * The owner's agents, so each mark knows its kind: Luca first, then by
 * arrival, the first five each a different kind (WP-39, Decided 2). Without
 * it a print wears its seed's own kind.
 */
const FingerprintKindsContext = React.createContext<ReadonlyMap<
  string,
  ReturnType<typeof kindFromSeed>
> | null>(null);

export function FingerprintResidentsProvider({
  children,
  residents,
}: {
  children: React.ReactNode;
  residents: readonly FingerprintResident[];
}) {
  const lucaPubkey = useCanonicalLucaPubkey();
  const kinds = React.useMemo(
    () => assignFingerprintKinds(residents, lucaPubkey),
    [residents, lucaPubkey],
  );
  return (
    <FingerprintKindsContext.Provider value={kinds}>
      {children}
    </FingerprintKindsContext.Provider>
  );
}

/** A voice in the room: send a ring of light across an agent's print. */
export function ringAgentFingerprint(
  residentKey: string,
  { delayMs = 0, strength = 1 }: { delayMs?: number; strength?: number } = {},
) {
  fingerprintRenderer()?.ring(fingerprintSeed(residentKey), strength, delayMs);
}

export type AgentFingerprintProps = {
  residentKey: string;
  /** CSS pixels: 14–18 in a row, 64–128 at a page's head. */
  size?: number;
  /** `rail` is pressed in the face's own ink; `large` is black lacquer. */
  variant?: FingerprintVariant;
  working?: boolean;
  current?: boolean;
  className?: string;
};

/**
 * An agent's fingerprint: ridges grown from its key, alive at rest, quicker
 * while it works, and exactly still under Reduce Motion. Decorative: the
 * row's name labels it. Where WebGL 2 isn't offered, today's agent mark.
 */
export const AgentFingerprint = React.memo(function AgentFingerprint({
  className,
  current = false,
  residentKey,
  size = 18,
  variant = size >= 40 ? "large" : "rail",
  working = false,
}: AgentFingerprintProps) {
  const lucaPubkey = useCanonicalLucaPubkey();
  const kinds = React.useContext(FingerprintKindsContext);
  const seed = fingerprintSeed(residentKey, lucaPubkey);
  const kind = kinds?.get(normalizePubkey(residentKey)) ?? kindFromSeed(seed);
  const [supported] = React.useState(() => fingerprintRenderer() !== null);
  const [ready, setReady] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const handleRef = React.useRef<FingerprintMarkHandle | null>(null);
  const live = React.useRef({ working, current });
  live.current = { working, current };

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const renderer = fingerprintRenderer();
    if (!canvas || !renderer) return;
    setReady(false);
    const handle = renderer.register(canvas, {
      seed,
      kind,
      size,
      variant,
      ...live.current,
      onReady: () => setReady(true),
    });
    handleRef.current = handle;
    return () => {
      handle.dispose();
      handleRef.current = null;
    };
  }, [kind, seed, size, variant]);

  React.useEffect(() => {
    handleRef.current?.update({ working, current });
  }, [working, current]);

  if (!supported) {
    return (
      <AgentMark className={className} style={{ height: size, width: size }} />
    );
  }

  return (
    <canvas
      aria-hidden="true"
      tabIndex={-1}
      className={cn(
        "luca-agent-fingerprint block transition-opacity duration-200 ease-out motion-reduce:transition-none",
        className,
      )}
      data-agent-fingerprint=""
      data-kind={kind}
      data-ready={ready ? "" : undefined}
      data-variant={variant}
      ref={canvasRef}
      style={{ height: size, opacity: ready ? 1 : 0, width: size }}
    />
  );
});
