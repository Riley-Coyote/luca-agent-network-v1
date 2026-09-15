import { motion, useReducedMotion } from "motion/react";
import * as React from "react";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { isLightTheme } from "@/shared/theme/theme-loader";
import { useSystemColorScheme } from "@/shared/theme/useSystemColorScheme";
import { DotSigil } from "@/shared/ui/dot-display/DotSigil";
import { SIDEBAR_WIDTH_DEFAULT } from "@/shared/ui/sidebarWidth";
import {
  POLYPHONIC_PANE_TRACK,
  polyphonicCardFrameStyle,
} from "../polyphonicOnboardingGeometry";
import { usePolyphonicFloatingWindow } from "../polyphonicFloatingWindow";
import {
  setPolyphonicScene,
  usePolyphonicScene,
} from "../polyphonicOnboardingScene";
import {
  LucaThresholdGlyph,
  POLYPHONIC_IDENTITY_SEED,
} from "./PolyphonicThresholdField";
import {
  polyphonicDarkPalette,
  polyphonicLightPalette,
} from "./PolyphonicOnboardingPresentation";

/** Canvas size of the field. Drawn once; only its placement changes. */
export const POLYPHONIC_FIELD_SIZE = 576;
/** The identity mark inside the glyph, unscaled. */
const GLYPH_SIZE = 56;
const EASE: [number, number, number, number] = [0.2, 0, 0, 1];

/** Becoming, in order. Pixel values only — WKWebView will not transition a
 *  grid template, and this has to be one continuous motion. */
const BECOMING_GROW_MS = 760;
const BECOMING_FIELD_FADE_MS = 600;
const BECOMING_SHELL_FADE_MS = 360;
const BECOMING_GLYPH_FADE_MS = 300;
/** The window is zooming while the shell grows. Hold the shell's fade until
 *  the resize has been quiet this long, so the shell never dissolves onto a
 *  window that is still smaller than it. */
const BECOMING_RESIZE_SETTLE_MS = 120;
/** …but never hold it past this, whatever the window manager is doing. */
const BECOMING_MAX_HOLD_MS = 1500;

/** Where the shell ends up: the window, with the pane as the sidebar. */
function resolveBecomingTarget() {
  const rail = document.querySelector<HTMLElement>(
    '[data-side="left"][data-state]',
  );
  const measured = rail?.getBoundingClientRect().width ?? 0;
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    paneWidth: measured > 0 ? measured : SIDEBAR_WIDTH_DEFAULT,
  };
}

/**
 * The one object of onboarding: the card's shell, the field inside it and the
 * mark at the field's heart, drawn above every onboarding tree and gate.
 *
 * See polyphonicOnboardingScene.ts for why it lives here and not in the door
 * or the card. The door and the setup frame render only their column content
 * on a transparent frame of the same geometry and publish where the pane is;
 * this layer draws the object itself, so nothing materialises on Begin, the
 * shell survives the machine → personal-home tree switch and every loading
 * gate, and at the end it grows into the application rather than being thrown
 * away. Mount once, at the top of the app.
 */
export function PolyphonicOnboardingFieldLayer() {
  const scene = usePolyphonicScene();
  // The card is the only thing on screen while the scene is floating: this
  // stamps the document and tells the native window about its stoplights.
  const floating = usePolyphonicFloatingWindow();
  const reduceMotion = useReducedMotion();
  const theme = useTheme();
  const systemColorScheme = useSystemColorScheme();
  const previousStage = React.useRef(scene.stage);
  const shellRef = React.useRef<HTMLDivElement>(null);
  const paneRef = React.useRef<HTMLDivElement>(null);
  const dendriteRef = React.useRef<HTMLDivElement>(null);
  const [becomingTarget, setBecomingTarget] = React.useState<ReturnType<
    typeof resolveBecomingTarget
  > | null>(null);
  const [shellGone, setShellGone] = React.useState(false);
  /** Resting geometry, frozen the moment becoming starts: Motion needs two
   *  numbers, and the card's own size comes from CSS until then. */
  const [restingShell, setRestingShell] = React.useState<{
    width: number;
    height: number;
    paneWidth: number;
  } | null>(null);

  const becoming = scene.stage === "becoming";
  const atDoor = scene.stage === "door";
  const anchor = scene.anchor;
  const visible = scene.stage !== "off" && anchor !== null;

  // The field swells for a beat on Begin. Nothing appears — it was already here.
  React.useEffect(() => {
    const was = previousStage.current;
    previousStage.current = scene.stage;
    if (
      was === "door" &&
      scene.stage === "opening" &&
      dendriteRef.current &&
      !reduceMotion
    ) {
      dendriteRef.current.animate(
        [
          { filter: "brightness(1)" },
          { filter: "brightness(1.9)", offset: 0.22 },
          { filter: "brightness(1)" },
        ],
        { duration: 1100, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
    }
  }, [reduceMotion, scene.stage]);

  // Becoming. Measure what the card is now, decide what the window is, and let
  // the shell grow between the two. The application is already mounted beneath.
  React.useEffect(() => {
    if (!becoming) {
      setBecomingTarget(null);
      setShellGone(false);
      setRestingShell(null);
      return;
    }
    const shell = shellRef.current;
    const pane = paneRef.current;
    if (shell && pane) {
      setRestingShell({
        width: shell.getBoundingClientRect().width,
        height: shell.getBoundingClientRect().height,
        paneWidth: pane.getBoundingClientRect().width,
      });
    }
    setBecomingTarget(resolveBecomingTarget());
    if (reduceMotion) {
      // No travel. The application is simply there.
      setPolyphonicScene({ stage: "off", anchor: null, resolving: false });
      return;
    }
    // The native window zooms at the same moment. Motion retargets an
    // in-flight animation, so every resize frame simply moves the goalposts
    // and the shell keeps growing into whatever the window has become.
    const startedAt = Date.now();
    let fadeTimer = 0;
    let offTimer = 0;
    function scheduleFade(delayMs: number) {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(offTimer);
      const capped = Math.min(delayMs, BECOMING_MAX_HOLD_MS - elapsed());
      const wait = Math.max(0, capped);
      fadeTimer = window.setTimeout(() => setShellGone(true), wait);
      offTimer = window.setTimeout(
        () =>
          setPolyphonicScene({ stage: "off", anchor: null, resolving: false }),
        wait + BECOMING_SHELL_FADE_MS + BECOMING_GLYPH_FADE_MS,
      );
    }
    function elapsed() {
      return Date.now() - startedAt;
    }
    function onResize() {
      setBecomingTarget(resolveBecomingTarget());
      // The grow still needs its full run from here, but the fade waits for
      // the window to be still — and never longer than the cap.
      scheduleFade(
        Math.max(BECOMING_GROW_MS - elapsed(), BECOMING_RESIZE_SETTLE_MS),
      );
    }
    scheduleFade(BECOMING_GROW_MS);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(fadeTimer);
      window.clearTimeout(offTimer);
    };
  }, [becoming, reduceMotion]);

  const chosenColorScheme = theme.followSystem
    ? systemColorScheme
    : isLightTheme(theme.selectedThemeName)
      ? "light"
      : "dark";
  // The production threshold is intentionally dark. The same shell in the card
  // and the handoff adopts the selected setup/app appearance.
  const isLight =
    !atDoor && scene.stage !== "opening" && chosenColorScheme === "light";
  const palette = isLight ? polyphonicLightPalette : polyphonicDarkPalette;

  if (!visible || !anchor) return null;

  const fieldScale = anchor.width / POLYPHONIC_FIELD_SIZE;
  const restingGlyphScale =
    (anchor.width / POLYPHONIC_FIELD_SIZE) * (scene.resolving ? 1.16 : 1);
  // Where the glyph is heading: the sidebar's own mark if it has published one
  // that is actually on screen, otherwise the top-left of the sidebar it would
  // have sat in. The fallback is available from the first frame, so the mark
  // always travels somewhere a person can see.
  const landing = becomingTarget
    ? (scene.landing ?? {
        x: Math.min(32, becomingTarget.paneWidth / 2),
        y: 44,
        width: 20,
      })
    : null;
  const glyphCenter = becoming && landing ? landing : anchor;
  const glyphScale =
    becoming && landing ? landing.width / GLYPH_SIZE : restingGlyphScale;

  return (
    <>
      {/* The shell: one object from the first frame to the application. It is
          below the column content the door and the card render, and above the
          canvas they paint. */}
      <motion.div
        animate={{ opacity: shellGone ? 0 : 1 }}
        aria-hidden
        className="pointer-events-none fixed inset-0 grid place-items-center"
        data-testid="polyphonic-onboarding-shell-layer"
        initial={false}
        style={{ ...palette, zIndex: becoming ? 58 : 40 }}
        transition={{
          duration: reduceMotion ? 0 : BECOMING_SHELL_FADE_MS / 1000,
          ease: EASE,
        }}
      >
        {/* A faint halo under the card, so it reads as an object floating and
            not a panel cut out of the canvas. While the card really is
            floating there is no canvas to lift it off — the halo would be the
            one thing painting the transparent margin — so it stays down. */}
        <motion.div
          animate={{ opacity: becoming || floating ? 0 : 1 }}
          className="pointer-events-none fixed h-[900px] w-[1400px]"
          initial={false}
          style={{
            left: "calc(50% - 700px)",
            top: "calc(50% - 450px)",
            background: `radial-gradient(48% 46% at 50% 50%, ${
              isLight ? "rgb(0 0 0 / 0.03)" : "rgb(255 255 255 / 0.035)"
            }, transparent 70%)`,
          }}
          transition={{ duration: reduceMotion ? 0 : 0.5, ease: EASE }}
        />
        <motion.div
          animate={
            becoming && becomingTarget
              ? {
                  width: becomingTarget.width,
                  height: becomingTarget.height,
                  borderRadius: 0,
                  borderColor: "rgba(0,0,0,0)",
                  backgroundColor: palette["--prototype-canvas"],
                  boxShadow: "0 0 0 rgba(0,0,0,0)",
                }
              : {}
          }
          className="relative flex overflow-hidden border"
          data-testid="polyphonic-onboarding-shell"
          initial={false}
          ref={shellRef}
          style={{
            width: restingShell
              ? restingShell.width
              : polyphonicCardFrameStyle.width,
            height: restingShell
              ? restingShell.height
              : polyphonicCardFrameStyle.height,
            borderRadius: 15,
            borderColor: "var(--prototype-hairline)",
            backgroundColor: "var(--prototype-raised)",
            // Floating, the window server draws the drop shadow from the
            // card's own opaque pixels; a CSS one would be painted *inside*
            // the transparent margin, beside the real one. The inset lit edge
            // is the surface itself and stays either way.
            boxShadow: floating
              ? "inset 0 1px 0 var(--prototype-hairline-soft)"
              : "inset 0 1px 0 var(--prototype-hairline-soft), 0 1px 2px rgb(0 0 0/0.08), 0 22px 64px var(--prototype-shadow)",
          }}
          transition={{
            duration: reduceMotion ? 0 : BECOMING_GROW_MS / 1000,
            ease: EASE,
          }}
        >
          {/* The pane. On becoming it is the sidebar: same recess, same hairline. */}
          <motion.div
            animate={
              becoming && becomingTarget
                ? { width: becomingTarget.paneWidth }
                : {}
            }
            className="relative shrink-0 border-r border-[var(--prototype-hairline)] bg-[var(--prototype-recessed)]"
            initial={false}
            ref={paneRef}
            style={{
              width: restingShell
                ? restingShell.paneWidth
                : POLYPHONIC_PANE_TRACK,
            }}
            transition={{
              duration: reduceMotion ? 0 : BECOMING_GROW_MS / 1000,
              ease: EASE,
            }}
          >
            <motion.div
              animate={{ opacity: becoming ? 0 : 1 }}
              className="absolute inset-0"
              initial={false}
              style={{
                background:
                  "radial-gradient(60% 55% at 50% 50%, rgb(255 255 255 / 0.028), transparent 70%)",
              }}
              transition={{ duration: reduceMotion ? 0 : 0.3, ease: EASE }}
            />
            <motion.span
              animate={{ opacity: becoming ? 0 : 1 }}
              className="absolute bottom-5 left-6 text-sm font-medium tracking-[-0.01em] text-[var(--prototype-ink)]"
              initial={false}
              transition={{ duration: reduceMotion ? 0 : 0.2, ease: EASE }}
            >
              Polyphonic
            </motion.span>
          </motion.div>
          <div className="min-w-0 flex-1" />
        </motion.div>
      </motion.div>

      {/* The field, above the column content: it is drawn over the pane the
          door and the card leave transparent for it. */}
      <motion.div
        animate={{
          opacity: becoming ? 0 : 1,
          x: anchor.x - POLYPHONIC_FIELD_SIZE / 2,
          y: anchor.y - POLYPHONIC_FIELD_SIZE / 2,
          scale: fieldScale,
        }}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[60] flex items-center justify-center"
        data-testid="polyphonic-onboarding-field"
        initial={{
          opacity: 1,
          x: anchor.x - POLYPHONIC_FIELD_SIZE / 2,
          y: anchor.y - POLYPHONIC_FIELD_SIZE / 2,
          scale: fieldScale,
        }}
        style={{
          width: POLYPHONIC_FIELD_SIZE,
          height: POLYPHONIC_FIELD_SIZE,
        }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : {
                opacity: {
                  duration: becoming ? BECOMING_FIELD_FADE_MS / 1000 : 1.1,
                  ease: EASE,
                },
                // Placement follows the pane through resizes; it should not
                // read as travel, so it is quick.
                default: { duration: 0.35, ease: EASE },
              }
        }
      >
        <motion.div
          animate={{
            opacity: atDoor ? [0.7, 0.86, 0.7] : scene.resolving ? 0.42 : 0.86,
          }}
          className="absolute inset-0"
          ref={dendriteRef}
          transition={
            atDoor && !reduceMotion
              ? {
                  duration: 12,
                  ease: "easeInOut",
                  repeat: Number.POSITIVE_INFINITY,
                }
              : {
                  duration: reduceMotion ? 0 : scene.resolving ? 1.4 : 0.6,
                  ease: EASE,
                }
          }
        >
          <DotSigil
            bloom={0.02}
            cell={4}
            dot={isLight ? "39,40,36" : "164,167,173"}
            scene="recall"
            seed={`${POLYPHONIC_IDENTITY_SEED}:threshold`}
            size={POLYPHONIC_FIELD_SIZE}
          />
        </motion.div>
      </motion.div>

      {/* The mark at the heart of the field is Luca. While Luca is being made
          ready the noise settles and the mark comes forward; when the card
          becomes the application the mark travels to the sidebar and lands on
          top of the sidebar's own, which is the same mark. */}
      <motion.div
        animate={{
          opacity: shellGone && becoming ? 0 : 1,
          x: glyphCenter.x - GLYPH_SIZE / 2,
          y: glyphCenter.y - GLYPH_SIZE / 2,
          scale: glyphScale,
          filter:
            scene.resolving && !becoming ? "brightness(1.35)" : "brightness(1)",
        }}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[60] flex items-center justify-center"
        data-testid="polyphonic-onboarding-glyph"
        initial={false}
        style={{ width: GLYPH_SIZE, height: GLYPH_SIZE }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : {
                opacity: {
                  duration: BECOMING_GLYPH_FADE_MS / 1000,
                  ease: EASE,
                },
                // Following the pane through a resize is placement, not
                // travel; the journey to the sidebar is the travel.
                x: {
                  duration: becoming ? BECOMING_GROW_MS / 1000 : 0.35,
                  ease: EASE,
                },
                y: {
                  duration: becoming ? BECOMING_GROW_MS / 1000 : 0.35,
                  ease: EASE,
                },
                default: {
                  duration: becoming ? BECOMING_GROW_MS / 1000 : 1.4,
                  ease: EASE,
                },
              }
        }
      >
        <LucaThresholdGlyph ink={isLight ? "39,40,36" : "240,240,242"} />
      </motion.div>
    </>
  );
}
