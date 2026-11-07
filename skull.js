// Сцена «Киборг»: 3D-череп, лазеры из глаз и дым из выхлопа под музыку.
// Модуль грузится только при первом переходе на сцену.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// Точки на модели (модель отцентрована, высота 1): найдены лучами по рендеру
const EYES = [new THREE.Vector3(-0.136, 0.024, 0.36), new THREE.Vector3(0.145, 0.024, 0.36)];
const PIPE = new THREE.Vector3(0.375, 0.236, -0.174);
const VENT = new THREE.Vector3(0.314, 0.212, -0.035);
const MOUTH = new THREE.Vector3(0, -0.258, 0.46);

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const follow = (dt, tau) => 1 - Math.exp(-dt / tau);
const rnd = (a, b) => a + Math.random() * (b - a);

function softTexture(kind) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  if (kind === "glow") {
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
  } else {
    // клуб дыма: несколько размытых пятен разной плотности
    for (let i = 0; i < 22; i++) {
      const px = 64 + rnd(-26, 26), py = 64 + rnd(-26, 26), r = rnd(14, 34);
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(255,255,255,${rnd(0.08, 0.2)})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, 128, 128);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export async function createSkull(canvas, A, calm, onProgress) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  let pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020306);
  scene.fog = new THREE.FogExp2(0x04060b, 0.12);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  const camBase = new THREE.Vector3(0, 0.04, 2.55);

  // Свет: основной сверху спереди, цветные контровые сзади, они дышат от музыки
  const key = new THREE.SpotLight(0xfff1e0, 18, 10, 0.6, 0.6, 1.4);
  key.position.set(-1.6, 2.2, 2.4);
  scene.add(key, key.target);
  const rimC = new THREE.PointLight(0x2fd6ff, 6, 8, 1.6);
  rimC.position.set(1.4, 0.6, -1.4);
  const rimM = new THREE.PointLight(0xff2fa0, 4, 8, 1.6);
  rimM.position.set(-1.5, 0.2, -1.2);
  scene.add(rimC, rimM, new THREE.HemisphereLight(0x8090b0, 0x0a0a12, 0.25));

  const head = new THREE.Group();
  scene.add(head);

  // Модель
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise((ok, fail) =>
    loader.load(new URL("./skull.glb", import.meta.url).href, ok, e => e.total && onProgress && onProgress(e.loaded / e.total), fail)
  );
  const model = gltf.scene;
  model.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.computeVertexNormals();
    const map = o.material.map;
    if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
    o.material = new THREE.MeshStandardMaterial({ map, roughness: 0.42, metalness: 0.28, envMapIntensity: 0.35 });
  });
  const box = new THREE.Box3().setFromObject(model);
  model.position.sub(box.getCenter(new THREE.Vector3()));
  head.add(model);

  // Линзы глаз: светятся сами, их подхватывает свечение
  const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.9, 1), toneMapped: false });
  const eyeLights = [];
  const flashes = [];
  const glowTex = softTexture("glow");
  for (const e of EYES) {
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.026, 24, 16), lensMat);
    lens.position.copy(e).add(new THREE.Vector3(0, 0, -0.012));
    head.add(lens);
    const pl = new THREE.PointLight(0x40e8ff, 0, 1.6, 2);
    pl.position.copy(e).add(new THREE.Vector3(0, 0, 0.08));
    head.add(pl);
    eyeLights.push(pl);
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x9ff4ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    fl.position.copy(e).add(new THREE.Vector3(0, 0, 0.03));
    head.add(fl);
    flashes.push(fl);
  }

  // Лазеры: яркая сердцевина и широкий ореол, луч длиной через всю сцену
  const LEN = 14;
  const beamGeo = r => {
    const g = new THREE.CylinderGeometry(r, r * 1.6, LEN, 12, 1, true);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, LEN / 2);
    return g;
  };
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.4, 2.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.45, 0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.35 });
  const beams = EYES.map(e => {
    const g = new THREE.Group();
    g.position.copy(e);
    g.add(new THREE.Mesh(beamGeo(0.006), coreMat), new THREE.Mesh(beamGeo(0.022), haloMat));
    g.visible = false;
    head.add(g);
    return g;
  });

  // Дым: пул спрайтов, выходит из трубы, решётки и изо рта
  const smokeTex = softTexture("smoke");
  const puffs = [];
  const smokeGroup = new THREE.Group();
  scene.add(smokeGroup);
  for (let i = 0; i < 160; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x9aa2ad, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    smokeGroup.add(s);
    puffs.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), size: 0.1, grow: 0.3, spin: 0 });
  }
  let nextPuff = 0;
  const tmp = new THREE.Vector3();
  function emit(local, dir, speed, size) {
    const p = puffs[nextPuff];
    nextPuff = (nextPuff + 1) % puffs.length;
    p.s.position.copy(head.localToWorld(tmp.copy(local)));
    const d = dir.clone().transformDirection(head.matrixWorld);
    p.vel.copy(d).multiplyScalar(speed).add(new THREE.Vector3(rnd(-0.05, 0.05), rnd(0.05, 0.15), rnd(-0.05, 0.05)));
    p.life = 0;
    p.max = rnd(1.8, 3.2);
    p.size = size;
    p.grow = rnd(0.25, 0.5);
    p.spin = rnd(-0.6, 0.6);
    p.s.material.rotation = rnd(0, 6.28);
    p.s.visible = true;
  }

  // Свечение и вывод
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.35, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // на узком экране отъезжаем, чтобы череп помещался по ширине
    const fit = 0.62 / (Math.tan(THREE.MathUtils.degToRad(15)) * camera.aspect);
    camBase.z = Math.max(2.55, fit);
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener("resize", resize);

  // Состояние под музыку
  let fire = 0, boost = 0, seen = A.beats, burst = 0, glow = 0, slow = 0, slowFor = 0, smokeAcc = 0;
  const aim = EYES.map((e, i) => ({ x: i ? 0.4 : -0.4, y: 0, tx: i ? 0.4 : -0.4, ty: 0 }));

  function draw(dt, t) {
    const act = A.act;
    const loud = clamp((A.energy - 0.38) / 0.3) * act;
    boost += (loud - boost) * follow(dt, loud > boost ? 0.2 : 1.1);

    // Выстрелы: на ударе залп, на громких местах очередь
    if (A.beats !== seen) {
      seen = A.beats;
      if (A.bass > 0.28 && act > 0.2) {
        fire = 1;
        aim.forEach((a, i) => { const side = i ? 1 : -1; a.tx = side * rnd(0.25, 0.85); a.ty = rnd(-0.28, 0.18); });   // глаза бьют веером в разные стороны
        for (let k = 0; k < 2 + Math.round(A.bass * 4); k++) emit(MOUTH, new THREE.Vector3(rnd(-1, 1), -0.6, 0.5), rnd(0.12, 0.3), rnd(0.04, 0.08));
      }
    }
    if (boost > 0.45) {
      burst += dt * (6 + 8 * boost);
      if (burst >= 1) { burst = 0; fire = Math.max(fire, 0.85); aim.forEach((a, i) => { const side = i ? 1 : -1; a.tx = clamp(a.tx + rnd(-0.15, 0.15), side < 0 ? -0.9 : 0.15, side < 0 ? -0.15 : 0.9); a.ty = clamp(a.ty + rnd(-0.08, 0.08), -0.3, 0.2); }); }
    }
    fire *= Math.exp(-dt / 0.13);

    // Голова медленно поворачивается, на ударе кивает
    const sway = 0.38 * Math.sin(t * 0.21) + 0.12 * Math.sin(t * 0.53);
    head.rotation.y += (sway - head.rotation.y) * follow(dt, 0.6);
    head.rotation.x = -0.04 + 0.05 * Math.sin(t * 0.33) - 0.06 * A.beat * act * calm;
    head.position.y = 0.012 * Math.sin(t * 0.8);
    head.updateMatrixWorld(true);

    // Лазеры
    beams.forEach((b, i) => {
      const a = aim[i];
      a.x += (a.tx - a.x) * follow(dt, 0.08);
      a.y += (a.ty - a.y) * follow(dt, 0.08);
      b.rotation.set(a.y + 0.02 * Math.sin(t * 13 + i), a.x - (i ? 0.03 : -0.03), 0);
      b.visible = fire > 0.03;
      b.scale.set(0.6 + fire * 0.8, 0.6 + fire * 0.8, 1);
    });
    coreMat.opacity = clamp(fire * 1.3);
    haloMat.opacity = clamp(fire * 0.5);

    glow += ((0.25 + 0.6 * act * (0.4 + A.high)) - glow) * follow(dt, 0.15);
    lensMat.color.setRGB(0.15 + 0.6 * (glow + fire), 0.7 + 1.4 * (glow + fire), 0.8 + 1.5 * (glow + fire));
    eyeLights.forEach(l => { l.intensity = 0.05 + 1.4 * fire + 0.15 * glow; });
    flashes.forEach(f => { const s = 0.04 + 0.16 * fire; f.scale.set(s, s, s); f.material.opacity = clamp(0.15 * glow + 0.8 * fire); });

    // Свет дышит от баса, контровые вспыхивают на залпе
    key.intensity = 2.2 + 2.5 * act * (0.4 + 0.6 * A.mid);
    rimC.intensity = 0.6 + 3 * act * A.bass + 1.5 * fire;
    rimM.intensity = 0.4 + 2.2 * act * A.high + 1 * boost;

    // Дым: постоянный выхлоп от баса, клубы из решётки на громких местах
    smokeAcc += dt * act * (2 + 26 * A.bass + 30 * boost);
    while (smokeAcc >= 1) {
      smokeAcc -= 1;
      if (Math.random() < 0.65) emit(PIPE, new THREE.Vector3(1, 0.35, -0.2), rnd(0.25, 0.55), rnd(0.05, 0.09));
      else emit(VENT, new THREE.Vector3(0.9, 0.6, 0), rnd(0.15, 0.35), rnd(0.04, 0.08));
    }
    const smokeTint = 0.35 + 0.4 * act + 0.8 * fire;
    for (const p of puffs) {
      if (!p.s.visible) continue;
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) { p.s.visible = false; continue; }
      p.vel.multiplyScalar(Math.exp(-dt * 0.9));
      p.vel.y += dt * 0.12;
      p.s.position.addScaledVector(p.vel, dt);
      const size = p.size + p.grow * p.life;
      p.s.scale.set(size, size, size);
      p.s.material.rotation += p.spin * dt;
      p.s.material.opacity = 0.55 * Math.sin(Math.PI * Math.min(k * 1.6, 1)) * (1 - k);
      p.s.material.color.setRGB(0.5 * smokeTint, 0.6 * smokeTint + 0.25 * fire, 0.68 * smokeTint + 0.3 * fire);
    }

    // Камера: лёгкое дрожание на громких местах
    const shake = 0.012 * boost * calm + 0.006 * A.beat * act * calm;
    camera.position.set(camBase.x + rnd(-shake, shake), camBase.y + rnd(-shake, shake), camBase.z);
    camera.lookAt(0, 0.02, 0);

    bloom.strength = 0.35 + 0.5 * fire + 0.15 * boost;

    // Если не успеваем, снижаем разрешение
    slow += (dt * 1000 - slow) * follow(dt, 0.5);
    slowFor = slow > 28 ? slowFor + dt : 0;
    if (slowFor > 1.2 && pixelRatio > 0.75) { pixelRatio *= 0.8; slowFor = 0; resize(); }

    composer.render(dt);
  }

  return { draw, resize, get pixelRatio() { return pixelRatio; }, renderer };
}
