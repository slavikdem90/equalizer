// Сцена «Маска»: лицо из картинки с картой глубины (2.5D), камера едва дышит,
// под музыку глаза искрят электричеством. Модуль грузится при первом переходе.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const IMG_ASPECT = 16 / 9;
// Центры светящихся глаз в долях картинки (v снизу вверх, как в uv)
const EYES = [new THREE.Vector2(0.374, 1 - 0.299), new THREE.Vector2(0.628, 1 - 0.299)];

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const follow = (dt, tau) => 1 - Math.exp(-dt / tau);

const vert = /* glsl */ `
uniform sampler2D uDepth;
uniform float uDisp;
varying vec2 vUv;
void main() {
  vUv = uv;
  float d = texture2D(uDepth, uv).r;
  vec3 p = position;
  p.z += (d - 0.45) * uDisp;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const frag = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uEyes[2];
uniform float uT, uE, uFlash, uGlow, uAspect, uRed;
uniform vec3 uCol;
varying vec2 vUv;

float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n2(p); p *= 2.07; a *= 0.5; } return s; }

// Одна молния из центра глаза: зигзаг вдоль направления th длиной L
float bolt(vec2 q, float th, float L, float seed) {
  vec2 dir = vec2(cos(th), sin(th));
  float along = dot(q, dir);
  float perp = dot(q, vec2(-dir.y, dir.x));
  if (along < 0.0 || along > L) return 0.0;
  float k = along / L;
  float lat = (n1(along * 38.0 + seed) - 0.5) * 0.05 + (n1(along * 120.0 + seed * 3.1) - 0.5) * 0.016;
  lat *= smoothstep(0.0, 0.25, k);
  float d = abs(perp - lat);
  float fade = smoothstep(1.0, 0.55, k) * smoothstep(0.02, 0.045, along);
  return (0.0014 / (d + 0.0011) + 0.6 * exp(-d * 180.0)) * fade;
}

void main() {
  vec3 col = texture2D(uMap, vUv).rgb;
  // вариация «красные глаза»: голубое свечение глаз перекрашивается в красное
  if (uRed > 0.5) {
    float near = 0.0;
    for (int e = 0; e < 2; e++) {
      vec2 q = (vUv - uEyes[e]) * vec2(uAspect, 1.0);
      near = max(near, exp(-dot(q * vec2(1.0, 1.6), q * vec2(1.0, 1.6)) / 0.012));
    }
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float w = clamp((col.b - col.r) * 4.0 - 0.15, 0.0, 1.0) * near;
    vec3 red = vec3(max(col.g, col.b) * 1.5, lum * 0.18, lum * 0.12);
    col = mix(mix(col, vec3(lum) * 1.05, 0.35), red, w);
  }
  vec3 add = vec3(0.0);
  float light = 0.0;
  for (int e = 0; e < 2; e++) {
    vec2 q = (vUv - uEyes[e]) * vec2(uAspect, 1.0);
    float r = length(q * vec2(1.0, 1.9));
    float m = exp(-pow(r / 0.075, 2.0));
    // свечение глаза: в тишине чуть тусклее картинки, под музыку ярче
    col *= mix(1.0, 0.7 + 0.9 * min(uGlow, 1.2), m);
    // жилки разряда внутри радужки
    float n = fbm(q * 55.0 + float(e) * 9.0);
    float veins = pow(1.0 - abs(n * 2.0 - 1.0), 14.0);
    add += uCol * veins * m * (0.5 * uE + 0.7 * uFlash) * 1.6;
    // треск по краю глаза
    float a = atan(q.y, q.x);
    float ring = abs(r - 0.06 - 0.02 * (n1(a * 6.0 + float(e) * 4.0) - 0.5));
    add += uCol * 0.0012 / (ring + 0.0015) * step(0.55, n1(a * 3.0 + float(e))) * smoothstep(0.1, 0.5, uE + uFlash) * min(uE + uFlash, 1.0) * 0.6;
    // молнии наружу: форма и место неподвижны, от звука меняется только яркость,
    // чем громче, тем больше молний загорается
    for (int k = 0; k < 9; k++) {
      float fk = float(k) + float(e) * 7.0;
      float ep = 3.0 + fk * 1.37;
      float thr = h1(ep * 7.3 + fk) * 0.85;
      float on = smoothstep(thr, thr + 0.15, uE + 0.6 * uFlash);
      if (on < 0.01) continue;
      float th = (float(k) + 0.6 * h1(ep * 13.1 + fk)) / 9.0 * 6.2832;
      float L = 0.08 + 0.28 * h1(ep * 3.7 + fk);
      float b = bolt(q, th, L, ep * 11.0 + fk);
      // ветка от середины молнии
      vec2 dir = vec2(cos(th), sin(th));
      b += 0.7 * bolt(q - dir * L * 0.4, th + (h1(ep + fk * 5.1) - 0.5) * 1.6, L * 0.45, ep * 5.0 + fk + 3.0);
      add += uCol * b * on * (0.45 + 0.35 * uE + 0.5 * uFlash);
    }
    // отсвет разряда на металле вокруг глаза
    light += exp(-dot(q, q) / 0.02) * (0.6 * uE + 0.8 * uFlash);
  }
  col += col * uCol * min(light, 1.2) * 0.9;
  col += add;
  // края картинки уходят в черноту (на узком экране)
  vec2 ed = smoothstep(vec2(0.0), vec2(0.04, 0.06), vUv) * smoothstep(vec2(0.0), vec2(0.04, 0.06), 1.0 - vUv);
  gl_FragColor = vec4(col * ed.x * ed.y, 1.0);
}`;

export async function createFace(canvas, A, calm, onProgress) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  let pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);

  const loader = new THREE.TextureLoader();
  let got = 0;
  const load = url => new Promise((ok, bad) => loader.load(url, t => { onProgress && onProgress(++got / 2); ok(t); }, undefined, bad));
  const [map, depth] = await Promise.all([load("./face.webp"), load("./face-depth.png")]);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  depth.colorSpace = THREE.NoColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);

  const u = {
    uMap: { value: map }, uDepth: { value: depth }, uDisp: { value: 0.32 },
    uEyes: { value: EYES }, uT: { value: 0 }, uE: { value: 0 }, uFlash: { value: 0 }, uGlow: { value: 0.3 },
    uAspect: { value: IMG_ASPECT }, uRed: { value: 0 }, uCol: { value: new THREE.Color(0.35, 0.75, 1.6) },
  };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(IMG_ASPECT, 1, 384, 216),
    new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag }),
  );
  scene.add(mesh);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.4, 0.75);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let dist = 2;
  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // картинка закрывает экран целиком с запасом на движение камеры,
    // но лицо (≈ 0,95 высоты по ширине) всегда помещается
    const tan = Math.tan(THREE.MathUtils.degToRad(15)), over = 1.1;
    const cover = camera.aspect >= IMG_ASPECT ? IMG_ASPECT / over / (2 * tan * camera.aspect) : 1 / over / (2 * tan);
    const faceFit = 1.0 / (2 * tan * camera.aspect);
    dist = Math.max(cover, Math.min(faceFit, 3.2)) + 0.16;
  }
  resize();
  addEventListener("resize", resize);

  let E = 0, flashV = 0, glow = 0.3, seen = A.beats, slow = 0, slowFor = 0;

  function draw(dt, t) {
    const act = A.act;
    // разряд: от верхов и середины, на ударе вспышка
    const target = act * clamp(0.25 + 0.9 * A.high + 0.4 * A.mid + 0.3 * (A.energy - 0.4));
    E += (target - E) * follow(dt, target > E ? 0.05 : 0.45);
    if (A.beats !== seen) { seen = A.beats; if (act > 0.15) flashV = Math.max(flashV, 0.5 + 0.5 * A.bass); }
    flashV *= Math.exp(-dt / 0.14);
    glow += ((0.3 + 0.7 * act * (0.3 + 0.7 * E)) - glow) * follow(dt, 0.2);
    u.uT.value = t; u.uE.value = E; u.uFlash.value = flashV; u.uGlow.value = glow + 0.4 * flashV;

    // минимальное движение: медленный дрейф камеры, параллакс даёт объём
    const cx = 0.07 * Math.sin(t * 0.11) + 0.02 * Math.sin(t * 0.29);
    const cy = 0.035 * Math.sin(t * 0.08 + 1.3);
    camera.position.set(cx, cy, dist);
    camera.lookAt(cx * 0.35, cy * 0.35, 0.05);

    bloom.strength = 0.4 + 0.3 * E + 0.3 * flashV;

    slow += (dt * 1000 - slow) * follow(dt, 0.5);
    slowFor = slow > 28 ? slowFor + dt : 0;
    if (slowFor > 1.2 && pixelRatio > 0.75) { pixelRatio *= 0.8; slowFor = 0; resize(); }
    composer.render(dt);
  }

  const COLORS = [new THREE.Color(0.35, 0.75, 1.6), new THREE.Color(1.8, 0.22, 0.12)];
  function setVariant(i) { u.uRed.value = i === 1 ? 1 : 0; u.uCol.value.copy(COLORS[i] || COLORS[0]); }

  return { draw, resize, setVariant, get pixelRatio() { return pixelRatio; }, renderer };
}
