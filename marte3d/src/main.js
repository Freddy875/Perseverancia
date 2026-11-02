import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- Ruido procedural ----------
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Altura del terreno (x, z en metros)
function heightAt(x, z) {
  const r = Math.hypot(x, z);
  let h = (fbm(x * 0.012, z * 0.012) - 0.5) * 10;           // ondulación suave
  h += (fbm(x * 0.06 + 40, z * 0.06) - 0.5) * 1.6;           // detalle
  const ridge = 1 - Math.abs(fbm(x * 0.004 + 9, z * 0.004 - 3, 4) * 2 - 1);
  h += THREE.MathUtils.smoothstep(r, 110, 380) * (ridge * ridge * 75 + 10); // montañas lejanas
  return h;
}

// ---------- Renderer, escena, cámara ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = new THREE.Color('#d39a62');
const ZENITH = new THREE.Color('#6e4430');
scene.fog = new THREE.FogExp2(HORIZON.clone().multiplyScalar(0.92), 0.0042);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 3.4, 16);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 5, -30);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.52;
controls.minDistance = 4;
controls.maxDistance = 120;
controls.update();

// ---------- Sol ----------
const sunDir = new THREE.Vector3(-0.55, 0.25, -1).normalize();
const SUN_COLOR = new THREE.Color('#ffc98f');

const sun = new THREE.DirectionalLight(SUN_COLOR, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 800;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 4;
scene.add(sun, sun.target);
sun.target.position.set(0, 0, -20);
sun.position.copy(sun.target.position).addScaledVector(sunDir, 400);

scene.add(new THREE.HemisphereLight('#e8b082', '#6a3420', 1.25));

// ---------- Cielo (shader) ----------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1500, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: HORIZON },
      uZenith: { value: ZENITH },
      uSunDir: { value: sunDir },
      uSunColor: { value: new THREE.Color('#ffd9a8') },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uHorizon, uZenith, uSunDir, uSunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(s, 6.0) * 0.45 + pow(s, 60.0) * 0.9);   // halo de polvo
        col += uSunColor * smoothstep(0.99965, 0.99985, s) * 6.0;      // disco solar
        col = mix(col, uHorizon * 0.95, smoothstep(0.0, -0.05, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
);
sky.renderOrder = -1;
scene.add(sky);

// ---------- Textura de detalle (bump) ----------
function makeNoiseTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = fbm(x / 22, y / 22, 4) * 0.7 + hash2(x, y) * 0.3;
    const v = Math.floor(n * 255);
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const bumpTex = makeNoiseTexture();

// ---------- Terreno ----------
const SIZE = 900, SEG = 420;
const tGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
tGeo.rotateX(-Math.PI / 2);
const pos = tGeo.attributes.position;
const colors = new Float32Array(pos.count * 3);
const cA = new THREE.Color('#b05830'), cB = new THREE.Color('#d08a55'), cC = new THREE.Color('#7a3820');
const tmp = new THREE.Color();
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i), z = pos.getZ(i);
  pos.setY(i, heightAt(x, z));
  const n = fbm(x * 0.03 + 100, z * 0.03, 4);
  tmp.copy(cA).lerp(cB, THREE.MathUtils.smoothstep(n, 0.35, 0.7));
  tmp.lerp(cC, THREE.MathUtils.smoothstep(fbm(x * 0.1, z * 0.1 + 50, 3), 0.55, 0.8) * 0.6);
  colors.set([tmp.r, tmp.g, tmp.b], i * 3);
}
tGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
tGeo.computeVertexNormals();
const bumpRep = bumpTex.clone(); bumpRep.repeat.set(120, 120); bumpRep.needsUpdate = true;
const terrain = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.96, metalness: 0, bumpMap: bumpRep, bumpScale: 1.2,
}));
terrain.receiveShadow = true;
terrain.castShadow = false; // solo las rocas proyectan sombra sobre el suelo
scene.add(terrain);

// ---------- Rocas ----------
function makeRockGeo(s) {
  let g = new THREE.IcosahedronGeometry(1, 4);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3();
  const k = [rand() * 10, rand() * 10, rand() * 10];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let d = 1
      + 0.22 * Math.sin(v.x * 2.1 + k[0]) * Math.sin(v.y * 1.7 + k[1])
      + 0.12 * Math.sin(v.z * 4.3 + k[2] + v.x * 3.1)
      + 0.06 * Math.sin(v.y * 9.0 + v.z * 7.0 + k[0]);
    // caras planas tipo fractura
    if (v.y > 0.55) d *= 0.92;
    v.multiplyScalar(d);
    v.set(v.x * s[0], v.y * s[1], v.z * s[2]);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
const rockGeos = Array.from({ length: 8 }, () =>
  makeRockGeo([0.8 + rand() * 0.6, 0.45 + rand() * 0.4, 0.8 + rand() * 0.5]));
const rockMats = ['#7a3a22', '#8d4a2c', '#5e2c1a', '#9a5a38'].map((c) => {
  const b = bumpTex.clone(); b.repeat.set(2, 2); b.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, bumpMap: b, bumpScale: 2.5 });
});

function addRock(x, z, scale) {
  const m = new THREE.Mesh(rockGeos[(rand() * rockGeos.length) | 0], rockMats[(rand() * rockMats.length) | 0]);
  m.scale.setScalar(scale);
  m.position.set(x, heightAt(x, z) + scale * 0.15, z);
  m.rotation.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}
// rocas protagonistas cerca de cámara
addRock(-6.5, 4, 3.2);
addRock(7.5, -2, 2.4);
addRock(3, 7, 1.1);
addRock(-14, -12, 4.5);
// dispersión
for (let i = 0; i < 260; i++) {
  const x = (rand() - 0.5) * 140, z = 14 - rand() * 150;
  const s = Math.pow(rand(), 3) * 1.8 + 0.12;
  addRock(x, z, s);
}

// ---------- Lunas: Fobos y Deimos ----------
function makeMoon(radius, squash, color, seedOff) {
  let g = new THREE.IcosahedronGeometry(radius, 5);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let d = 1 + 0.08 * Math.sin(v.x * 3 + seedOff) * Math.cos(v.y * 2.5) - 0.05 * Math.abs(Math.sin(v.z * 7 + v.x * 5));
    p.setXYZ(i, v.x * radius * d * squash[0], v.y * radius * d * squash[1], v.z * radius * d * squash[2]);
  }
  g.computeVertexNormals();
  const b = bumpTex.clone(); b.needsUpdate = true;
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    color, roughness: 1, bumpMap: b, bumpScale: 3, fog: false,
    emissive: new THREE.Color(color).multiplyScalar(0.38),
    transparent: true, opacity: 0.88, // atenuadas por el polvo atmosférico
  }));
  return m;
}
const phobos = makeMoon(24, [1.25, 0.9, 1], '#e6d6c6', 1.3);
phobos.position.copy(new THREE.Vector3(0.42, 0.34, -1).normalize().multiplyScalar(1100));
phobos.rotation.set(0.4, 0.9, 0.2);
const deimos = makeMoon(9, [1.1, 0.85, 1], '#efe2d4', 4.1);
deimos.position.copy(new THREE.Vector3(0.12, 0.43, -1).normalize().multiplyScalar(1100));
scene.add(phobos, deimos);

// ---------- Polvo en suspensión ----------
function makeDotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const DUST = 4000;
const dPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) {
  dPos[i * 3] = (rand() - 0.5) * 120;
  dPos[i * 3 + 1] = rand() * 18;
  dPos[i * 3 + 2] = 20 - rand() * 120;
}
const dGeo = new THREE.BufferGeometry();
dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({
  color: '#ffcf9a', size: 0.12, map: makeDotTexture(), transparent: true, opacity: 0.3,
  depthWrite: false, blending: THREE.AdditiveBlending,
}));
scene.add(dust);

// ---------- Post-procesado ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.7, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float v = smoothstep(0.95, 0.35, length(vUv - 0.5));
      gl_FragColor = vec4(c.rgb * mix(0.62, 1.0, v), c.a); }`,
}));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Bucle ----------
const clock = new THREE.Clock();
let frames = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const p = dGeo.attributes.position;
  for (let i = 0; i < DUST; i++) {
    let x = p.getX(i) + dt * (1.6 + Math.sin(t * 0.3 + i) * 0.4);
    let y = p.getY(i) + Math.sin(t + i * 0.7) * dt * 0.15;
    if (x > 60) x -= 120;
    p.setXY(i, x, y);
  }
  p.needsUpdate = true;
  phobos.rotation.y += dt * 0.01;
  controls.update();
  composer.render();
  if (++frames === 3) window.__sceneReady = true;
});
