// biome-ignore-all lint: Source-authored Mote renderer preserved from the approved design artifact.
//
// Renderers persist. A `<mote-3d>` element never owns a WebGL context: on
// connect it borrows a stage (renderer + canvas + environment) from a
// document-wide pool, and on disconnect it hands the stage back. Compiled
// shader programs and the PMREM environment stay with the stage, and the
// geometries and textures live once at module scope (mote3dScene.js), so
// opening the next conversation with a companion costs a scene graph, not a
// context and a shader compile. Per-instance materials are never disposed on
// purpose: disposing a material releases its program from three's cache, and
// the program is exactly what the next instance wants to find warm.
//
// The pool is document-scoped, not community-scoped: it holds no relay data,
// so it needs no entry in `resetCommunityState()` (desktop/CLAUDE.md,
// "Module-level singletons"). Pop-out windows are separate documents and run
// their own pool.
import {
  AMBIENT_EXPRESSIONS,
  buildScene,
  EXPRESSIONS,
  knownExpression,
  loadAssets,
} from "./mote3dScene.js";

const STAGE_POOL_MAX = 4;
const POINTER_LIVE_MS = 2600;
const WARM_TINT = "#e6efff";

// The pointer is read by every live instance; the listener exists only while
// at least one instance is live.
const pointer = { x: -1e5, y: -1e5, t: -1e5 };
const onPointerMove = (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.t = performance.now();
};
const liveInstances = new Set();
function registerLive(instance) {
  if (liveInstances.size === 0) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
  }
  liveInstances.add(instance);
}
function unregisterLive(instance) {
  liveInstances.delete(instance);
  if (liveInstances.size === 0) {
    window.removeEventListener("pointermove", onPointerMove);
  }
}

// Reduced motion is live: when it turns on, every instance renders one
// settled frame and parks; when it turns off, the loops resume.
const reducedMotionQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
let reducedMotion = reducedMotionQuery ? reducedMotionQuery.matches : false;
if (reducedMotionQuery) {
  reducedMotionQuery.addEventListener("change", (event) => {
    reducedMotion = event.matches;
    for (const instance of liveInstances) instance._schedule();
  });
}

// The device pixel ratio changes when the window moves between displays;
// re-apply it to every live stage.
function watchPixelRatio() {
  const query = window.matchMedia(
    `(resolution: ${window.devicePixelRatio}dppx)`,
  );
  query.addEventListener(
    "change",
    () => {
      for (const instance of liveInstances) instance._resize(true);
      watchPixelRatio();
    },
    { once: true },
  );
}
if (reducedMotionQuery) watchPixelRatio();

// A stage is a renderer with its canvas and its environment. Up to
// STAGE_POOL_MAX of them persist for the document's lifetime; a fifth
// simultaneous instance gets a private one that is torn down on release.
const stages = [];

function createStage(assets, pooled) {
  const { THREE } = assets;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;";
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const tex = new THREE.CanvasTexture(assets.env);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  tex.dispose();

  const stage = {
    renderer,
    canvas,
    envTarget,
    environment: envTarget.texture,
    pooled,
    busy: false,
    lost: false,
    host: null,
    w: 0,
    h: 0,
    pr: 0,
  };
  canvas.addEventListener("webglcontextlost", () => {
    stage.lost = true;
    const index = stages.indexOf(stage);
    if (index >= 0) stages.splice(index, 1);
    if (stage.host) stage.host._restage();
    else if (stage.pooled) disposeStage(stage);
  });
  return stage;
}

function disposeStage(stage) {
  stage.envTarget.dispose();
  stage.renderer.dispose();
}

function acquireStage(assets, host) {
  let stage = stages.find((s) => !s.busy && !s.lost);
  if (!stage) {
    const pooled = stages.length < STAGE_POOL_MAX;
    stage = createStage(assets, pooled);
    if (pooled) stages.push(stage);
  }
  stage.busy = true;
  stage.host = host;
  return stage;
}

function releaseStage(stage) {
  stage.busy = false;
  stage.host = null;
  stage.canvas.remove();
  if (stage.lost) return;
  if (!stage.pooled) {
    disposeStage(stage);
    stage.renderer.forceContextLoss();
  }
}

// Size a stage's drawing buffer once per distinct box and pixel ratio. A
// resize reallocates the buffer, which is the one cost a warm stage can still
// pay on a first open, so the warm-up sizes it to the box it expects.
function applyStageSize(stage, w, h) {
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  if (stage.w === w && stage.h === h && stage.pr === pr) return false;
  stage.renderer.setPixelRatio(pr);
  stage.renderer.setSize(w, h, false);
  stage.w = w;
  stage.h = h;
  stage.pr = pr;
  return true;
}

// Create the first stage at idle, size it, and compile the single-companion
// programs on it, so the first thread with a resident opens warm.
let warmP = null;
function warmStage(size) {
  if (warmP) return warmP;
  warmP = (async () => {
    const assets = await loadAssets();
    if (stages.length > 0) return;
    const stage = createStage(assets, true);
    stages.push(stage);
    const { scene, camera } = buildScene(assets, "mote", [WARM_TINT]);
    scene.environment = stage.environment;
    applyStageSize(stage, size?.width || 8, size?.height || 8);
    // Parallel compile only where the extension exists; three warns otherwise.
    if (
      typeof stage.renderer.compileAsync === "function" &&
      stage.renderer.extensions.has("KHR_parallel_shader_compile")
    ) {
      await stage.renderer.compileAsync(scene, camera);
    } else {
      stage.renderer.compile(scene, camera);
    }
    if (!stage.busy && !stage.lost) stage.renderer.render(scene, camera);
  })().catch((error) => {
    console.warn("mote3d warm", error);
  });
  return warmP;
}

class Mote3D extends HTMLElement {
  static get observedAttributes() {
    return ["expression"];
  }

  static warm(size) {
    return warmStage(size);
  }

  constructor() {
    super();
    this._live = false;
    this._built = false;
    this._fallen = false;
    this._starting = null;
    this._stage = null;
    this._canvas = null;
    this._raf = 0;
    this._visible = true;
    this._last = 0;
    this._onPoke = (event) => this._poke(event);
    this._onFrame = (now) => this._frame(now);
  }

  attributeChangedCallback(name, _oldValue, newValue) {
    if (name === "expression") {
      this._expressionMode = newValue || "ambient";
      for (const unit of this._units ?? []) unit.expressionAt = 0;
    }
  }

  connectedCallback() {
    if (this._live) return;
    this._live = true;
    this.style.display = "block";
    this.style.width = this.style.width || "100%";
    this.style.height = this.style.height || "100%";
    if (this._fallen) return;
    if (this._built) {
      this._attach();
      return;
    }
    if (!this._starting) {
      this._starting = this._start().catch((error) => {
        console.warn("mote3d", error);
        this._starting = null;
        this._fallback();
      });
    }
  }

  disconnectedCallback() {
    if (!this._live) return;
    this._live = false;
    this._detach();
  }

  _fallback() {
    if (this._fallen) return;
    this._fallen = true;
    const tints = (
      this.getAttribute("crew") ||
      this.getAttribute("tint") ||
      "#e6efff"
    )
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;justify-content:space-around;width:100%;height:100%;";
    tints.forEach((t) => {
      const d = document.createElement("div");
      d.style.cssText =
        "position:relative;width:56px;height:54px;border-radius:50% 50% 46% 46% / 54% 54% 46% 46%;" +
        "background:radial-gradient(52% 38% at 32% 14%,rgba(255,255,255,.22),transparent 62%)," +
        "radial-gradient(125% 105% at 50% -4%,#1a1d24,#0a0c11 30%,#010203 100%);" +
        "border:.5px solid " +
        t +
        "55;box-shadow:inset 0 1.5px 1px " +
        t +
        "66;";
      [12, 32].forEach((x) => {
        const e = document.createElement("div");
        e.style.cssText =
          "position:absolute;top:22px;left:" +
          x +
          "px;width:11px;height:12px;border-radius:50%;" +
          "background:radial-gradient(circle at 40% 32%,#fff,rgba(226,240,255,.5) 56%,transparent 88%);";
        d.appendChild(e);
      });
      row.appendChild(d);
    });
    this.appendChild(row);
    this.dataset.ready = "";
  }

  async _start() {
    const assets = await loadAssets();
    this._starting = null;
    if (!this._live || this._built) return;
    const kind = (this.getAttribute("species") || "mote").toLowerCase();
    const crew = this.getAttribute("crew");
    const tints = crew
      ? crew
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [this.getAttribute("tint") || "#e6efff"];
    const { scene, camera, units } = buildScene(assets, kind, tints);
    this._assets = assets;
    this._THREE = assets.THREE;
    this._scene = scene;
    this._camera = camera;
    this._units = units;
    this._expressionMode = this.getAttribute("expression") || "ambient";
    this._built = true;
    this._attach();
  }

  // Borrow a stage, put its canvas in the element, render the first frame
  // right away (the stage's programs are warm, so this is cheap), then
  // announce readiness on the next frame so the arrival can fade in.
  _attach() {
    if (this._stage || !this._live || !this._built) return;
    const stage = acquireStage(this._assets, this);
    this._stage = stage;
    this._canvas = stage.canvas;
    this._scene.environment = stage.environment;
    this.appendChild(stage.canvas);
    stage.canvas.addEventListener("pointerdown", this._onPoke);
    this._visible = true;
    this._ro = new ResizeObserver(() => this._resize(false));
    this._ro.observe(this);
    this._io = new IntersectionObserver((entries) => {
      this._visible = entries[entries.length - 1].isIntersecting;
      if (this._visible) this._schedule();
    });
    this._io.observe(this);
    registerLive(this);
    this._resize(true);
    this._last = performance.now();
    this._render();
    if (this.dataset.ready === undefined) {
      requestAnimationFrame(() => {
        if (this._live) this.dataset.ready = "";
      });
    }
    this._schedule();
  }

  _detach() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    if (this._io) {
      this._io.disconnect();
      this._io = null;
    }
    unregisterLive(this);
    const stage = this._stage;
    if (!stage) return;
    this._stage = null;
    this._canvas = null;
    stage.canvas.removeEventListener("pointerdown", this._onPoke);
    if (this._scene) this._scene.environment = null;
    releaseStage(stage);
  }

  // The stage lost its context while this instance was live: hand it back
  // (it is disposed) and borrow a fresh one. The scene graph is CPU-side
  // and survives.
  _restage() {
    if (!this._live) return;
    this._detach();
    this._attach();
  }

  _schedule() {
    if (this._raf || !this._stage || !this._live) return;
    this._raf = requestAnimationFrame(this._onFrame);
  }

  _frame(now) {
    this._raf = 0;
    if (!this._stage || !this._live) return;
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.05) dt = 0.05;
    if (!this._visible) return;
    if (reducedMotion) {
      this._render();
      return;
    }
    this._tick(dt, now / 1000);
    this._render();
    this._schedule();
  }

  _render() {
    const stage = this._stage;
    if (!stage || stage.lost) return;
    stage.renderer.render(this._scene, this._camera);
  }

  _resize(force) {
    const stage = this._stage;
    const cam = this._camera;
    if (!stage || !cam) return;
    const w = this.clientWidth || 320,
      h = this.clientHeight || 160;
    const sized = applyStageSize(stage, w, h);
    if (!force && !sized) return;

    const aspect = w / h || 1;
    const n = this._units.length;
    const vh = n > 1 ? 3.15 : 2.85;
    const vw = vh * aspect;
    this._vw = vw;

    if (cam.isOrthographicCamera) {
      cam.left = -vw / 2;
      cam.right = vw / 2;
      cam.top = vh / 2;
      cam.bottom = -vh / 2;
      cam.position.set(0, 0.06, 9);
    } else {
      cam.aspect = aspect;
      cam.position.set(
        0,
        0.06,
        vh / 2 / Math.tan((cam.fov * Math.PI) / 180 / 2),
      );
    }
    cam.lookAt(0, 0.06, 0);
    cam.updateProjectionMatrix();

    if (n === 1) {
      const u = this._units[0];
      u.holder.position.x = 0;
      u.inner.scale.setScalar(1 / u.radius);
      this._schedule();
      return;
    }

    const sel = this.dataset.alignTo;
    const ref = sel ? document.querySelector(sel) : null;
    let centres = null;
    if (ref && ref.children.length === n) {
      const hr = this.getBoundingClientRect();
      // getBoundingClientRect is in screen px and may be scaled by an ancestor
      // transform; w/clientWidth are layout px. Normalise into layout space.
      const k = hr.width > 0 && w > 0 ? w / hr.width : 1;
      centres = Array.prototype.map.call(ref.children, (c) => {
        const b = c.getBoundingClientRect();
        return (b.left + b.width / 2 - hr.left) * k;
      });
    }
    if (!centres) centres = this._units.map((_, i) => (i + 0.5) * (w / n));

    const pitch = Math.abs(centres[1] - centres[0]);
    const edge = Math.max(1, Math.min(centres[0], w - centres[n - 1]));
    const targetR = Math.min(
      (pitch / w) * vw * 0.39,
      vh * 0.34,
      (edge / w) * vw * 0.94,
    );
    this._units.forEach((u, i) => {
      u.holder.position.x = (centres[i] / w - 0.5) * vw;
      u.inner.scale.setScalar(targetR / u.radius);
    });
    // A resized drawing buffer is blank until the next render; when the loop
    // is parked (reduced motion), this is what paints it.
    this._schedule();
  }

  _screenX(u, rect) {
    const vw =
      this._vw ||
      (this._units.length > 1 ? 3.15 : 2.85) * (rect.width / rect.height || 1);
    return rect.left + rect.width * (0.5 + u.holder.position.x / vw);
  }

  _relayout() {
    this._resize(true);
  }

  _poke(e) {
    if (!this._canvas) return;
    const rect = this._canvas.getBoundingClientRect();
    let best = null,
      bd = 1e9;
    this._units.forEach((u) => {
      const d = Math.abs(e.clientX - this._screenX(u, rect));
      if (d < bd) {
        bd = d;
        best = u;
      }
    });
    if (best) best.spinGoal += Math.PI * 2;
  }

  _tick(dt, t) {
    const live = performance.now() - pointer.t < POINTER_LIVE_MS;
    // Geometry is read only while the pointer is being followed; an idle
    // companion never forces layout.
    const rect = live ? this._canvas.getBoundingClientRect() : null;
    this._units.forEach((u) => {
      u.expressionAt -= dt;
      if (u.expressionAt <= 0) {
        if (this._expressionMode === "ambient") {
          const choices = AMBIENT_EXPRESSIONS.filter(
            (expression) => expression !== u.expression,
          );
          u.expression =
            choices[Math.floor(Math.random() * choices.length)] || "resting";
          u.expressionAt = 5.5 + Math.random() * 5.5;
        } else {
          u.expression = knownExpression(this._expressionMode);
          u.expressionAt = 60;
        }
      }
      const expression = EXPRESSIONS[u.expression] || EXPRESSIONS.resting;
      const expressionEase = Math.min(1, dt * 1.65);
      u.expressionShape.x +=
        (expression.shape[0] - u.expressionShape.x) * expressionEase;
      u.expressionShape.y +=
        (expression.shape[1] - u.expressionShape.y) * expressionEase;
      u.expressionShape.z +=
        (expression.shape[2] - u.expressionShape.z) * expressionEase;
      u.expressionEyeX += (expression.eyeX - u.expressionEyeX) * expressionEase;
      u.expressionEyeY += (expression.eyeY - u.expressionEyeY) * expressionEase;
      u.expressionFluid +=
        (expression.fluid - u.expressionFluid) * expressionEase;
      u.expressionTilt += (expression.tilt - u.expressionTilt) * expressionEase;
      if (u.fluidUniforms) {
        u.fluidUniforms.time.value = t + u.phase;
        u.fluidUniforms.fluid.value = u.expressionFluid;
        u.fluidUniforms.shape.value.copy(u.expressionShape);
      }

      let ty, tp;
      if (live) {
        const cx = this._screenX(u, rect);
        const cy = rect.top + rect.height * 0.5;
        ty = Math.max(-1, Math.min(1, (pointer.x - cx) / 460)) * 0.92;
        tp = Math.max(-1, Math.min(1, (pointer.y - cy) / 420)) * 0.34;
      } else {
        ty =
          0.4 * Math.sin(t * 0.29 + u.phase) +
          0.16 * Math.sin(t * 0.11 + u.phase * 2);
        tp = 0.1 * Math.sin(t * 0.37 + u.phase * 1.7);
      }
      u.yaw += (ty - u.yaw) * Math.min(1, dt * 3.4);
      u.pitch += (tp - u.pitch) * Math.min(1, dt * 3);
      u.spin += (u.spinGoal - u.spin) * Math.min(1, dt * 3.2);

      const g = u.inner;
      g.rotation.y = u.yaw + u.spin;
      g.rotation.x = u.pitch;
      g.rotation.z = -u.yaw * 0.12 + u.expressionTilt;
      g.position.y = 0.045 * Math.sin(t * 1.15 + u.phase);

      if (u.kind === "pip") {
        const step = Math.floor(t * 4.4) % 2;
        g.position.y = step ? 0.07 : 0;
        if (u.legs) {
          u.legs[0].position.y = -0.34 + (step ? 0.05 : 0);
          u.legs[1].position.y = -0.34 + (step ? 0 : 0.05);
        }
      }

      u.blinkAt -= dt;
      if (u.blinkAt <= 0) {
        u.blink = 1;
        u.blinkAt = 3.4 + Math.random() * 5;
      }
      if (u.blink > 0) {
        u.blink = Math.max(0, u.blink - dt * 6.5);
        const f = Math.abs(Math.sin(u.blink * Math.PI));
        u.eyes.scale.x = u.expressionEyeX;
        u.eyes.scale.y = u.expressionEyeY * (1 - f * 0.88);
      } else {
        u.eyes.scale.x +=
          (u.expressionEyeX - u.eyes.scale.x) * Math.min(1, dt * 8);
        u.eyes.scale.y +=
          (u.expressionEyeY - u.eyes.scale.y) * Math.min(1, dt * 8);
      }
    });
  }
}

if (!customElements.get("mote-3d")) customElements.define("mote-3d", Mote3D);
window.Mote3D = Mote3D;
