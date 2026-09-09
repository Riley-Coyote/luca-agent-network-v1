// biome-ignore-all lint: Source-authored Mote renderer preserved from the approved design artifact.
//
// The companion's scene: environment, geometries, materials, the three
// species and their expressions. Everything here is CPU-side and renderer-
// agnostic. Assets (the environment canvas, the glow texture, every geometry)
// are built once per document and shared by every instance and every stage;
// materials are built per scene because their uniforms animate per unit.

let assetsP = null;

/** Load three and build the shared assets once. */
export const loadAssets = () =>
  assetsP ||
  (assetsP = import("three").then((THREE) => ({
    THREE,
    env: envCanvas(),
    geometries: new Map(),
    glow: glowTexture(THREE),
  })));

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

// Geometries are shared by every instance and every stage; each renderer
// uploads its own buffers once.
function cachedGeometry(assets, key, make) {
  let geometry = assets.geometries.get(key);
  if (!geometry) {
    geometry = make();
    assets.geometries.set(key, geometry);
  }
  return geometry;
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
  return new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.15), lightness);
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

function eyeAssembly(assets, r, positions) {
  const { THREE, glow } = assets;
  const grp = new THREE.Group();
  const core = new THREE.MeshBasicMaterial({ color: 0xffffff });
  core.name = "specular";
  const eyeGeometry = cachedGeometry(
    assets,
    `eye:${r}`,
    () => new THREE.SphereGeometry(r, 32, 24),
  );
  positions.forEach((p) => {
    const dir = new THREE.Vector3(p[0], p[1], p[2]).normalize();
    const e = new THREE.Mesh(eyeGeometry, core);
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

function buildMote(assets, tint) {
  const { THREE } = assets;
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    cachedGeometry(assets, "droplet", () => dropletGeometry(THREE)),
    bodyMaterial(THREE, tint, { fluid: true }),
  );
  body.name = "mote";
  g.add(body);
  const eyes = eyeAssembly(assets, 0.185, [
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

function buildLobe(assets, tint) {
  const { THREE, glow } = assets;
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
    const m = new THREE.Mesh(
      cachedGeometry(
        assets,
        `lobe:${b[2]}`,
        () => new THREE.SphereGeometry(b[2] * S, 48, 36),
      ),
      mat,
    );
    m.name = "lobe" + i;
    m.position.set((b[0] - 38) * S, (34 - b[1]) * S, b[3] * S);
    g.add(m);
  });
  const screen = new THREE.Mesh(
    cachedGeometry(
      assets,
      "lobe:screen",
      () => new THREE.SphereGeometry(0.52, 48, 36),
    ),
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
  const lidGeometry = cachedGeometry(
    assets,
    "lobe:lid",
    () => new THREE.TorusGeometry(0.115, 0.028, 10, 28, Math.PI),
  );
  [-0.21, 0.21].forEach((x) => {
    const arc = new THREE.Mesh(lidGeometry, lidMat);
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

function buildPip(assets, tint) {
  const { THREE, glow } = assets;
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tint).multiplyScalar(0.085),
    roughness: 0.42,
    metalness: 0.28,
    envMapIntensity: 1,
  });
  shell.name = "chassis";
  const box = (w, h, d) =>
    cachedGeometry(
      assets,
      `box:${w}x${h}x${d}`,
      () => new THREE.BoxGeometry(w, h, d),
    );
  const add = (w, h, d, x, y, z, name) => {
    const m = new THREE.Mesh(box(w, h, d), shell);
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
    const e = new THREE.Mesh(box(0.17, 0.17, 0.05), px);
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

export const EXPRESSIONS = {
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
export const AMBIENT_EXPRESSIONS = [
  "resting",
  "curious",
  "thinking",
  "pleased",
];

export function knownExpression(value) {
  return Object.hasOwn(EXPRESSIONS, value) ? value : "resting";
}

/**
 * One scene graph per instance: the lights, the units and the camera. The
 * light count is part of the shader program, so a warm-up must build exactly
 * this for the unit count it wants compiled.
 */
export function buildScene(assets, kind, tints) {
  const { THREE, glow } = assets;
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(2.4, 3.2, 3.4);
  scene.add(key);

  const units = tints.map((tint, i) => {
    const built = (BUILDERS[kind] || buildMote)(assets, tint);
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
    units.length > 1
      ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60)
      : new THREE.PerspectiveCamera(24, 1, 0.1, 60);
  camera.position.set(0, 0.06, 9);
  camera.lookAt(0, 0.06, 0);
  scene.add(camera);

  return { scene, camera, units };
}
