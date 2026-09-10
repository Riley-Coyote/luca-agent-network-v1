/**
 * Approved Luca phosphor effort field, extracted 2026-09-10.
 * Original topology, heat, palette and paint math are preserved.
 * Native input owns semantics; this module owns decorative canvas lifecycle.
 */
export function mountPhosphorEffort({
  canvas,
  input,
  containers = [],
  themeRoot = document.documentElement,
}) {
  if (
    input.type !== "range" ||
    Number(input.min) !== 0 ||
    Number(input.max) !== 3
  )
    throw new Error("Use a native range with min=0, max=3 and step=0.001.");
  const qcCtx = canvas.getContext("2d"),
    qcEffort = input;
  if (!qcCtx) throw new Error("Canvas 2D is unavailable.");
  canvas.width = 472;
  canvas.height = 56;
  let active = true,
    destroyed = false,
    hasLayout = input.getClientRects().length > 0;
  const qcMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const qcNodes = [],
    qcOccupied = new Set();
  let qcFrame = 0,
    qcLastTime = 0,
    qcTime = 0,
    qcImpulse = 0,
    qcPrevious = Number(qcEffort.value),
    qcInset = 24;
  let qcLight = false,
    qcInk = "",
    qcColors = [];
  function qcNode(x, y, depth = 0) {
    const key = y * 84 + x;
    if (x < 0 || x >= 84 || y < 0 || y >= 10 || qcOccupied.has(key)) return;
    qcOccupied.add(key);
    qcNodes.push({
      x,
      y,
      depth,
      heat: 0,
      phase: Math.sin(x * 13.7 + y * 7.1) * 0.5 + 0.5,
    });
  }
  // A meandering spine with irregular dendritic tributaries. Fixed topology
  // avoids reseeding, shimmer, or allocations while the owner scrubs the range.
  let qcSeed = 7309,
    qcNextBranch = 2;
  const qcRandom = () => {
    qcSeed = (Math.imul(qcSeed, 1664525) + 1013904223) >>> 0;
    return qcSeed / 4294967296;
  };
  for (let x = 0, previous = 5; x < 84; x++) {
    const y = Math.round(
      4.5 + 1.25 * Math.sin(x * 0.13) + 0.65 * Math.sin(x * 0.37),
    );
    for (let j = Math.min(y, previous); j <= Math.max(y, previous); j++)
      qcNode(x, j);
    previous = y;
    if (x === qcNextBranch) {
      qcNextBranch += 3 + Math.floor(qcRandom() * 5);
      for (const sign of [-1, 1]) {
        if (qcRandom() < 0.16) continue;
        const length = 2 + Math.floor(qcRandom() * 4),
          lean = qcRandom() < 0.3 ? -1 : 1;
        let bx = x;
        for (let d = 1; d <= length; d++) {
          if (qcRandom() < 0.72) bx += lean;
          const by = y + sign * d;
          qcNode(bx, by, d);
          if (d === 2 && qcRandom() < 0.7) {
            qcNode(bx - lean, by, d + 1);
            qcNode(bx - 2 * lean, by + sign, d + 2);
          }
        }
      }
    }
  }
  function qcPalette() {
    qcLight = themeRoot.dataset.theme === "paper";
    qcInk = getComputedStyle(themeRoot).getPropertyValue("--ink").trim();
    const stops = qcLight
      ? [
          [109, 96, 127],
          [139, 61, 121],
          [184, 69, 79],
          [191, 101, 39],
          [110, 58, 22],
        ]
      : [
          [110, 89, 139],
          [180, 75, 133],
          [238, 113, 100],
          [250, 178, 76],
          [255, 242, 215],
        ];
    qcColors = Array.from({ length: 256 }, (_, i) => {
      const p = (i / 255) * 4,
        a = Math.min(3, Math.floor(p)),
        f = p - a;
      return `rgb(${stops[a].map((v, j) => Math.round(v + (stops[a + 1][j] - v) * f)).join(",")})`;
    });
  }
  qcPalette();
  function qcExtent() {
    return qcInset + (Number(qcEffort.value) / 3) * (472 - 2 * qcInset);
  }
  function qcEnergize(dt) {
    const front = qcExtent() / 5.6,
      level = Number(qcEffort.value) / 3;
    const decay = Math.exp(-dt / 0.68);
    qcImpulse *= Math.exp(-dt / 0.28);
    for (const n of qcNodes) {
      const distance = front - n.x + n.depth * 0.85;
      const phase =
        (((distance -
          qcTime * (12 + level * 5) -
          Math.sin(qcTime * 0.47) * 1.8) %
          24) +
          24) %
        24;
      const pulse = Math.exp(-(((phase - 4) / 2.2) ** 2));
      const crown =
        Math.exp(-(((distance - 3) / 4) ** 2)) * (0.38 + qcImpulse * 0.55);
      const echo = n.depth
        ? Math.max(0, Math.sin(qcTime * 0.85 - n.x * 0.17 - n.depth * 0.5)) **
            8 *
          0.42
        : 0;
      const energy =
        Math.max(pulse * (0.72 + 0.28 * n.phase), crown, echo) *
        (1 - n.depth * 0.06);
      n.heat = Math.max(n.heat * decay, energy);
    }
  }
  function qcPaint() {
    const extent = qcExtent();
    qcCtx.clearRect(0, 0, 472, 56);
    qcCtx.save();
    qcCtx.beginPath();
    qcCtx.rect(0, 0, extent, 56);
    qcCtx.clip();
    // Low-level warmth binds the grains into a fill, with no hard border.
    const wash = qcCtx.createLinearGradient(0, 0, extent, 0);
    wash.addColorStop(0, qcLight ? "#805c8510" : "#76528b16");
    wash.addColorStop(1, qcLight ? "#ad633d20" : "#ed9b6126");
    qcCtx.fillStyle = wash;
    qcCtx.fillRect(0, 0, extent, 56);
    for (const n of qcNodes) {
      const x = n.x * 5.6 + 1,
        y = n.y * 5.6 + 1;
      if (x > extent) continue;
      const edge = Math.min(1, (n.y + 1) / 2, (10 - n.y) / 2);
      const heat = n.heat;
      qcCtx.fillStyle = qcColors[Math.min(255, Math.round(heat * 255))];
      // Soft local bloom only on charged tips. No whole-canvas blur pass.
      if (heat > 0.48 && !qcLight) {
        qcCtx.globalAlpha = (heat - 0.48) * 0.16 * edge;
        qcCtx.fillRect(x - 2, y - 2, 8, 8);
      }
      qcCtx.globalAlpha = (0.09 + heat * 0.88) * edge;
      qcCtx.fillRect(x, y, 3.8, 3.8);
    }
    // Sparse, dim grain memory around the branches, not a carpet of white noise.
    qcCtx.fillStyle = qcInk;
    qcCtx.globalAlpha = qcLight ? 0.07 : 0.065;
    for (let i = 0; i < 42; i++) {
      const x = ((i * 37) % 84) * 5.6 + 1,
        y = ((i * 7) % 10) * 5.6 + 1;
      if (x < extent) qcCtx.fillRect(x, y, 2, 2);
    }
    qcCtx.restore();
  }

  function visible() {
    return (
      active &&
      !destroyed &&
      hasLayout &&
      !document.hidden &&
      containers.every((c) => !c.hidden)
    );
  }
  function stop() {
    cancelAnimationFrame(qcFrame);
    qcFrame = 0;
    qcLastTime = 0;
  }
  function draw(time) {
    qcFrame = 0;
    if (!visible() || qcMotion.matches) {
      qcLastTime = 0;
      return;
    }
    const dt = qcLastTime ? Math.min(0.05, (time - qcLastTime) / 1000) : 1 / 60;
    qcLastTime = time;
    qcTime += dt;
    qcEnergize(dt);
    qcPaint();
    qcFrame = requestAnimationFrame(draw);
  }
  function resume() {
    if (visible() && !qcMotion.matches && !qcFrame)
      qcFrame = requestAnimationFrame(draw);
  }
  function update() {
    if (destroyed) return;
    const value = Number(input.value);
    qcImpulse = Math.min(1, qcImpulse + Math.abs(value - qcPrevious) * 1.8);
    qcPrevious = value;
    if (qcMotion.matches) {
      qcTime = 1.4;
      for (const n of qcNodes) n.heat = 0;
      qcEnergize(0);
    }
    qcPaint();
    resume();
  }
  function refreshTheme() {
    if (destroyed) return;
    qcPalette();
    qcPaint();
  }
  function visibility() {
    if (visible()) {
      qcPaint();
      resume();
    } else stop();
  }
  function motion() {
    stop();
    update();
  }
  const resize = new ResizeObserver(() => {
    hasLayout = input.clientWidth > 0;
    if (hasLayout) {
      qcInset = (12 * 472) / input.clientWidth;
      qcPaint();
    }
    visibility();
  });
  const theme = new MutationObserver(refreshTheme);
  const containerObserver = new MutationObserver(visibility);
  resize.observe(input);
  theme.observe(themeRoot, {
    attributes: true,
    attributeFilter: ["data-theme", "class", "style"],
  });
  for (const container of containers)
    containerObserver.observe(container, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
  input.addEventListener("input", update);
  document.addEventListener("visibilitychange", visibility);
  qcMotion.addEventListener("change", motion);
  qcTime = 1.4;
  qcEnergize(0);
  if (input.clientWidth) qcInset = (12 * 472) / input.clientWidth;
  update();
  return {
    update,
    refreshTheme,
    setActive(value) {
      active = Boolean(value);
      visibility();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      resize.disconnect();
      theme.disconnect();
      containerObserver.disconnect();
      input.removeEventListener("input", update);
      document.removeEventListener("visibilitychange", visibility);
      qcMotion.removeEventListener("change", motion);
    },
  };
}
