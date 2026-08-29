// biome-ignore-all lint: Source-authored Mote renderer preserved from the approved design artifact.
(function () {
  let threeP = null;
  const loadThree = () => threeP || (threeP = import("three"));

  const pointer = { x: -1e5, y: -1e5, t: -1e5 };
  window.addEventListener(
    "pointermove",
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.t = performance.now();
    },
    { passive: true },
  );

  function envCanvas() {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 512;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, "#000000");
    g.addColorStop(0.34, "#04060a");
    g.addColorStop(0.44, "#0d141d");
    g.addColorStop(0.468, "#c8d8ec");
    g.addColorStop(0.484, "#ffffff");
    g.addColorStop(0.5, "#050709");
    g.addColorStop(0.62, "#010102");
    g.addColorStop(1, "#000000");
    x.fillStyle = g;
    x.fillRect(0, 0, 1024, 512);
    const key = x.createRadialGradient(690, 150, 0, 690, 150, 150);
    key.addColorStop(0, "rgba(255,255,255,.95)");
    key.addColorStop(0.3, "rgba(226,238,255,.16)");
    key.addColorStop(1, "rgba(200,220,255,0)");
    x.fillStyle = key;
    x.fillRect(430, 0, 540, 400);
    const fill = x.createRadialGradient(230, 210, 0, 230, 210, 130);
    fill.addColorStop(0, "rgba(150,185,240,.2)");
    fill.addColorStop(1, "rgba(120,160,220,0)");
    x.fillStyle = fill;
    x.fillRect(20, 20, 420, 380);
    return c;
  }

  function glowTexture(THREE) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,.85)");
    g.addColorStop(0.25, "rgba(226,240,255,.32)");
    g.addColorStop(0.6, "rgba(180,212,255,.06)");
    g.addColorStop(1, "rgba(150,190,250,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function dropletGeometry(THREE) {
    const g = new THREE.SphereGeometry(1, 128, 96);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i);
      const below = Math.max(0, -y);
      const s = 1 - 0.055 * below * below;
      p.setXYZ(i, x * s, y * 0.965 + 0.02 * below * below, z * s);
    }
    g.computeVertexNormals();
    return g;
  }

  function toneOf(THREE, hex, lightness) {
    const hsl = {};
    new THREE.Color(hex).getHSL(hsl);
    return new THREE.Color().setHSL(
      hsl.h,
      Math.min(1, hsl.s * 1.15),
      lightness,
    );
  }

  function bodyMaterial(THREE, tint, opts) {
    const carrier = toneOf(THREE, tint, 0.1);
    const m = new THREE.MeshPhysicalMaterial({
      color: carrier.clone().multiplyScalar(0.04),
      emissive: carrier.clone().multiplyScalar(0.06),
      emissiveIntensity: 1,
      roughness: (opts && opts.roughness) != null ? opts.roughness : 0.075,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 0.5,
      sheen: 0.2,
      sheenRoughness: 0.3,
      sheenColor: carrier.clone(),
    });
    m.name = "mote-body";
    if (opts?.fluid) {
      const uniforms = {
        fluid: { value: 0.5 },
        shape: { value: new THREE.Vector3(1, 1, 1) },
        time: { value: 0 },
      };
      m.userData.moteUniforms = uniforms;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.moteFluid = uniforms.fluid;
        shader.uniforms.moteShape = uniforms.shape;
        shader.uniforms.moteTime = uniforms.time;
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            `#include <common>
uniform float moteFluid;
uniform vec3 moteShape;
uniform float moteTime;`,
          )
          .replace(
            "#include <begin_vertex>",
            `vec3 transformed = vec3(position) * moteShape;
float moteWave =
  sin(position.y * 5.2 + moteTime * 1.1) * 0.55 +
  sin(position.x * 4.1 - moteTime * 0.73) * 0.3 +
  sin((position.x + position.z) * 3.3 + moteTime * 0.47) * 0.15;
transformed += normal * moteWave * 0.035 * moteFluid;`,
          );
      };
      m.customProgramCacheKey = () => "luca-mote-fluid-v1";
    }
    return m;
  }

  function eyeAssembly(THREE, glow, r, positions) {
    const grp = new THREE.Group();
    const core = new THREE.MeshBasicMaterial({ color: 0xffffff });
    core.name = "specular";
    positions.forEach((p) => {
      const dir = new THREE.Vector3(p[0], p[1], p[2]).normalize();
      const e = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), core);
      e.position.copy(dir.clone().multiplyScalar(p[3] != null ? p[3] : 0.93));
      e.scale.set(1, 1.08, 0.72);
      grp.add(e);
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: 0.75,
        }),
      );
      s.scale.setScalar(r * 5.2);
      s.position.copy(e.position).multiplyScalar(1.01);
      grp.add(s);
    });
    return grp;
  }

  function buildMote(THREE, tint, glow) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      dropletGeometry(THREE),
      bodyMaterial(THREE, tint, { fluid: true }),
    );
    body.name = "mote";
    g.add(body);
    const eyes = eyeAssembly(THREE, glow, 0.185, [
      [-0.38, 0.07, 0.9],
      [0.38, 0.07, 0.9],
    ]);
    g.add(eyes);
    return {
      body,
      fluidUniforms: body.material.userData.moteUniforms,
      group: g,
      eyes,
      radius: 0.96,
    };
  }

  function buildLobe(THREE, tint, glow) {
    const g = new THREE.Group();
    const mat = bodyMaterial(THREE, tint, { roughness: 0.11 });
    const S = 1 / 26;
    const blobs = [
      [20, 27, 13, 0],
      [34, 19, 14, 2],
      [50, 21, 13, 0],
      [60, 32, 11, -3],
      [16, 38, 11, -3],
      [38, 44, 15, 0],
    ];
    blobs.forEach((b, i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(b[2] * S, 48, 36), mat);
      m.name = "lobe" + i;
      m.position.set((b[0] - 38) * S, (34 - b[1]) * S, b[3] * S);
      g.add(m);
    });
    const screen = new THREE.Mesh(
      new THREE.SphereGeometry(0.52, 48, 36),
      new THREE.MeshPhysicalMaterial({
        color: 0x03040a,
        roughness: 0.12,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        envMapIntensity: 0.8,
      }),
    );
    screen.name = "screen";
    screen.scale.set(1, 0.72, 0.34);
    screen.position.set(0, 0.06, 0.5);
    g.add(screen);
    const lidMat = new THREE.MeshBasicMaterial({ color: 0xeaf2ff });
    lidMat.name = "lid";
    const eyes = new THREE.Group();
    [-0.21, 0.21].forEach((x) => {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(0.115, 0.028, 10, 28, Math.PI),
        lidMat,
      );
      arc.rotation.z = Math.PI;
      arc.position.set(x, 0.1, 0.68);
      eyes.add(arc);
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: 0.5,
        }),
      );
      s.scale.setScalar(0.6);
      s.position.set(x, 0.08, 0.7);
      eyes.add(s);
    });
    g.add(eyes);
    return { group: g, eyes, radius: 1.04 };
  }

  function buildPip(THREE, tint, glow) {
    const g = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({
      color: new THREE.Color(tint).multiplyScalar(0.085),
      roughness: 0.42,
      metalness: 0.28,
      envMapIntensity: 1,
    });
    shell.name = "chassis";
    const add = (w, h, d, x, y, z, name) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shell);
      m.name = name;
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    add(1.12, 0.56, 0.62, 0, 0.1, 0, "head");
    add(0.92, 0.1, 0.56, 0, 0.42, 0, "brow");
    add(0.1, 0.4, 0.5, -0.6, 0.08, 0, "earL");
    add(0.1, 0.4, 0.5, 0.6, 0.08, 0, "earR");
    const legs = [
      add(0.22, 0.34, 0.24, -0.3, -0.34, 0, "legL"),
      add(0.22, 0.34, 0.24, 0.3, -0.34, 0, "legR"),
    ];
    const px = new THREE.MeshBasicMaterial({ color: 0xeaf2ff });
    px.name = "pixel";
    const eyes = new THREE.Group();
    [-0.25, 0.25].forEach((x) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.05), px);
      e.position.set(x, 0.12, 0.32);
      eyes.add(e);
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: 0.42,
        }),
      );
      s.scale.setScalar(0.52);
      s.position.set(x, 0.12, 0.36);
      eyes.add(s);
    });
    g.add(eyes);
    return { group: g, eyes, legs, radius: 0.49 };
  }

  const BUILDERS = { mote: buildMote, lobe: buildLobe, pip: buildPip };

  const EXPRESSIONS = {
    resting: {
      eyeX: 1,
      eyeY: 1,
      fluid: 0.42,
      shape: [1, 1, 1],
      tilt: 0,
    },
    curious: {
      eyeX: 1.08,
      eyeY: 1.08,
      fluid: 0.78,
      shape: [0.94, 1.08, 0.98],
      tilt: -0.1,
    },
    thinking: {
      eyeX: 0.96,
      eyeY: 0.76,
      fluid: 0.58,
      shape: [1.04, 0.95, 1.02],
      tilt: 0.075,
    },
    pleased: {
      eyeX: 1.06,
      eyeY: 0.62,
      fluid: 0.92,
      shape: [1.08, 0.94, 1.03],
      tilt: -0.035,
    },
    concerned: {
      eyeX: 0.94,
      eyeY: 1.12,
      fluid: 0.34,
      shape: [0.93, 1.09, 0.98],
      tilt: 0.055,
    },
  };
  const AMBIENT_EXPRESSIONS = ["resting", "curious", "thinking", "pleased"];

  function knownExpression(value) {
    return Object.hasOwn(EXPRESSIONS, value) ? value : "resting";
  }

  class Mote3D extends HTMLElement {
    static get observedAttributes() {
      return ["expression"];
    }

    attributeChangedCallback(name, _oldValue, newValue) {
      if (name === "expression") {
        this._expressionMode = newValue || "ambient";
        for (const unit of this._units ?? []) unit.expressionAt = 0;
      }
    }

    connectedCallback() {
      if (this._init) return;
      this._init = true;
      this.style.display = "block";
      this.style.width = this.style.width || "100%";
      this.style.height = this.style.height || "100%";
      this._start().catch((e) => {
        console.warn("mote3d", e);
        this._fallback();
      });
    }

    _fallback() {
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
    }

    disconnectedCallback() {
      this._dead = true;
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this._ro) this._ro.disconnect();
      if (this._io) this._io.disconnect();
      if (this._renderer) this._renderer.dispose();
    }

    async _start() {
      const THREE = await loadThree();
      if (this._dead) return;
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "display:block;width:100%;height:100%;";
      this.appendChild(canvas);
      this._canvas = canvas;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.88;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      this._renderer = renderer;

      const scene = new THREE.Scene();

      const tex = new THREE.CanvasTexture(envCanvas());
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromEquirectangular(tex).texture;
      pmrem.dispose();
      tex.dispose();

      const key = new THREE.DirectionalLight(0xffffff, 0.9);
      key.position.set(2.4, 3.2, 3.4);
      scene.add(key);

      const glow = glowTexture(THREE);
      const kind = (this.getAttribute("species") || "mote").toLowerCase();
      const crew = this.getAttribute("crew");
      const tints = crew
        ? crew
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [this.getAttribute("tint") || "#e6efff"];

      this._units = tints.map((tint, i) => {
        const built = (BUILDERS[kind] || buildMote)(THREE, tint, glow);
        const holder = new THREE.Group();
        holder.add(built.group);
        scene.add(holder);

        const lightC = toneOf(THREE, tint, 0.34);
        const rim = new THREE.PointLight(lightC, 3.6, 8, 2);
        rim.position.set(1.5, 0.7, 2.3);
        holder.add(rim);

        const wash = new THREE.PointLight(lightC, 2, 7, 2);
        wash.position.set(-1.6, -0.5, 1.9);
        holder.add(wash);

        const caustic = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: glow,
            color: toneOf(THREE, tint, 0.42),
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            opacity: 0.34,
          }),
        );
        caustic.scale.set(built.radius * 2.1, built.radius * 0.5, 1);
        caustic.position.set(0, -built.radius * 1.02, 0);
        holder.add(caustic);

        return {
          holder,
          inner: built.group,
          fluidUniforms: built.fluidUniforms,
          eyes: built.eyes,
          legs: built.legs,
          kind,
          phase: i * 1.37 + 0.4,
          yaw: 0,
          pitch: 0,
          spin: 0,
          spinGoal: 0,
          blinkAt: 2 + Math.random() * 4,
          blink: 0,
          radius: built.radius,
          expression: "resting",
          expressionAt: 1.8 + i * 0.9 + Math.random() * 2.2,
          expressionShape: new THREE.Vector3(1, 1, 1),
          expressionEyeX: 1,
          expressionEyeY: 1,
          expressionFluid: 0.42,
          expressionTilt: 0,
        };
      });

      const camera =
        this._units.length > 1
          ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60)
          : new THREE.PerspectiveCamera(24, 1, 0.1, 60);
      camera.position.set(0, 0.06, 9);
      camera.lookAt(0, 0.06, 0);
      scene.add(camera);

      this._scene = scene;
      this._camera = camera;
      this._THREE = THREE;
      this._visible = true;
      this._reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      this._expressionMode = this.getAttribute("expression") || "ambient";

      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(this);
      this._io = new IntersectionObserver((es) => {
        this._visible = es[0].isIntersecting;
      });
      this._io.observe(this);
      canvas.addEventListener("pointerdown", (e) => this._poke(e));
      this._resize();

      let last = performance.now();
      const loop = () => {
        if (this._dead) return;
        this._raf = requestAnimationFrame(loop);
        const now = performance.now();
        let dt = (now - last) / 1000;
        last = now;
        if (dt > 0.05) dt = 0.05;
        if (!this._visible) return;
        if (!this._reducedMotion) this._tick(dt, now / 1000);
        renderer.render(scene, camera);
      };
      loop();
    }

    _resize() {
      const w = this.clientWidth || 320,
        h = this.clientHeight || 160;
      const r = this._renderer,
        cam = this._camera;
      if (!r || !cam) return;
      r.setSize(w, h, false);
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
    }

    _screenX(u, rect) {
      const vw =
        this._vw ||
        (this._units.length > 1 ? 3.15 : 2.85) *
          (rect.width / rect.height || 1);
      return rect.left + rect.width * (0.5 + u.holder.position.x / vw);
    }

    _relayout() {
      this._resize();
    }

    _poke(e) {
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
      const rect = this._canvas.getBoundingClientRect();
      const live = performance.now() - pointer.t < 2600;
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
        u.expressionEyeX +=
          (expression.eyeX - u.expressionEyeX) * expressionEase;
        u.expressionEyeY +=
          (expression.eyeY - u.expressionEyeY) * expressionEase;
        u.expressionFluid +=
          (expression.fluid - u.expressionFluid) * expressionEase;
        u.expressionTilt +=
          (expression.tilt - u.expressionTilt) * expressionEase;
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
})();
