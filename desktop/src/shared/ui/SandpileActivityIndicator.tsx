import * as React from "react";

const GRID_SIZE = 32;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const CENTER = GRID_SIZE >> 1;
const RADIUS = GRID_SIZE / 2 - 0.5;
const APERTURE_INSET = 1.5;
const POUR_RATE_PER_SECOND = 16;
const HEAT_DECAY = 0.82;
const SCALE_LOG = Math.log2(4096);

const FIELD = [
  [0, 0, 0],
  [0, 0, 0],
  [6, 6, 6],
  [14, 14, 14],
] as const;

type HeatStop = readonly [number, readonly [number, number, number]];

const HEAT_STOPS: readonly HeatStop[] = [
  [0, [40, 52, 120]],
  [0.3, [95, 55, 175]],
  [0.55, [190, 55, 150]],
  [0.78, [240, 140, 55]],
  [1, [255, 238, 205]],
] as const;

function buildHeatLut() {
  const lut = new Uint8Array(256 * 3);
  for (let index = 0; index < 256; index += 1) {
    const t = index / 255;
    let lower = HEAT_STOPS[0];
    let upper = HEAT_STOPS.at(-1) ?? HEAT_STOPS[0];
    for (let stop = 0; stop < HEAT_STOPS.length - 1; stop += 1) {
      if (t >= HEAT_STOPS[stop][0] && t <= HEAT_STOPS[stop + 1][0]) {
        lower = HEAT_STOPS[stop];
        upper = HEAT_STOPS[stop + 1];
        break;
      }
    }
    const span = lower === upper ? 1 : upper[0] - lower[0];
    const progress = (t - lower[0]) / span;
    for (let channel = 0; channel < 3; channel += 1) {
      lut[index * 3 + channel] = Math.round(
        lower[1][channel] + (upper[1][channel] - lower[1][channel]) * progress,
      );
    }
  }
  return lut;
}

const HEAT_LUT = buildHeatLut();

function seedOffset(seed: string) {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % 96;
}

/**
 * A compact, circular adaptation of the original "cascade by magnitude"
 * study. The renderer samples the logical field with crisp nearest-cell colour
 * while keeping the circle edge smooth at device-pixel resolution.
 */
export function SandpileActivityIndicator({
  active = true,
  seed,
  size = 32,
}: {
  active?: boolean;
  seed: string;
  size?: number;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rebuildFrame = 0;
    let teardownRenderer = () => {};
    let backingSize = 0;

    const buildRenderer = () => {
      const bounds = canvas.getBoundingClientRect();
      const cssSize = Math.max(1, Math.min(bounds.width, bounds.height));
      const devicePixelRatio = Math.max(
        1,
        Math.min(3, window.devicePixelRatio || 1),
      );
      const physicalSize = Math.max(1, Math.round(cssSize * devicePixelRatio));
      if (physicalSize === backingSize) return;

      teardownRenderer();
      backingSize = physicalSize;
      canvas.width = physicalSize;
      canvas.height = physicalSize;
      canvas.dataset.sandpileBackingSize = String(physicalSize);
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) return;
      context.imageSmoothingEnabled = false;

      const grid = new Int16Array(CELL_COUNT);
      const delta = new Int16Array(CELL_COUNT);
      const heat = new Float32Array(CELL_COUNT);
      const magnitude = new Float32Array(CELL_COUNT);
      const mask = new Uint8Array(CELL_COUNT);
      const image = context.createImageData(physicalSize, physicalSize);
      const logicalRed = new Uint8Array(CELL_COUNT);
      const logicalGreen = new Uint8Array(CELL_COUNT);
      const logicalBlue = new Uint8Array(CELL_COUNT);
      const sourceCellByPixel = new Uint16Array(physicalSize * physicalSize);
      const coverageByPixel = new Uint8Array(physicalSize * physicalSize);
      const centerIndex = CENTER * GRID_SIZE + CENTER;

      for (let y = 0; y < GRID_SIZE; y += 1) {
        for (let x = 0; x < GRID_SIZE; x += 1) {
          const dx = x + 0.5 - GRID_SIZE / 2;
          const dy = y + 0.5 - GRID_SIZE / 2;
          if (dx * dx + dy * dy <= RADIUS * RADIUS) {
            mask[y * GRID_SIZE + x] = 1;
          }
        }
      }

      // Every device pixel samples exactly one logical cell. The only partial
      // alpha is the circle's one-device-pixel circumference; the field itself
      // is never interpolated or filtered.
      const physicalRadius = physicalSize / 2;
      for (let y = 0; y < physicalSize; y += 1) {
        const logicalY = Math.floor(
          APERTURE_INSET +
            ((y + 0.5) / physicalSize) * (GRID_SIZE - APERTURE_INSET * 2),
        );
        for (let x = 0; x < physicalSize; x += 1) {
          const pixel = y * physicalSize + x;
          const logicalX = Math.floor(
            APERTURE_INSET +
              ((x + 0.5) / physicalSize) * (GRID_SIZE - APERTURE_INSET * 2),
          );
          sourceCellByPixel[pixel] = logicalY * GRID_SIZE + logicalX;
          const dx = x + 0.5 - physicalRadius;
          const dy = y + 0.5 - physicalRadius;
          const coverage = Math.max(
            0,
            Math.min(1, physicalRadius + 0.5 - Math.hypot(dx, dy)),
          );
          coverageByPixel[pixel] = Math.round(coverage * 255);
        }
      }

      let currentAvalancheSize = 0;
      let currentScale = 0;
      let inAvalanche = false;

      const sweep = () => {
        delta.fill(0);
        let fired = 0;
        for (let y = 0; y < GRID_SIZE; y += 1) {
          for (let x = 0; x < GRID_SIZE; x += 1) {
            const index = y * GRID_SIZE + x;
            if (!mask[index] || grid[index] < 4) continue;
            delta[index] -= 4;
            if (x > 0 && mask[index - 1]) delta[index - 1] += 1;
            if (x < GRID_SIZE - 1 && mask[index + 1]) delta[index + 1] += 1;
            if (y > 0 && mask[index - GRID_SIZE]) {
              delta[index - GRID_SIZE] += 1;
            }
            if (y < GRID_SIZE - 1 && mask[index + GRID_SIZE]) {
              delta[index + GRID_SIZE] += 1;
            }
            heat[index] = 1;
            magnitude[index] = currentScale;
            fired += 1;
          }
        }
        if (fired > 0) {
          for (let index = 0; index < CELL_COUNT; index += 1) {
            grid[index] += delta[index];
          }
        }
        return fired;
      };

      const hasUnstableCell = () => {
        for (let index = 0; index < CELL_COUNT; index += 1) {
          if (mask[index] && grid[index] >= 4) return true;
        }
        return false;
      };

      // Abelian toppling makes this equivalent to the study's sequential
      // centre preseed while avoiding thousands of redundant render passes.
      grid[centerIndex] = 2600 + seedOffset(seed);
      while (hasUnstableCell()) {
        currentAvalancheSize += sweep();
        currentScale = Math.min(
          1,
          Math.log2(currentAvalancheSize + 1) / SCALE_LOG,
        );
      }
      heat.fill(0);
      magnitude.fill(0);
      currentAvalancheSize = 0;
      currentScale = 0;

      const render = () => {
        for (let index = 0; index < CELL_COUNT; index += 1) {
          const fieldColour =
            FIELD[Math.max(0, Math.min(3, mask[index] ? grid[index] : 0))];
          let red = fieldColour[0];
          let green = fieldColour[1];
          let blue = fieldColour[2];
          const liveHeat = heat[index];
          if (liveHeat > 0.004) {
            const heatIndex = Math.round(magnitude[index] * 255);
            red += (HEAT_LUT[heatIndex * 3] - red) * liveHeat;
            green += (HEAT_LUT[heatIndex * 3 + 1] - green) * liveHeat;
            blue += (HEAT_LUT[heatIndex * 3 + 2] - blue) * liveHeat;
            heat[index] = liveHeat * HEAT_DECAY;
          } else {
            heat[index] = 0;
          }
          logicalRed[index] = red;
          logicalGreen[index] = green;
          logicalBlue[index] = blue;
        }

        for (let pixel = 0; pixel < sourceCellByPixel.length; pixel += 1) {
          const source = sourceCellByPixel[pixel];
          const offset = pixel * 4;
          image.data[offset] = logicalRed[source];
          image.data[offset + 1] = logicalGreen[source];
          image.data[offset + 2] = logicalBlue[source];
          image.data[offset + 3] = coverageByPixel[pixel];
        }
        context.putImageData(image, 0, 0);
      };

      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      let localAnimationFrame = 0;
      let previousTime = performance.now();
      let grainAccumulator = 0;

      const frame = (time: number) => {
        const elapsed = Math.min(50, time - previousTime);
        previousTime = time;

        if (hasUnstableCell()) {
          inAvalanche = true;
          currentAvalancheSize += sweep();
          currentScale = Math.min(
            1,
            Math.log2(currentAvalancheSize + 1) / SCALE_LOG,
          );
        } else {
          if (inAvalanche) {
            inAvalanche = false;
            currentAvalancheSize = 0;
            currentScale = 0;
          }
          grainAccumulator += (elapsed / 1000) * POUR_RATE_PER_SECOND;
          while (grainAccumulator >= 1) {
            grid[centerIndex] += 1;
            grainAccumulator -= 1;
            currentScale = 0;
            if (grid[centerIndex] >= 4) break;
          }
        }

        render();
        localAnimationFrame = window.requestAnimationFrame(frame);
      };

      render();
      if (active && !reducedMotion) {
        localAnimationFrame = window.requestAnimationFrame(frame);
      }
      teardownRenderer = () => {
        window.cancelAnimationFrame(localAnimationFrame);
      };
    };

    const scheduleRebuild = () => {
      window.cancelAnimationFrame(rebuildFrame);
      rebuildFrame = window.requestAnimationFrame(() => {
        // A window may move between displays while its CSS size stays fixed.
        backingSize = 0;
        buildRenderer();
      });
    };

    buildRenderer();
    const resizeObserver = new ResizeObserver(scheduleRebuild);
    resizeObserver.observe(canvas);
    window.addEventListener("resize", scheduleRebuild);

    return () => {
      window.cancelAnimationFrame(rebuildFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleRebuild);
      teardownRenderer();
    };
  }, [active, seed]);

  return (
    <canvas
      className="block shrink-0"
      data-sandpile-activity
      data-sandpile-grid-size={GRID_SIZE}
      ref={canvasRef}
      style={{ height: size, imageRendering: "pixelated", width: size }}
    />
  );
}
