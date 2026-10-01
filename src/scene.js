import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TRANSMISSIONS } from './model.js';
import { createMachinedGear } from './geometry/gears.js';
import { createGearboxHousing } from './geometry/housing.js';

const C = { steel: 0x89929c, dark: 0x343b43, blue: 0x58d8df, amber: 0xffbe54, green: 0x63e1b6, purple: 0xb39cff, red: 0xff7185 };
const NAMES = {
  engine: '엔진 입력', input: '입력축', output: '출력축', housing: '변속기 케이스', clutch: '클러치',
  'input-shaft': '입력축', 'output-shaft': '중간 출력축', selector: '동기화 슬리브',
  'clutch-a': '클러치 A · 홀수단', 'clutch-b': '클러치 B · 짝수단', 'shaft-a': '홀수단 축', 'shaft-b': '짝수단 축',
  'reverse-idler': '후진 아이들러', 'final-drive': '최종 전달 기어', primary: '구동 풀리', secondary: '종동 풀리',
  'gear-R': '후진 기어 쌍',
  belt: '금속 벨트', 'reverse-unit': '전후진 선택 장치', converter: '토크 컨버터', pump: '펌프', turbine: '터빈',
  stator: '스테이터', sun: '선 기어', ring: '링 기어', carrier: '캐리어', planets: '유성 기어',
  'brake-sun': '선 기어 브레이크', 'brake-ring': '링 기어 브레이크', 'brake-carrier': '캐리어 브레이크',
  'lock-clutch': '직결 클러치', mg1: 'MG1 · 발전 / 속도 제어', mg2: 'MG2 · 구동 모터', inverter: '인버터', battery: '배터리',
  bearings: '볼 베어링 · 축 지지', 'shaft-seals': '축 오일 씰', 'pressure-plate': '클러치 압력판', diaphragm: '다이어프램 스프링',
  'release-bearing': '릴리스 베어링', 'release-fork': '릴리스 포크', 'forward-clutch': '전진 클러치', 'reverse-clutch': '후진 클러치',
  'pulley-pistons': '풀리 유압 피스톤', 'shift-clutches': 'AT 변속 클러치 팩', 'valve-body': '유압 밸브 바디',
  'oil-pan': '오일 섬프 / 팬', 'oil-pump': '윤활 오일 펌프', 'oil-filter': '오일 스트레이너', 'oil-lines': '윤활 경로 · 개념 표시', cooler: '오일 냉각기',
};
for (let i = 1; i <= 6; i += 1) NAMES[`gear-${i}`] = `${i}단 기어 쌍`;

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const point = (x, y, z) => new THREE.Vector3(x, y, z);

let metalTextures;
function getMetalTextures() {
  if (metalTextures) return metalTextures;
  const size = 256;
  const make = lathed => {
    const bytes = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const r = Math.hypot(x - size / 2, y - size / 2);
      const pattern = lathed ? Math.sin(r * 2.9) : Math.sin(y * 2.4) + Math.sin(y * 0.43) * 0.3;
      const noise = Math.sin(x * 13.37 + y * 31.19) * 4;
      const v = Math.round(128 + pattern * 19 + noise), at = (y * size + x) * 4;
      bytes[at] = v; bytes[at + 1] = v; bytes[at + 2] = v; bytes[at + 3] = 255;
    }
    const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat); texture.needsUpdate = true;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; return texture;
  };
  metalTextures = { brushed: make(false), lathed: make(true) }; return metalTextures;
}

function material(color = C.steel, options = {}) {
  const { physicalColor = false, surface = 'brushed steel', ...properties } = options;
  const pathColors = [C.blue, C.amber, C.green, C.purple, C.red];
  const steelColor = !physicalColor && pathColors.includes(color) ? 0x818b97 : color;
  const mat = new THREE.MeshStandardMaterial({ color: steelColor, metalness: 0.94, roughness: 0.27, emissive: 0x000000, emissiveIntensity: 0,
    bumpMap: getMetalTextures().brushed, bumpScale: 0.0035, ...properties });
  mat.userData.surface = surface; return mat;
}

function cylinder(radius, length, mat, radialSegments = 40) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, radialSegments), mat);
  mesh.rotation.z = Math.PI / 2;
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function torus(radius, tube, mat) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 80), mat);
  mesh.rotation.y = Math.PI / 2;
  mesh.castShadow = true;
  return mesh;
}

function annulus(outer, inner, length, mat, inspectionGap = 0) {
  const shape = new THREE.Shape();
  if (inspectionGap) {
    const start = Math.PI + inspectionGap / 2, end = start + TAU - inspectionGap;
    shape.absarc(0, 0, outer, start, end, false); shape.lineTo(Math.cos(end) * inner, Math.sin(end) * inner); shape.absarc(0, 0, inner, end, start, true); shape.closePath();
  } else { shape.absarc(0, 0, outer, 0, TAU, false); const hole = new THREE.Path(); hole.absarc(0, 0, inner, 0, TAU, true); shape.holes.push(hole); }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1, curveSegments: 48 });
  const positions = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i += 1) if (Math.abs(normals.getZ(i)) > 0.9) uv.setXY(i, positions.getX(i) / (outer * 2) + 0.5, positions.getY(i) / (outer * 2) + 0.5);
  geometry.translate(0, 0, -length / 2); geometry.rotateY(Math.PI / 2); const mesh = new THREE.Mesh(geometry, mat); mesh.castShadow = true; return mesh;
}

function rod(a, b, radius, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, d.length(), 12), mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(point(0, 1, 0), d.normalize());
  mesh.castShadow = true;
  return mesh;
}

function machinedGear(teeth, radius, color, thickness = 0.32, internal = false, options = {}) {
  return createMachinedGear({ teeth, pitchRadius: radius, width: thickness, internal, helixDegrees: internal ? -20 : 25, boreRadius: Math.min(0.18, radius * 0.32),
    steelMaterial: material(color, { bumpMap: getMetalTextures().lathed, bumpScale: 0.004, roughness: 0.23, surface: 'recessed machined gear web' }),
    faceMaterial: material(color, { bumpMap: getMetalTextures().lathed, bumpScale: 0.004, roughness: 0.21, surface: 'involute helical machined steel' }),
    darkMaterial: material(0x4b535c, { roughness: 0.27, surface: 'gear retaining rings' }), ...options });
}

function clutchPack(color, radius = 0.68, count = 6, boreRadius = 0.16) {
  const group = new THREE.Group();
  group.userData.stackLayers = [];
  for (let i = 0; i < count; i += 1) {
    const disc = annulus(radius, Math.max(0.23, boreRadius + 0.025), 0.04, i % 2 ? material(C.steel, { roughness: 0.21, surface: 'steel clutch separator' }) : material(0x6a5746, { physicalColor: true, metalness: 0.14, roughness: 0.83, bumpScale: 0.012, surface: 'wet friction lining' }));
    disc.position.x = (i - (count - 1) / 2) * 0.08; group.add(disc);
    group.userData.stackLayers.push({ mesh: disc, index: i - (count - 1) / 2, friction: i % 2 === 0 });
    for (let j = 0; j < 12; j += 1) { const a = j * TAU / 12; const tab = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.055, 0.033), material(C.steel)); const tabRadius = i % 2 ? radius : Math.max(0.23, boreRadius + 0.025); tab.position.set(0, Math.cos(a) * tabRadius, Math.sin(a) * tabRadius); tab.rotation.x = a; disc.add(tab); }
  }
  const drivenHub = annulus(Math.max(0.26, boreRadius + 0.105), boreRadius, count * 0.08 + 0.18, material(C.dark));
  group.add(drivenHub); group.userData.drivenHub = drivenHub;
  // A cut-open splined drum reveals the alternating steel and friction discs.
  const drum = annulus(radius + 0.115, radius + 0.065, count * 0.08 + 0.17, material(0x5e6873, { surface: 'cut-open wet clutch steel drum' }), Math.PI * 0.76);
  group.add(drum);
  const end = annulus(radius + 0.13, radius * 0.53, 0.055, material(C.steel)); end.position.x = -count * 0.04 - 0.1; group.add(end);
  for (let j = 0; j < 28; j += 1) {
    const a = j * TAU / 28;
    if (Math.cos(a) < -0.43) continue;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(count * 0.08 + 0.16, 0.028, 0.035), material(C.steel));
    rib.position.set(0, Math.cos(a) * (radius + 0.124), Math.sin(a) * (radius + 0.124)); rib.rotation.x = a; group.add(rib);
  }
  for (let j = 0; j < 8; j += 1) {
    const a = j * TAU / 8, port = torus(0.022, 0.006, material(0x252b31));
    port.position.set(-count * 0.04 - 0.135, Math.cos(a) * radius * 0.72, Math.sin(a) * radius * 0.72); group.add(port);
  }
  return group;
}

function castFork(radius = 0.38, thickness = 0.075, side = 1) {
  const shape = new THREE.Shape(), start = -Math.PI * 0.82, end = Math.PI * 0.82;
  shape.absarc(0, 0, radius + 0.07, start, end, false);
  shape.lineTo(Math.cos(end) * (radius - 0.015), Math.sin(end) * (radius - 0.015));
  shape.absarc(0, 0, radius - 0.015, end, start, true); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 36 });
  geo.translate(0, 0, -thickness / 2); geo.rotateY(Math.PI / 2);
  const fork = new THREE.Group(); fork.add(new THREE.Mesh(geo, material(0x676f76, { roughness: 0.34, surface: 'cast shift fork' })));
  fork.add(rod(point(0, radius + 0.04, 0), point(0, 0.77, side * 0.52), 0.065, material(C.steel)));
  const eye = annulus(0.12, 0.065, 0.16, material(C.steel)); eye.position.set(0, 0.77, side * 0.52); fork.add(eye); return fork;
}

function synchroCone(radius, sign = 1) {
  const profile = [new THREE.Vector2(radius - 0.04, -0.065), new THREE.Vector2(radius + 0.055, -0.065), new THREE.Vector2(radius + 0.014, 0.065), new THREE.Vector2(radius - 0.045, 0.065), new THREE.Vector2(radius - 0.04, -0.065)];
  const cone = new THREE.Mesh(new THREE.LatheGeometry(profile, 64), material(0xa18c55, { physicalColor: true, roughness: 0.3, surface: 'brass synchronizer friction cone' }));
  cone.rotation.z = sign * Math.PI / 2; cone.castShadow = true; return cone;
}

function spokedWeb(outer, bore, depth) {
  const group = new THREE.Group(), mat = material(C.steel, { surface: 'machined ring drum support with six relief windows' }), hub = Math.max(bore + 0.105, 0.37);
  group.add(annulus(outer, outer - 0.08, depth, mat), annulus(hub, bore, depth, mat));
  for (let i = 0; i < 6; i += 1) {
    const a = i * TAU / 6, shape = new THREE.Shape();
    const path = [[hub - 0.015,a-0.16],[outer-0.05,a+0.025],[outer-0.05,a+0.085],[hub-0.015,a+0.16]];
    shape.setFromPoints(path.map(([r,t]) => new THREE.Vector2(Math.cos(t)*r,Math.sin(t)*r))); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.008, bevelSegments: 2 }); geometry.translate(0,0,-depth/2); geometry.rotateY(Math.PI/2);
    const spoke = new THREE.Mesh(geometry, mat); spoke.castShadow = true; group.add(spoke);
  }
  return group;
}

function roundedShape(width, height, radius = 0.4) {
  const x = -width / 2, y = -height / 2;
  const s = new THREE.Shape();
  s.moveTo(x + radius, y); s.lineTo(x + width - radius, y); s.quadraticCurveTo(x + width, y, x + width, y + radius);
  s.lineTo(x + width, y + height - radius); s.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  s.lineTo(x + radius, y + height); s.quadraticCurveTo(x, y + height, x, y + height - radius);
  s.lineTo(x, y + radius); s.quadraticCurveTo(x, y, x + radius, y); return s;
}

export function createTransmissionScene(container, { onSelectPart = () => {} } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07111b);
  scene.fog = new THREE.Fog(0x07111b, 18, 42);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  const graphicsControl = renderer.getContext().getExtension('WEBGL_lose_context');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'transmission-canvas'; renderer.domElement.setAttribute('aria-label', '변속기 구조 3D 보기. 드래그로 회전하고 부품을 클릭하세요.');
  container.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.07; controls.minDistance = 6; controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI * 0.89; controls.target.set(0, 0, 0);
  const environmentGenerator = new THREE.PMREMGenerator(renderer), studio = new RoomEnvironment();
  let environmentTarget = environmentGenerator.fromScene(studio, 0.035); scene.environment = environmentTarget.texture; scene.environmentIntensity = 0.72; studio.dispose(); environmentGenerator.dispose();
  const ambient = new THREE.HemisphereLight(0xe5eaf0, 0x24272b, 0.5); scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xf3f7ff, 2.1); keyLight.position.set(-4, 10, 7); keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1536, 1536); keyLight.shadow.camera.left = -9; keyLight.shadow.camera.right = 9; keyLight.shadow.camera.top = 7; keyLight.shadow.camera.bottom = -7;
  keyLight.shadow.normalBias = 0.035; scene.add(keyLight);
  const blueLight = new THREE.DirectionalLight(0xe1e8f1, 1.4); blueLight.position.set(5, 3, -6); scene.add(blueLight);
  const warmLight = new THREE.DirectionalLight(0xeee8df, 0.55); warmLight.position.set(-6, 2, -2); scene.add(warmLight);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), material(0x0d1b25, { metalness: 0.3, roughness: 0.65, emissiveIntensity: 0 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -3.25; floor.receiveShadow = true; scene.add(floor);
  const grid = new THREE.GridHelper(40, 80, 0x275269, 0x163143); grid.position.y = -3.24; grid.material.transparent = true; grid.material.opacity = 0.26; scene.add(grid);
  const assembly = new THREE.Group(); scene.add(assembly);
  const labelsLayer = document.createElement('div'); labelsLayer.className = 'scene-label-layer';
  Object.assign(labelsLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '2' }); container.appendChild(labelsLayer);
  const leaderLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  leaderLayer.classList.add('scene-leader-lines'); leaderLayer.setAttribute('aria-hidden', 'true');
  Object.assign(leaderLayer.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'hidden' }); labelsLayer.appendChild(leaderLayer);
  let requestedQuality = 'auto', effectiveQuality = 'balanced', autoAdapted = false;
  let lastFrameWall = 0, frameMs = 0, qualitySamples = 0, qualityStarted = performance.now(), lastRenderMs = 0;
  let batchStats = { originalMeshes: 0, instancedMeshes: 0, instancedCopies: 0 }, labelLayout = { visible: [], suppressed: [], overlaps: 0 };
  let contextLost = false;
  let renderFrames = 0, skippedIdleFrames = 0, renderInvalidated = true, lastRenderedSnapshot = null, lastRenderedViewKey = '', lastUpdateView = null;
  const invalidateRender = () => { renderInvalidated = true; };
  controls.addEventListener('change', invalidateRender);
  const qualityName = value => ['auto', 'high', 'balanced', 'low'].includes(value) ? value : 'auto';
  function gear(teeth, radius, color, thickness = 0.32, internal = false, options = {}) { return machinedGear(teeth, radius, color, thickness, internal, { ...options, detail: effectiveQuality }); }
  const pickRay = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let parts = new Map(), rotors = [], selectable = [], flowRoutes = [], particleMeshes = [], beltSegments = [], pulleyParts = null, preselectionMarkers = [], selectorForks = [], gearboxHousing = null;
  let type = 'mt', currentSnapshot = null, selected = null, pointerStart = null, lastPick = null, width = 1, height = 1, beltTravel = 0, lastFitExplode = -1, lastCategories = '';
  const ownedMaterials = new Set();
  const selectionOutline = new THREE.Box3Helper(new THREE.Box3(), 0x9fdae7); selectionOutline.material.transparent = true; selectionOutline.material.opacity = 0.42; selectionOutline.visible = false; scene.add(selectionOutline);

  function categoryForId(id) {
    const definition = TRANSMISSIONS[type]?.parts.find(p => p.id === id); if (definition?.category) return definition.category;
    if (id === 'input') return 'input';
    if (['bearings', 'shaft-seals'].includes(id)) return 'bearings';
    if (['oil-pan', 'oil-pump', 'oil-filter', 'oil-lines', 'valve-body', 'cooler'].includes(id)) return 'lubrication';
    if (['clutch', 'clutch-a', 'clutch-b', 'pressure-plate', 'diaphragm', 'release-bearing', 'release-fork', 'forward-clutch', 'reverse-clutch', 'pulley-pistons', 'shift-clutches', 'lock-clutch', 'reverse-unit', 'converter', 'pump', 'turbine', 'stator', 'brake-sun', 'brake-ring', 'brake-carrier'].includes(id)) return 'clutches';
    if (['mg1', 'mg2', 'inverter', 'battery'].includes(id)) return 'electrical';
    if (id === 'housing') return 'housing'; return 'gears';
  }

  function addPart(id, group, position, explode = [0, 0, 0], anchor = [0, 0, 0], color = C.blue, label = true) {
    group.position.set(...position); assembly.add(group);
    const labelElement = document.createElement('button'); labelElement.type = 'button'; labelElement.dataset.part = id;
    labelElement.className = 'scene-part-label'; labelElement.textContent = NAMES[id] || id;
    Object.assign(labelElement.style, { position: 'absolute', display: 'none', pointerEvents: 'auto', transform: 'translate(-50%, -50%)', font: '500 10px system-ui, sans-serif', color: '#c5d9e8', background: 'rgba(7,18,29,.84)', border: '1px solid rgba(102,147,179,.28)', borderRadius: '5px', padding: '4px 7px', whiteSpace: 'nowrap', cursor: 'pointer', backdropFilter: 'blur(8px)', boxShadow: '0 3px 12px #0004' });
    labelElement.addEventListener('click', () => choosePart(id)); labelsLayer.appendChild(labelElement);
    labelElement.style.display = 'block';
    if (id.startsWith('gear-')) { labelElement.textContent = `${NAMES[id] || id} · 대기`; labelElement.style.minWidth = `${labelElement.getBoundingClientRect().width - 16}px`; labelElement.textContent = NAMES[id] || id; }
    const labelWidth = labelElement.getBoundingClientRect().width; labelElement.style.display = 'none';
    const leader = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    leader.dataset.leaderPart = id; leader.setAttribute('fill', 'none'); leader.setAttribute('stroke-width', '1');
    leader.setAttribute('stroke', '#7894a9'); leader.setAttribute('opacity', '.6'); leader.style.display = 'none'; leaderLayer.appendChild(leader);
    const leaderShadow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    leaderShadow.setAttribute('fill', 'none'); leaderShadow.setAttribute('stroke', '#07121d'); leaderShadow.setAttribute('stroke-width', '3'); leaderShadow.setAttribute('opacity', '.72'); leaderShadow.style.display = 'none'; leaderLayer.insertBefore(leaderShadow, leader);
    const category = categoryForId(id); group.userData.category = category;
    const part = { id, group, base: point(...position), explode: point(...explode), anchor: point(...anchor), mechanicalAnchor: point(0, 0, 0), color, category, label, labelElement, labelWidth, labelHeight: 24, leader, leaderShadow, order: parts.size, materials: [] };
    group.traverse(object => {
      if (!object.isMesh) return;
      object.userData.partId = id; object.userData.category = category; selectable.push(object);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const mat of materials) {
        if (mat?.isMeshStandardMaterial) { mat.userData.baseColor = mat.color.clone(); mat.userData.baseEmissive = mat.emissive.clone(); part.materials.push(mat); ownedMaterials.add(mat); }
      }
    });
    parts.set(id, part); return group;
  }

  function rotate(object, key, axis = 'x', multiplier = 1) { rotors.push({ object, key, axis, multiplier }); return object; }
  function simpleShaft(id, x, y, z, length, color, key = id, radius = 0.13, explode = [0, 0, 0], label = true) {
    const g = new THREE.Group(), rotor = new THREE.Group(); g.add(rotor); rotor.add(cylinder(radius, length, material(color)));
    // Keyway and spline rails provide rotation cues on smooth shafts.
    for (let i = 0; i < 6; i += 1) {
      const a = i * TAU / 6;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(length * 0.86, radius * 0.24, radius * 0.24), material(C.steel));
      rail.position.set(0, Math.sin(a) * radius, Math.cos(a) * radius); rail.rotation.x = -a; rotor.add(rail);
    }
    addPart(id, g, [x, y, z], explode, [0, radius + 0.3, 0], color, label); rotate(rotor, key); return g;
  }

  function engine(x = -5.2, y = 0.9, z = 0, stubLength = 1.3, stubOffset = 0.5, inputPart = true, stubRadius = 0.14) {
    const g = new THREE.Group();
    g.add(gear(72, 0.74, C.steel, 0.16, false, { helixDegrees: 0, boreRadius: 0.18 }));
    g.add(annulus(0.68, 0.3, 0.18, material(C.steel, { bumpMap: getMetalTextures().lathed, bumpScale: 0.006, roughness: 0.2, surface: 'flywheel friction track' })));
    g.add(cylinder(0.27, 0.32, material(C.dark))); g.add(annulus(0.29, 0.18, 0.36, material(C.steel)));
    for (let i = 0; i < 8; i += 1) { const a = i * TAU / 8; const bolt = cylinder(0.045, 0.24, material(C.steel), 6); bolt.position.set(0.1, Math.cos(a) * 0.38, Math.sin(a) * 0.38); g.add(bolt); }
    for (const radius of [0.47, 0.56, 0.65]) { const toolRing = torus(radius, 0.004, material(0x707780, { roughness: 0.3 })); toolRing.position.x = 0.1; g.add(toolRing); }
    const mount = new THREE.Group(); mount.add(g); addPart('engine', mount, [x, y, z], [-0.8, 0, 0], [-0.2, 1, 0], C.blue); rotate(g, 'engine');
    if (inputPart) simpleShaft('input', x + stubOffset, y, z, stubLength, C.amber, 'input', stubRadius, [-0.5, 0, 0], false);
    else { const stub = cylinder(stubRadius, stubLength, material(C.steel)); stub.position.x = stubOffset; g.add(stub); stub.userData.partId = 'engine'; selectable.push(stub); }
  }

  function manualClutch(y) {
    const disc = new THREE.Group();
    disc.add(annulus(0.66, 0.4, 0.075, material(0x4d443b, { physicalColor: true, metalness: 0.08, roughness: 0.88, bumpScale: 0.014, surface: 'dry friction lining' })));
    disc.add(annulus(0.44, 0.17, 0.055, material(C.steel))); disc.add(annulus(0.23, 0.145, 0.22, material(C.dark)));
    for (let i = 0; i < 6; i += 1) {
      const a = i * TAU / 6; const spring = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.013, 6, 18), material(C.steel));
      const springSet = new THREE.Group(); for (let j = 0; j < 6; j += 1) { const turn = spring.clone(); turn.position.z = (j - 2.5) * 0.025; springSet.add(turn); }
      springSet.position.set(0, Math.cos(a) * 0.31, Math.sin(a) * 0.31); springSet.rotation.x = a; springSet.rotation.y = Math.PI / 2; disc.add(springSet);
    }
    for (let i = 0; i < 16; i += 1) {
      const a = i * TAU / 16, groove = rod(point(0.041, Math.cos(a) * 0.46, Math.sin(a) * 0.46), point(0.041, Math.cos(a + 0.09) * 0.63, Math.sin(a + 0.09) * 0.63), 0.007, material(0x211f1d, { physicalColor: true, metalness: 0.05, roughness: 0.8 }));
      disc.add(groove);
    }
    addPart('clutch', disc, [-3.62, y, 0], [-0.35, 0.4, 0], [0, 0.96, 0.1], C.blue); rotate(disc, 'clutch');
    const pressure = new THREE.Group(); pressure.add(annulus(0.73, 0.35, 0.14, material(C.steel, { roughness: 0.2, surface: 'clutch pressure plate' })));
    for (let i = 0; i < 6; i += 1) { const a = i * TAU / 6; const bolt = cylinder(0.052, 0.3, material(C.steel), 6); bolt.position.set(0.05, Math.cos(a) * 0.64, Math.sin(a) * 0.64); pressure.add(bolt); }
    const cover = annulus(0.82, 0.64, 0.19, material(0x626a74, { surface: 'stamped pressure plate cover' }), Math.PI * 0.58); cover.position.x = 0.13; pressure.add(cover);
    for (let i = 0; i < 6; i += 1) {
      const a = i * TAU / 6;
      pressure.add(rod(point(0.16, Math.cos(a) * 0.58, Math.sin(a) * 0.58), point(0.24, Math.cos(a) * 0.79, Math.sin(a) * 0.79), 0.047, material(C.steel)));
      const lug = cylinder(0.066, 0.12, material(C.steel), 6); lug.position.set(0.22, Math.cos(a) * 0.79, Math.sin(a) * 0.79); pressure.add(lug);
    }
    addPart('pressure-plate', pressure, [-3.51, y, 0], [0.25, 0.32, 0.4], [0, 0.95, 0.3], C.blue, false); rotate(pressure, 'pressure-plate');
    const fingers = new THREE.Group(); fingers.add(annulus(0.74, 0.57, 0.045, material(0x737b85, { surface: 'spring steel' })));
    for (let i = 0; i < 20; i += 1) { const a = i * TAU / 20; const finger = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.39, 0.055), material(0x77808b, { surface: 'spring steel' })); finger.position.set(0, Math.cos(a) * 0.42, Math.sin(a) * 0.42); finger.rotation.x = a; fingers.add(finger); }
    addPart('diaphragm', fingers, [-3.38, y, 0], [0.6, 0.45, 0.75], [0.05, 1.03, 0.3], C.blue, false); rotate(fingers, 'diaphragm');
    const release = new THREE.Group(), contact = annulus(0.29, 0.17, 0.09, material(C.steel)); release.add(contact);
    const sleeve = annulus(0.3, 0.19, 0.18, material(C.dark)); sleeve.position.x = 0.12; release.add(sleeve);
    addPart('release-bearing', release, [-3.15, y, 0], [0.85, 0.42, 0.9], [0, 0.65, 0.3], C.blue, false); rotate(contact, 'release-bearing');
    const fork = castFork(0.3, 0.09); fork.rotation.x = Math.PI;
    fork.add(rod(point(0, 0.75, 0.55), point(0.08, 1.05, 0.98), 0.06, material(C.steel)));
    addPart('release-fork', fork, [-3.12, y, 0], [0.85, -0.2, 1.2], [0.1, -0.8, 1.2], C.blue, false);
  }

  function bearingsAndSeals(entries) {
    const bearings = new THREE.Group(), seals = new THREE.Group();
    for (const [x, y, z, key, axis = 'x', shaftRadius = 0.145] of entries) {
      const bearing = new THREE.Group();
      const ballCenter = shaftRadius + 0.128;
      bearing.add(annulus(shaftRadius + 0.235, ballCenter + 0.035, 0.22, material(C.steel, { roughness: 0.19, surface: 'stationary bearing outer race' })));
      const inner = new THREE.Group(); inner.add(annulus(shaftRadius + 0.085, shaftRadius, 0.22, material(C.steel, { roughness: 0.15, surface: 'rotating bearing inner race' }))); bearing.add(inner); rotate(inner, key);
      const cage = new THREE.Group();
      for (let i = 0; i < 10; i += 1) { const a = i * TAU / 10; const ball = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 10), material(0xd3d6da, { roughness: 0.12, surface: 'bearing balls' })); ball.position.set(0, Math.cos(a) * ballCenter, Math.sin(a) * ballCenter); cage.add(ball); }
      const cageRing = torus(ballCenter, 0.013, material(0x8f8365, { physicalColor: true, metalness: 0.85, surface: 'bearing cage' })); cageRing.position.x = 0.1; cage.add(cageRing);
      bearing.add(cage); rotate(cage, key, 'x', 0.42); if (axis === 'z') bearing.rotation.y = Math.PI / 2;
      bearing.position.set(x, y, z); bearings.add(bearing);
      const seal = new THREE.Group(); seal.add(annulus(shaftRadius + 0.195, shaftRadius + 0.045, 0.07, material(C.dark), Math.PI * 0.66));
      seal.add(torus(shaftRadius + 0.04, 0.037, material(0x18191b, { physicalColor: true, metalness: 0.02, roughness: 0.8, surface: 'elastomer shaft sealing lip' })));
      seal.add(torus(shaftRadius + 0.08, 0.009, material(C.steel))); seal.position.set(x + (axis === 'x' ? 0.2 : 0), y, z + (axis === 'z' ? 0.2 : 0));
      if (axis === 'z') seal.rotation.y = Math.PI / 2; seals.add(seal);
    }
    addPart('bearings', bearings, [0, 0, 0], [0, 0.1, 0.8], [-2.5, 1.55, 0.8], C.blue);
    addPart('shaft-seals', seals, [0, 0, 0], [0.1, 0.15, 1.3], [3.3, 0.9, 1.0], C.blue, false);
  }

  function directionClutches() {
    for (const [id, z] of [['forward-clutch', -2.15], ['reverse-clutch', -2.82]]) {
      const wrapper = new THREE.Group(), pack = clutchPack(C.steel, 0.46, 4); wrapper.add(pack); wrapper.rotation.y = Math.PI / 2;
      addPart(id, wrapper, [-1.68, 0, z], [-0.6, 0.28, z < -2.5 ? -0.8 : -0.4], [-0.2, 0.9, 0], C.blue, false); rotate(pack, id);
    }
    const pistons = new THREE.Group();
    for (const x of [-1.68, 1.68]) { const piston = annulus(1.12, 0.3, 0.16, material(C.dark, { surface: 'pulley hydraulic piston' })); piston.rotation.y = Math.PI / 2; piston.position.set(x, 0, -0.85); pistons.add(piston); }
    addPart('pulley-pistons', pistons, [0, 0, 0], [0, 0, -0.8], [1.7, -1.15, -0.9], C.blue, false);
  }

  function shiftClutches() {
    const bank = new THREE.Group();
    for (const [x, radius, key] of [[-1.6, 0.68, 'sun'], [1.25, 1.05, 'ring']]) { const pack = clutchPack(C.steel, radius, 5); pack.position.x = x; bank.add(pack); rotate(pack, key); }
    addPart('shift-clutches', bank, [0, 0, 0], [-0.45, 0.55, 0.6], [-1.55, 1.15, 0.55], C.blue, false);
  }

  function oilSystem(kind) {
    const parallel = kind === 'mt' || kind === 'dct', panY = parallel ? -2.8 : -2.35, panLength = 5.4, pumpX = parallel ? -1.9 : -2.6;
    const pan = new THREE.Group();
    const wall = material(0x77818a, { transparent: true, opacity: 0.24, depthWrite: false, roughness: 0.31, surface: 'cast aluminum oil pan' });
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(panLength, 0.12, 2.55), wall.clone()); bottom.position.y = -0.29; pan.add(bottom);
    for (const z of [-1.25, 1.25]) { const side = new THREE.Mesh(new THREE.BoxGeometry(panLength, 0.65, 0.09), wall.clone()); side.position.z = z; pan.add(side); }
    for (const x of [-panLength / 2, panLength / 2]) { const end = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.65, 2.55), wall.clone()); end.position.x = x; pan.add(end); }
    const fluid = new THREE.Mesh(new THREE.BoxGeometry(panLength - 0.2, 0.37, 2.32), material(0xde9e41, { physicalColor: true, metalness: 0.02, roughness: 0.1, transparent: true, opacity: 0.27, depthWrite: false, bumpMap: null, surface: 'oil volume' })); fluid.position.y = -0.04; pan.add(fluid);
    for (let i = 0; i < 12; i += 1) { const x = -panLength / 2 + 0.28 + i * (panLength - 0.56) / 11; const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.09, 6), material(C.steel)); bolt.position.set(x, 0.34, 1.18); pan.add(bolt); }
    const plug = cylinder(0.085, 0.16, material(C.steel), 6); plug.position.set(panLength / 2, -0.17, 0.8); pan.add(plug);
    addPart('oil-pan', pan, [0, panY, 0], [0, 0.02, 1.1], [-1.3, 0, 1.55], 0xde9e41);
    const connections = [];
    if (kind !== 'mt') {
      const pumpGroup = new THREE.Group();
      const pumpCover = annulus(0.57, 0.42, 0.19, material(C.steel)); pumpGroup.add(pumpCover);
      for (const [y, direction] of [[-0.22, 1], [0.22, -1]]) { const g = gear(14, 0.22, C.steel, 0.13, false, { helixDegrees: 0, boreRadius: 0.065 }); g.position.y = y; pumpGroup.add(g); if (kind !== 'ecvt') rotate(g, 'oil-pump', 'x', direction); }
      for (const y of [-0.49, 0.49]) { const port = cylinder(0.09, 0.38, material(C.dark)); port.position.set(0.1, y, 0); pumpGroup.add(port); }
      addPart('oil-pump', pumpGroup, [pumpX, -1.58, 1.25], [-0.6, 0.35, 0.75], [0, -0.73, 0.5], 0xde9e41, false);
      const strainer = new THREE.Group(); strainer.add(new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 0.8), material(C.dark, { surface: 'oil pickup strainer housing' })));
      for (let i = 0; i < 17; i += 1) { const wire = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.016, 0.72), material(C.steel, { surface: 'strainer wire mesh' })); wire.position.set(-0.45 + i * 0.056, -0.07, 0); strainer.add(wire); }
      for (let i = 0; i < 12; i += 1) { const wire = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.016, 0.015), material(C.steel)); wire.position.set(0, -0.065, -0.33 + i * 0.06); strainer.add(wire); }
      addPart('oil-filter', strainer, [-1.1, panY + 0.15, 0.65], [-0.4, 0.4, 1.2], [0, -0.38, 0.55], 0xde9e41, false);
      connections.push([[-1.1, panY + 0.15, 0.65], [pumpX, -2.02, 1.25], [pumpX, -1.58, 1.25]]);
      if (kind !== 'ecvt') {
        const valves = new THREE.Group(); valves.add(new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.21, 1.05), material(C.steel, { roughness: 0.28, surface: 'machined valve body' })));
        for (let i = 0; i < 5; i += 1) {
          const valve = cylinder(0.085, 1.6, material(C.steel)); valve.position.set(0, 0.19, -0.38 + i * 0.19); valves.add(valve);
          const solenoid = cylinder(0.14, 0.32, material(0x24282e, { physicalColor: true, metalness: 0.36, roughness: 0.44, surface: 'hydraulic valve solenoid' })); solenoid.position.set(0.75, 0.19, valve.position.z); valves.add(solenoid);
          const channel = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.013, 0.042), material(0x515a63)); channel.position.set(-0.13, 0.11, -0.29 + i * 0.15); valves.add(channel);
        }
        addPart('valve-body', valves, [0.2, panY + 0.65, 1.0], [0.25, 0.6, 1.55], [0, -0.34, 0.7], 0xde9e41, false);
        connections.push([[pumpX, -1.58, 1.25], [-1.7, panY + 0.65, 1.6], [0.2, panY + 0.65, 1.0]]);
        if (kind === 'dct') connections.push([[0.2, panY + 0.65, 1], [-2.5, -0.2, 0.95], [-3.12, 0.9, 0.4]]);
        if (kind === 'cvt') connections.push([[0.2, panY + 0.65, 1], [-1.68, -1, -1.25], [-1.68, 0, -0.85]], [[0.2, panY + 0.65, 1], [1.68, -1, -1.25], [1.68, 0, -0.85]]);
        if (kind === 'at') connections.push([[0.2, panY + 0.65, 1], [-1.6, -0.8, 1.0], [-1.6, 0, 0.6]], [[0.2, panY + 0.65, 1], [1.25, -0.8, 1.35], [1.25, 0, 1.05]]);
      }
      if (kind === 'dct' || kind === 'ecvt') {
        const cooler = new THREE.Group(); cooler.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.4), material(C.steel, { surface: 'oil heat exchanger' })));
        for (let i = 0; i < 11; i += 1) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.5, 0.48), material(C.steel)); fin.position.x = -0.65 + i * 0.13; cooler.add(fin); }
        addPart('cooler', cooler, [2.15, -1.7, -1.65], [0.6, 0.6, -0.9], [0, -0.63, -0.3], 0xde9e41, false);
        connections.push([[pumpX, -1.58, 1.25], [-2, -1.2, -1.5], [2.15, -1.7, -1.65]]);
        if (kind === 'ecvt') connections.push([[2.15, -1.7, -1.65], [-1.67, -0.75, -0.5], [-1.67, 0.5, 0]], [[2.15, -1.7, -1.65], [2.55, -0.75, -0.5], [2.55, 0.5, 0]]);
      }
      connections.push([[2.3, 0.5, 0.65], [2.9, -0.6, 0.8], [2.3, panY + 0.2, 0.6]]);
    } else {
      // Manual gearboxes splash oil from the immersed gears; no hydraulic pipes.
      connections.push([[-1.65, -2.6, 0], [-1.85, -0.8, 0.45], [-1.65, 0.9, 0.3]], [[-1.65, 0.9, 0.3], [1, 0.2, 0.3], [2.2, -2.6, 0.4]]);
    }
    const pipeGroup = new THREE.Group();
    for (const coordinates of connections) {
      const curve = new THREE.CatmullRomCurve3(coordinates.map(p => point(...p)));
      if (kind !== 'mt') { const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.032, 7, false), material(C.dark, { roughness: 0.22, surface: 'schematic oil passage' })); pipeGroup.add(pipe); }
      const r = route([], coordinates, 0xde9e41); r.oil = true; pipeGroup.add(r.line); r.line.material.opacity = kind === 'mt' ? 0.1 : 0.34;
      r.beads.forEach(bead => { bead.scale.setScalar(0.65); bead.userData.category = 'lubrication'; });
    }
    addPart('oil-lines', pipeGroup, [0, 0, 0], [0, 0.1, 0.35], [-1.9, -1.2, 1.7], 0xde9e41, false);
  }

  function serviceParts(kind) {
    const entries = kind === 'mt' || kind === 'dct'
      ? [[-2.35, 0.9, 0, kind === 'mt' ? 'input-shaft' : 'shaft-b', 'x', kind === 'mt' ? 0.15 : 0.24], [2.25, 0.9, 0, kind === 'mt' ? 'input-shaft' : 'shaft-a', 'x', 0.15], [-2.35, -1.1, 0, 'output-shaft', 'x', 0.17], [2.5, -1.1, 0, 'output-shaft', 'x', 0.17]]
      : kind === 'cvt' ? [[-1.68, 0, -1.12, 'primary', 'z', 0.205], [-1.68, 0, 1.12, 'primary', 'z', 0.205], [1.68, 0, -1.12, 'secondary', 'z', 0.205], [1.68, 0, 1.12, 'secondary', 'z', 0.205]]
        : kind === 'at' ? [[-2.25, 0, 0, 'turbine', 'x', 0.155], [-0.75, 0, 0, 'sun', 'x', 0.15], [3.25, 0, 0, 'output', 'x', 0.205], [4.8, 0, 0, 'output', 'x', 0.205]]
          : [[-2.25, 0, 0, 'engine', 'x', 0.13], [-0.75, 0, 0, 'sun', 'x', 0.21], [3.25, 0, 0, 'ring', 'x', 0.22], [4.8, 0, 0, 'output', 'x', 0.195]];
    bearingsAndSeals(entries); oilSystem(kind);
  }

  function housing() {
    gearboxHousing = createGearboxHousing(type);
    addPart('housing', gearboxHousing.group, [0, 0, 0], [0, 0.1, -0.1], [0.3, 2.1, -0.7], C.blue, false);
  }

  function route(ids, coordinates, color) {
    const points = coordinates.map(p => point(...p));
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const line = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.021, 6, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.26, depthWrite: false }));
    assembly.add(line);
    const beads = [];
    for (let i = 0; i < 8; i += 1) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.051, 8, 6), new THREE.MeshBasicMaterial({ color })); assembly.add(bead); beads.push(bead); particleMeshes.push(bead);
    }
    const result = { ids, curve, color, line, beads, progress: 0 }; flowRoutes.push(result); return result;
  }

  function buildParallel(dual) {
    const upperY = 0.9, lowerY = -1.1, toothPairs = [[18, 62], [24, 56], [30, 50], [36, 44], [42, 38], [46, 34]];
    const bankOrder = dual ? [2, 4, 6, 1, 3, 5] : [1, 2, 3, 4, 5, 6], gearX = {};
    bankOrder.forEach((number, index) => { gearX[number] = -1.65 + index * 0.64; });
    const reverseX = dual ? -2.18 : 2.20, finalX = 2.85, engineX = dual ? -4.3 : -3.85;
    engine(engineX, upperY, 0, dual ? 0.43 : 0.14, dual ? 0.22 : 0.075); housing();
    if (dual) {
      const a = clutchPack(C.amber, 0.65, 6); addPart('clutch-a', a, [-3.50, upperY, 0], [-0.3, 0.65, 0.5], [-0.2, 0.95, 0.3], C.amber); rotate(a, 'clutch-a');
      const b = clutchPack(C.blue, 0.83, 6, 0.24); addPart('clutch-b', b, [-2.85, upperY, 0], [0, -0.35, -0.6], [0.15, 0.75, -0.6], C.blue); rotate(b, 'clutch-b');
      const inputRotor = parts.get('input').group.children[0], drumOffset = -3.20 - parts.get('input').base.x;
      const commonDrum = annulus(1.05, 0.985, 1.42, material(0x626d79, { surface: 'common DCT engine driven hollow input drum' }), Math.PI * 0.8);
      commonDrum.position.x = drumOffset; inputRotor.add(commonDrum);
      const driveWeb = annulus(1.055, 0.15, 0.065, material(C.steel), Math.PI * 0.8); driveWeb.position.x = -3.91 - parts.get('input').base.x; inputRotor.add(driveWeb);
      simpleShaft('shaft-a', -0.70, upperY, 0, 6.2, C.amber, 'shaft-a', 0.13, [0, 0.2, 0.25], false);
      // The short outer shaft ends before the odd-gear bank. Its bore is real,
      // exposing the long inner shaft when looking from either axial end.
      const sleeve = new THREE.Group();
      sleeve.add(annulus(0.235, 0.155, 3.15, material(0x6e7984, { surface: 'hollow second input shaft' })));
      for (const x of [-1.4, 1.35]) { const shoulder = annulus(0.26, 0.155, 0.09, material(C.steel)); shoulder.position.x = x; sleeve.add(shoulder); }
      for (let i = 0; i < 18; i += 1) { const a = i * TAU / 18, spline = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.024, 0.022), material(C.steel)); spline.position.set(-1.08, Math.cos(a) * 0.236, Math.sin(a) * 0.236); spline.rotation.x = a; sleeve.add(spline); }
      addPart('shaft-b', sleeve, [-1.625, upperY, 0], [0, 0.45, -0.55], [-0.2, 0.65, -0.55], C.blue, false); rotate(sleeve, 'shaft-b');
    } else {
      manualClutch(upperY);
      simpleShaft('input-shaft', -0.55, upperY, 0, 6.2, C.amber, 'input-shaft', 0.15, [0, 0.15, 0], false);
    }
    simpleShaft('output-shaft', 0.2, lowerY, 0, 5.45, C.green, 'output-shaft', 0.17, [0, -0.3, 0], false);
    for (const number of bankOrder) {
      const x = gearX[number], pair = toothPairs[number - 1], color = dual ? (number % 2 ? C.amber : C.blue) : C.steel, g = new THREE.Group();
      const input = gear(pair[0], pair[0] * 0.025, color, 0.28, false, { helixDegrees: 25, boreRadius: dual ? (number % 2 ? 0.145 : 0.245) : 0.17 });
      input.position.y = upperY;
      const output = gear(pair[1], pair[1] * 0.025, C.green, 0.28, false, { helixDegrees: -25, boreRadius: 0.19 });
      output.position.y = lowerY; output.rotation.x = Math.PI / pair[1];
      g.add(input, output);
      // Free gears carry a cone and a dog ring on the selector side.
      const cone = synchroCone(0.315, number % 2 ? -1 : 1); cone.position.set(number % 2 ? 0.235 : -0.235, lowerY, 0); g.add(cone);
      const dog = gear(24, 0.31, C.steel, 0.06, false, { helixDegrees: 0, boreRadius: 0.195 }); dog.position.set(number % 2 ? 0.2 : -0.2, lowerY, 0); g.add(dog);
      rotate(cone, 'gear-' + number + '-output'); rotate(dog, 'gear-' + number + '-output');
      addPart('gear-' + number, g, [x, 0, 0], [(x / 1.65) * 0.6, number % 2 ? 0.16 : -0.12, 0], [0, lowerY - pair[1] * 0.025 - 0.26, 0.5], color);
      rotate(input, 'gear-' + number + '-input'); rotate(output, 'gear-' + number + '-output');
      if (dual) { const marker = torus(pair[1] * 0.025 + 0.07, 0.011, new THREE.MeshBasicMaterial({ color: C.purple, transparent: true, opacity: 0.58, depthWrite: false })); marker.position.set(0.15, lowerY, 0); marker.visible = false; g.add(marker); preselectionMarkers.push({ id: 'gear-' + number, mesh: marker }); }
      route(['gear-' + number], [[engineX - 0.2, upperY, 0], [x, upperY, 0]], C.blue);
      route(['gear-' + number], [[x, upperY, 0], [x, lowerY, 0], [finalX, lowerY, 0], [finalX, lowerY - 0.92, 0], [4.45, lowerY - 0.92, 0]], C.amber);
    }
    const selector = new THREE.Group();
    const collars = dual ? [...bankOrder.map(n => ({ x: gearX[n] + (n % 2 ? 0.32 : -0.32), gears: [String(n)], side: n % 2 ? 1 : -1, direction: n % 2 ? -1 : 1 })), { x: reverseX + 0.32, gears: ['R'], side: -1, direction: -1 }]
      : [0, 1, 2].map(i => ({ x: (gearX[i * 2 + 1] + gearX[i * 2 + 2]) / 2, gears: [String(i * 2 + 1), String(i * 2 + 2)], side: 1 }));
    for (const entry of collars) {
      const collar = new THREE.Group(), rotor = new THREE.Group(), slider = annulus(0.37, 0.19, dual ? 0.1 : 0.15, material(C.steel, { surface: 'splined synchronizer sliding sleeve' }));
      rotor.add(slider);
      for (let j = 0; j < 28; j += 1) { const a = j * TAU / 28, spline = new THREE.Mesh(new THREE.BoxGeometry(dual ? 0.13 : 0.18, 0.018, 0.027), material(C.steel)); spline.position.set(0, Math.cos(a) * 0.36, Math.sin(a) * 0.36); spline.rotation.x = a; rotor.add(spline); }
      for (const sign of [-1, 1]) { const groove = torus(0.378, 0.011, material(C.dark)); groove.position.x = sign * 0.031; rotor.add(groove); }
      collar.add(rotor, castFork(0.38, 0.075, entry.side)); rotate(rotor, 'output-shaft');
      collar.position.x = entry.x; selector.add(collar); selectorForks.push({ group: collar, base: entry.x, gears: entry.gears, dual, direction: entry.direction });
    }
    selector.add(rod(point(-2.3, 0.77, 0.52), point(2.28, 0.77, 0.52), 0.06, material(C.steel)));
    if (dual) selector.add(rod(point(-2.38, 0.77, -0.52), point(1.85, 0.77, -0.52), 0.06, material(C.steel)));
    addPart('selector', selector, [0, lowerY, 0], [0, -0.55, 1.1], [0, 0.4, 1.15], C.purple, !dual);
    // Spur reverse gears have two external meshes through an offset idler.
    const reversePair = new THREE.Group();
    const reverseInput = gear(18, 0.36, C.red, 0.18, false, { helixDegrees: 0, boreRadius: dual ? 0.245 : 0.17 }); reverseInput.position.y = upperY;
    const reverseOutput = gear(62, 1.24, C.red, 0.18, false, { helixDegrees: 0, boreRadius: 0.19 }); reverseOutput.position.y = lowerY;
    if (dual) { const dog = gear(24, 0.31, C.steel, 0.06, false, { helixDegrees: 0, boreRadius: 0.195 }); dog.position.set(0.2, lowerY, 0); reversePair.add(dog); rotate(dog, 'gear-R-output'); }
    reversePair.add(reverseInput, reverseOutput); addPart('gear-R', reversePair, [reverseX, 0, 0], [dual ? -0.85 : 0.85, 0.05, 0], [0, -2.57, 0.2], C.red, false); rotate(reverseInput, 'gear-R-input'); rotate(reverseOutput, 'gear-R-output');
    const reverse = gear(18, 0.36, C.red, 0.18, false, { helixDegrees: 0, boreRadius: 0.105 }); addPart('reverse-idler', reverse, [reverseX, 0.4104, 0.527913], [dual ? -0.85 : 0.85, 0.1, 0.75], [0, 0.65, 0.4], C.red); rotate(reverse, 'reverse-idler');
    const finalDrive = new THREE.Group();
    const counterGear = gear(32, 0.46, C.green, 0.29, false, { helixDegrees: 25, boreRadius: 0.185 }); counterGear.position.y = 0.46;
    const axleGear = gear(32, 0.46, C.green, 0.29, false, { helixDegrees: -25, boreRadius: 0.185 }); axleGear.position.y = -0.46;
    const flange = annulus(0.4, 0.19, 0.12, material(C.steel)); flange.position.set(0.28, -0.46, 0); axleGear.add(flange); flange.position.y = 0;
    for (let j = 0; j < 6; j += 1) { const a = j * TAU / 6, bolt = cylinder(0.033, 0.1, material(C.steel), 6); bolt.position.set(0.36, Math.cos(a) * 0.315, Math.sin(a) * 0.315); axleGear.add(bolt); }
    finalDrive.add(counterGear, axleGear); addPart('final-drive', finalDrive, [finalX, lowerY - 0.46, 0], [0.9, -0.5, 0], [0.15, -1, 0], C.green, false); rotate(counterGear, 'output-shaft'); rotate(axleGear, 'output');
    const output = simpleShaft('output', 3.6, lowerY - 0.92, 0, 1.6, C.green, 'output', 0.17, [1, -0.5, 0], true);
    const flangeOut = annulus(0.31, 0.17, 0.12, material(C.steel)); flangeOut.position.x = 0.77; output.children[0].add(flangeOut);
    route(['gear-R', 'reverse-idler'], [[engineX - 0.2, upperY, 0], [reverseX, upperY, 0]], C.blue);
    route(['gear-R', 'reverse-idler'], [[reverseX, upperY, 0], [reverseX, 0.4104, 0.527913], [reverseX, lowerY, 0], [finalX, lowerY, 0], [finalX, lowerY - 0.92, 0], [4.45, lowerY - 0.92, 0]], C.amber);
    if (dual) for (const branch of ['a', 'b']) {
      const pack = parts.get('clutch-' + branch).group;
      for (const layer of pack.userData.stackLayers || []) if (layer.friction) rotors.push({ object: layer.mesh, key: 'clutch-' + branch + '-friction', rpmKey: 'shaft-' + branch, subtract: 'clutch-' + branch, axis: 'x', multiplier: 1 });
      rotors.push({ object: pack.userData.drivenHub, key: 'clutch-' + branch + '-hub', rpmKey: 'shaft-' + branch, subtract: 'clutch-' + branch, axis: 'x', multiplier: 1 });
    }
  }
  function coneSheave(color, sign, inspection = false) {
    const profile = [new THREE.Vector2(0.22, -0.27), new THREE.Vector2(1.47, -0.27), new THREE.Vector2(1.49, -0.0382), new THREE.Vector2(0.23, 0.05), new THREE.Vector2(0.22, -0.27)];
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 112, inspection ? Math.PI * 0.48 : 0, inspection ? Math.PI * 1.27 : TAU), material(color, { bumpMap: getMetalTextures().lathed, bumpScale: 0.0025, roughness: 0.18, side: THREE.DoubleSide, surface: 'machined conical pulley sheave' })); mesh.rotation.z = sign * Math.PI / 2; mesh.castShadow = true; return mesh;
  }

  function buildCVT() {
    housing();
    const pulleyAssembly = new THREE.Group(); pulleyAssembly.rotation.y = Math.PI / 2; assembly.add(pulleyAssembly);
    pulleyParts = [];
    for (const [id, center, color] of [['primary', -1.68, C.amber], ['secondary', 1.68, C.green]]) {
      const g = new THREE.Group();
      const rotor = new THREE.Group();
      const a = coneSheave(color, -1, true), b = coneSheave(color, 1); a.position.x = -0.24; b.position.x = 0.24;
      rotor.add(a, b);
      const contactRing = torus(1, 0.017, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
      contactRing.position.x = -0.55; rotor.add(contactRing);
      rotor.add(cylinder(0.2, 2.1, material(C.steel)));
      for (const sign of [-1, 1]) {
        const shoulder = annulus(0.5, 0.205, 0.28, material(C.steel, { surface: 'pulley spline hub and piston support' })); shoulder.position.x = sign * 0.55; rotor.add(shoulder);
        for (let i = 0; i < 16; i += 1) { const angle = i * TAU / 16, rib = rod(point(sign * 0.35, Math.cos(angle) * 0.45, Math.sin(angle) * 0.45), point(sign * 0.35, Math.cos(angle) * 1.30, Math.sin(angle) * 1.30), 0.022, material(0x64717c)); if (sign === 1) rotor.add(rib); }
        const retention = annulus(0.36, 0.2, 0.07, material(0x606a75)); retention.position.x = sign * 0.9; rotor.add(retention);
      }
      g.add(rotor); addPart(id, g, [0, 0, center], [0, 0, center < 0 ? -0.55 : 0.55], [0, 1.8, 0], color);
      // Move the registered groups into this common plane without changing local coordinates.
      pulleyAssembly.attach(g); g.position.set(0, 0, center); g.rotation.set(0, 0, 0);
      rotate(rotor, id); pulleyParts.push({ id, group: g, sheaves: [a, b], contactRing });
    }
    const belt = new THREE.Group();
    const beltMat = material(0x646d77, { metalness: 0.94, roughness: 0.27, surface: 'stamped CVT steel belt element' });
    const segmentShape = new THREE.Shape(); segmentShape.moveTo(-0.125, -0.039); segmentShape.lineTo(0.125, -0.039); segmentShape.lineTo(0.12, 0.018); segmentShape.lineTo(0.045, 0.044); segmentShape.lineTo(-0.045, 0.044); segmentShape.lineTo(-0.12, 0.018); segmentShape.closePath();
    const beltGeometry = new THREE.ExtrudeGeometry(segmentShape, { depth: 0.104, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 }); beltGeometry.translate(0, 0, -0.052);
    for (let i = 0; i < 142; i += 1) {
      const segment = new THREE.Mesh(beltGeometry, beltMat); segment.castShadow = true; belt.add(segment); beltSegments.push(segment);
    }
    addPart('belt', belt, [0, 0, 0], [0, 0.22, 0], [0, 1.92, 0], C.blue); pulleyAssembly.attach(belt); belt.position.set(0, 0, 0); belt.rotation.set(0, 0, 0);
    const reverse = new THREE.Group(), reverseRotor = clutchPack(C.purple, 0.55, 4); reverse.add(reverseRotor); addPart('reverse-unit', reverse, [-1.68, 0, -1.65], [-0.4, 0, -0.55], [0, -0.8, -0.25], C.purple); reverse.rotation.y = Math.PI / 2; rotate(reverseRotor, 'reverse-unit');
    engine(-1.68, 0, -3.5); parts.get('engine').group.rotation.y = Math.PI / 2; parts.get('engine').explode.set(-0.35, 0, -0.85);
    const inputShaft = parts.get('input'); inputShaft.base.set(-1.68, 0, -2.98); inputShaft.group.position.copy(inputShaft.base); inputShaft.group.rotation.y = Math.PI / 2; inputShaft.explode.set(-0.35, 0, -0.55);
    const outshaft = simpleShaft('output', 1.68, 0, 1.9, 1.3, C.green, 'output', 0.16, [0.55, 0, 0.5], true); outshaft.rotation.y = Math.PI / 2;
    route(['primary', 'secondary'], [[-1.68, 0, -3.6], [-1.68, 0, 0]], C.blue);
    route(['primary', 'secondary'], [[-1.68, 0, 0], [0, 1.0, 0], [1.68, 0, 0], [1.68, 0, 2.5]], C.amber);
    directionClutches();
  }

  function converter() {
    const group = new THREE.Group();
    const colors = [C.amber, C.blue, C.purple], ids = ['pump', 'turbine', 'stator'];
    for (let j = 0; j < 3; j += 1) {
      const rotor = new THREE.Group(); const radius = j === 2 ? 0.46 : 0.91;
      rotor.add(annulus(radius + 0.105, radius - 0.01, j === 2 ? 0.20 : 0.26, material(colors[j]), Math.PI * 0.55));
      rotor.add(annulus(j === 2 ? 0.22 : 0.32, 0.145, 0.26, material(C.steel)));
      for (let i = 0; i < (j === 2 ? 13 : 23); i += 1) {
        const a = i * TAU / (j === 2 ? 13 : 23);
        const positions = [], indices = [], rows = 12, columns = 3, hand = j === 0 ? 1 : -1;
        for (let r = 0; r <= rows; r += 1) for (let c = 0; c <= columns; c += 1) {
          const t = r / rows, v = c / columns - 0.5, rad = radius * (0.38 + 0.62 * t), angle = a + hand * (t * 0.42 + Math.sin(t * Math.PI) * 0.16) + v * 0.06;
          positions.push(v * 0.22 + Math.sin(t * Math.PI) * 0.075, Math.cos(angle) * rad, Math.sin(angle) * rad);
        }
        for (let r = 0; r < rows; r += 1) for (let c = 0; c < columns; c += 1) { const k = r * (columns + 1) + c; indices.push(k, k + 1, k + columns + 1, k + 1, k + columns + 2, k + columns + 1); }
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
        const blade = new THREE.Mesh(geometry, material(colors[j], { side: THREE.DoubleSide, roughness: 0.25, surface: 'curved hydrodynamic converter vane' })); rotor.add(blade);
      }
      addPart(ids[j], rotor, [-3.35 + j * 0.34, 0, 0], [-(2 - j) * 0.48, j === 2 ? -0.55 : 0, j === 2 ? 0.3 : 0], [0, radius + 0.23, j * 0.18], colors[j]); rotate(rotor, ids[j]);
    }
    group.add(annulus(1.115, 1.055, 0.85, material(0x626d78, { surface: 'sectioned converter steel cover' }), Math.PI * 0.8));
    for (const sign of [-1, 1]) { const end = annulus(1.12, 0.28, 0.07, material(C.steel), Math.PI * 0.8); end.position.x = sign * 0.44; group.add(end); }
    const hub = annulus(0.27, 0.16, 0.96, material(C.steel)); group.add(hub); rotate(group, 'pump');
    addPart('converter', group, [-3.2, 0, 0], [-0.65, 0, -0.35], [0, 1.35, -0.35], C.blue, false);
  }

  function buildPlanetary(hybrid) {
    housing();
    if (hybrid) {
      engine(-4.8, 0, 0, 5.4, 2.6, true, 0.125);
    } else {
      shiftClutches();
      engine(-4.6, 0, 0, 1.4, 0.55, false); converter();
      simpleShaft('input', -1.9, 0, 0, 1.3, C.amber, 'input', 0.15, [-0.4, 0, 0], false);
    }
    const sun = gear(30, 0.6, C.amber, 0.38, false, { helixDegrees: 20, boreRadius: hybrid ? 0.215 : 0.16 });
    if (hybrid) { const shaft = annulus(0.205, 0.145, 2.14, material(C.steel, { surface: 'MG1 hollow sun shaft around engine carrier shaft' })); shaft.position.x = -0.83; sun.add(shaft); }
    else { const shaft = cylinder(0.15, 1.84, material(C.steel)); shaft.position.x = -0.52; sun.add(shaft); }
    addPart('sun', sun, [0.2, 0, 0], [-0.9, 0, 0], [-0.15, 0.6, 0.45], C.amber); rotate(sun, 'sun');
    const ring = gear(78, 1.56, C.green, 0.43, true, { helixDegrees: -20 }), ringAssembly = new THREE.Group(); ringAssembly.add(ring);
    // The inspection cut remains in the assembly frame while the complete
    // tooth rim, relieved support web and hollow drive shaft rotate within it.
    const drum = annulus(1.76, 1.695, 1.14, material(0x5f6b77, { surface: 'sectioned planetary ring drum' }), Math.PI * 0.72); drum.position.x = 0.22; ringAssembly.add(drum);
    if (hybrid) {
      const web = spokedWeb(1.75, 0.205, 0.065); web.position.x = 0.79; ring.add(web);
      const shaft = annulus(0.215, 0.15, 2.46, material(C.steel, { surface: 'MG2 ring driven hollow output shaft' })); shaft.position.x = 2.02; ring.add(shaft);
    } else {
      const web = spokedWeb(1.75, 0.35, 0.065); web.position.x = 0.79; ring.add(web);
      const shaft = annulus(0.37, 0.3, 1.65, material(C.steel, { surface: 'AT hollow ring clutch shaft' })); shaft.position.x = 1.625; ring.add(shaft);
    }
    for (const sign of [-1, 1]) { const retaining = annulus(1.77, 1.61, 0.035, material(C.steel), Math.PI * 0.72); retaining.position.x = sign * 0.57 + 0.22; ringAssembly.add(retaining); }
    addPart('ring', ringAssembly, [0.2, 0, 0], [1.5, 0, 0], [0, 1.92, 0], C.green); rotate(ring, 'ring');
    const carrier = new THREE.Group();
    for (const x of [-0.36, 0.36]) {
      const plate = annulus(1.225, 0.94, 0.075, material(C.steel, { surface: 'planet carrier machined side plate' })); plate.position.x = x; carrier.add(plate);
      const hub = annulus(0.265, hybrid ? (x < 0 ? 0.22 : 0.13) : 0.17, 0.12, material(C.steel)); hub.position.x = x; carrier.add(hub);
      for (let i = 0; i < 3; i += 1) {
        const a = i * TAU / 3 + Math.PI / 6;
        carrier.add(rod(point(x, Math.cos(a) * 0.255, Math.sin(a) * 0.255), point(x, Math.cos(a) * 1.08, Math.sin(a) * 1.08), 0.09, material(C.blue)));
        if (x < 0) { const pin = cylinder(0.12, 0.85, material(C.steel)); pin.position.set(0, Math.cos(a) * 1.08, Math.sin(a) * 1.08); carrier.add(pin); }
        const cap = cylinder(0.155, 0.045, material(C.steel), 6); cap.position.set(x + Math.sign(x) * 0.07, Math.cos(a) * 1.08, Math.sin(a) * 1.08); carrier.add(cap);
      }
    }
    if (!hybrid) { const shaft = annulus(0.28, 0.19, 1.9, material(C.steel, { surface: 'AT hollow carrier clutch shaft' })); shaft.position.x = 1.41; carrier.add(shaft); }
    addPart('carrier', carrier, [0.2, 0, 0], [0.45, 0, 0], [0.3, -1.5, -0.55], C.blue); rotate(carrier, 'carrier');
    const planetOrbit = new THREE.Group();
    for (let i = 0; i < 3; i += 1) {
      const a = i * TAU / 3 + Math.PI / 6;
      const pg = gear(24, 0.48, C.purple, 0.3, false, { helixDegrees: -20, boreRadius: 0.125 }); pg.position.set(0, Math.cos(a) * 1.08, Math.sin(a) * 1.08); planetOrbit.add(pg); rotate(pg, 'planets');
    }
    addPart('planets', planetOrbit, [0.2, 0, 0], [0.45, 0.1, 0], [0.25, -1.25, 1.13], C.purple); rotate(planetOrbit, 'carrier');
    if (hybrid) {
      motor('mg1', -1.67, C.blue, 'mg1'); motor('mg2', 2.55, C.green, 'mg2');
      simpleShaft('output', 4.55, 0, 0, 2.2, C.green, 'output', 0.19, [1.25, 0, 0], true);
      const battery = new THREE.Group();
      const pack = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.48, 1.13), material(0x18384c, { metalness: 0.35 })); battery.add(pack);
      for (let i = 0; i < 6; i += 1) { const cell = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.05, 0.93), material(C.green)); cell.position.set(-0.77 + i * 0.31, 0.26, 0); battery.add(cell); }
      addPart('battery', battery, [0.7, 2.58, -1.55], [0.5, 0.6, -0.6], [0, 0.48, 0], C.green);
      const inverter = new THREE.Group(); const box = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.32, 0.85), material(C.dark)); inverter.add(box);
      for (let i = 0; i < 7; i += 1) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.72), material(C.steel)); fin.position.set(-0.45 + i * 0.15, 0.19, 0); inverter.add(fin); }
      addPart('inverter', inverter, [-1.8, 2.5, -1.6], [-0.4, 0.6, -0.6], [0, 0.43, 0], C.blue);
      route(['carrier'], [[-5.3, 0, 0], [-2.3, 0, 0], [0.2, 0.85, 0]], C.blue).power = s => s.enginePowerKW;
      route(['ring'], [[0.2, 0.85, 0], [0.2, 1.55, 0], [1.4, 0, 0], [5.45, 0, 0]], C.amber).power = s => s.enginePowerKW - s.mg1PowerKW;
      route(['mg1'], [[0.2, 0, 0], [-1.67, 0, 0]], C.blue).power = s => s.mg1PowerKW;
      route(['mg1'], [[-1.67, 0.7, 0], [-1.8, 2.5, -1.6]], C.green).power = s => s.mg1ElectricalPowerKW;
      route([], [[0.7, 2.6, -1.55], [-1.8, 2.5, -1.6]], C.green).power = s => s.batteryPowerKW;
      route(['mg2'], [[-1.8, 2.5, -1.6], [2.5, 1.7, -0.8], [2.55, 0.75, 0]], C.green).power = s => s.mg2ElectricalPowerKW;
      route(['mg2'], [[2.55, 0, 0], [5.45, 0, 0]], C.amber).power = s => s.mg2PowerKW;
    } else {
      for (const [id, x, radius, color] of [['brake-sun', -0.95, 0.72, C.red], ['brake-ring', 1.1, 1.82, C.red], ['brake-carrier', 1.95, 1.1, C.purple]]) {
        const brake = new THREE.Group(); brake.add(annulus(radius + 0.055, radius - 0.055, 0.19, material(0x696f78, { surface: 'stationary planetary brake band' }), Math.PI * 0.12));
        brake.add(torus(radius, 0.013, material(C.dark)));
        const mount = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.39, 0.34), material(C.dark)); mount.position.y = -radius; brake.add(mount);
        addPart(id, brake, [x, 0, 0], [x * 0.5, -0.7, 0], [0, -radius - 0.3, 0], color);
      }
      const lock = clutchPack(C.purple, 0.75, 5); addPart('lock-clutch', lock, [2.7, 0, 0], [1.4, 0.15, 0], [0, 1.05, 0], C.purple); rotate(lock, 'lock-clutch');
      simpleShaft('output', 4.18, 0, 0, 2.05, C.green, 'output', 0.2, [1.45, 0, 0], true);
      const atPaths = {
        '1': [[0.2, 0, 0], [0.2, 1.08, 0], [2.8, 0, 0]],
        '2': [[-1.4, 1.65, 0], [0.2, 1.65, 0], [0.2, 1.08, 0], [2.8, 0, 0]],
        '3': [[0.2, 0, 0], [2.8, 0, 0]],
        '4': [[-1.1, 1.08, 0], [0.2, 1.08, 0], [0.2, 1.65, 0], [2.8, 0, 0]],
        'R': [[0.2, 0, 0], [0.2, 1.08, 0], [0.2, 1.65, 0], [2.8, 0, 0]],
      };
      for (const [gearId, path] of Object.entries(atPaths)) {
        const r = route([], [[-5.4, 0, 0], [-3.3, 0, 0], path[0]], C.blue);
        r.condition = s => s.gear === gearId;
        route([], [...path, [5.3, 0, 0]], C.amber).condition = s => s.gear === gearId;
      }
    }
  }

  function motor(id, x, color, key) {
    const group = new THREE.Group(), rotor = new THREE.Group(), bore = id === 'mg1' ? 0.207 : 0.217;
    rotor.add(annulus(0.51, bore, 0.82, material(0x59636d, { surface: 'laminated motor rotor steel core' })));
    for (let i = 0; i < 13; i += 1) { const band = torus(0.513, 0.005, material(0x2d3339)); band.position.x = -0.37 + i * 0.062; rotor.add(band); }
    for (let i = 0; i < 10; i += 1) {
      const a = i * TAU / 10, magnet = new THREE.Mesh(new THREE.BoxGeometry(0.71, 0.048, 0.19), material(0x74797e, { physicalColor: true, metalness: 0.85, surface: 'motor permanent magnet' }));
      magnet.position.set(0, Math.cos(a) * 0.50, Math.sin(a) * 0.50); magnet.rotation.x = a; rotor.add(magnet);
    }
    for (const sign of [-1, 1]) { const face = annulus(0.52, bore, 0.045, material(C.steel)); face.position.x = sign * 0.44; rotor.add(face); }
    group.add(rotor);
    const core = annulus(1.0, 0.75, 0.91, material(0x4c545c, { surface: 'stationary laminated stator iron stack' }), Math.PI * 0.72); group.add(core);
    const copper = material(0xae713d, { physicalColor: true, metalness: 0.96, roughness: 0.27, bumpScale: 0.001, surface: 'stationary copper stator winding' });
    for (let i = 0; i < 24; i += 1) {
      const a = i * TAU / 24;
      // Remove the front stator sector as an actual cutaway, revealing the
      // separate rotor and stationary laminated teeth.
      if (Math.sin(a) > 0.5) continue;
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.086), material(0x626c75, { surface: 'stationary stator pole tooth' }));
      tooth.position.set(0, Math.cos(a) * 0.655, Math.sin(a) * 0.655); tooth.rotation.x = a; group.add(tooth);
      for (let turn = 0; turn < 4; turn += 1) {
        const rad = 0.68 + turn * 0.018, half = 0.061 + turn * 0.008;
        const xy = [[-0.49,-half*0.7],[-0.44,-half],[0.44,-half],[0.49,-half*0.7],[0.49,half*0.7],[0.44,half],[-0.44,half],[-0.49,half*0.7]];
        const wirePoints = xy.map(([axial,tangent]) => point(axial,Math.cos(a)*rad-Math.sin(a)*tangent,Math.sin(a)*rad+Math.cos(a)*tangent));
        const curve = new THREE.CatmullRomCurve3(wirePoints, true, 'centripetal'), winding = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.012, 5, true), copper); winding.castShadow = true; group.add(winding);
      }
    }
    for (const sign of [-1, 1]) {
      const face = annulus(1.02, 0.78, 0.055, material(C.steel, { surface: 'motor stator end support' }), Math.PI * 0.72); face.position.x = sign * 0.49; group.add(face);
      for (let j = 0; j < 12; j += 1) { const a = j * TAU / 12; if (Math.sin(a) > 0.5) continue; const bolt = cylinder(0.033, 0.12, material(C.steel), 6); bolt.position.set(sign * 0.54, Math.cos(a) * 0.91, Math.sin(a) * 0.91); group.add(bolt); }
    }
    addPart(id, group, [x, 0, 0], [x < 0 ? -0.7 : 0.9, 0.5, 0], [0, 1.25, -0.2], color); rotate(rotor, key);
  }

  function freezeMechanicalAnchors() {
    assembly.updateWorldMatrix(true, true);
    for (const p of parts.values()) {
      let representative = null, radius = -1;
      p.group.traverse(object => {
        if (!object.isMesh || !object.geometry?.attributes.position) return;
        object.geometry.computeBoundingSphere();
        if (object.geometry.boundingSphere.radius > radius) { radius = object.geometry.boundingSphere.radius; representative = object; }
      });
      if (representative) {
        const world = representative.localToWorld(representative.geometry.boundingSphere.center.clone());
        p.mechanicalAnchor.copy(p.group.parent.worldToLocal(world)).sub(p.base);
      }
    }
  }

  function instanceRepeatedDetails() {
    const resources = () => {
      const geometries = new Set(), materials = new Set();
      assembly.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); });
      return { geometries, materials };
    };
    const before = resources(), protectedMeshes = new Set([...rotors.map(r => r.object), ...beltSegments, ...preselectionMarkers.map(m => m.mesh)]);
    for (const p of parts.values()) p.group.traverse(o => { for (const layer of o.userData.stackLayers || []) protectedMeshes.add(layer.mesh); if (o.userData.drivenHub) protectedMeshes.add(o.userData.drivenHub); });
    for (const p of pulleyParts || []) { for (const sheave of p.sheaves) protectedMeshes.add(sheave); protectedMeshes.add(p.contactRing); }
    const geometryKeys = new WeakMap();
    const signature = geometry => {
      if (geometryKeys.has(geometry)) return geometryKeys.get(geometry);
      let hash = 2166136261, count = 0;
      const buffers = [...Object.keys(geometry.attributes).sort().map(key => geometry.attributes[key].array), ...(geometry.index ? [geometry.index.array] : [])];
      for (const buffer of buffers) { const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength); count += bytes.length; for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619); }
      const key = `${count}:${hash >>> 0}:${JSON.stringify(geometry.groups)}:${geometry.drawRange.start}:${geometry.drawRange.count}`; geometryKeys.set(geometry, key); return key;
    };
    const sameGeometry = (a, b) => {
      const keys = Object.keys(a.attributes).sort(); if (keys.join('/') !== Object.keys(b.attributes).sort().join('/')) return false;
      for (const key of keys) { const x = a.attributes[key], y = b.attributes[key]; if (x.itemSize !== y.itemSize || x.normalized !== y.normalized || x.array.length !== y.array.length) return false; for (let i = 0; i < x.array.length; i += 1) if (x.array[i] !== y.array[i]) return false; }
      if (Boolean(a.index) !== Boolean(b.index)) return false;
      if (a.index) { if (a.index.count !== b.index.count) return false; for (let i = 0; i < a.index.count; i += 1) if (a.index.array[i] !== b.index.array[i]) return false; }
      return true;
    };
    const materialKey = mat => JSON.stringify([mat.type, mat.color?.getHex(), mat.emissive?.getHex(), mat.emissiveIntensity, mat.metalness, mat.roughness, mat.transparent, mat.opacity, mat.side, mat.depthWrite, mat.depthTest, mat.blending, mat.vertexColors, mat.flatShading, mat.bumpMap?.uuid, mat.bumpScale, mat.map?.uuid, mat.normalMap?.uuid, mat.normalScale?.toArray(), mat.userData.surface]);
    let originalMeshes = 0, instancedMeshes = 0, instancedCopies = 0;
    assembly.traverse(o => { if (o.isMesh) originalMeshes += 1; });
    for (const p of parts.values()) {
      if (p.id === 'housing') continue; // Housing visibility and cut-window buffers are independently mutable.
      const nodes = [], sharedMaterials = new Map(); p.group.traverse(o => nodes.push(o));
      for (const parent of nodes.reverse()) {
        const bins = new Map();
        for (const mesh of [...parent.children]) {
          if (!mesh.isMesh || mesh.isInstancedMesh || mesh.children.length || protectedMeshes.has(mesh) || Array.isArray(mesh.material) || mesh.visible === false) continue;
          if (Object.keys(mesh.userData).some(k => !['partId', 'category'].includes(k))) continue;
          const key = `${signature(mesh.geometry)}:${materialKey(mesh.material)}:${mesh.castShadow}:${mesh.receiveShadow}:${mesh.renderOrder}:${mesh.layers.mask}`;
          const candidates = bins.get(key) || [], bin = candidates.find(b => sameGeometry(b[0].geometry, mesh.geometry));
          if (bin) bin.push(mesh); else candidates.push([mesh]); bins.set(key, candidates);
        }
        for (const binsWithKey of bins.values()) for (const meshes of binsWithKey) {
          if (meshes.length < 3) continue;
          const first = meshes[0], instance = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
          instance.castShadow = first.castShadow; instance.receiveShadow = first.receiveShadow; instance.renderOrder = first.renderOrder; instance.layers.mask = first.layers.mask;
          instance.userData = { ...first.userData, repeatedDetailCount: meshes.length };
          meshes.forEach((mesh, index) => { mesh.updateMatrix(); instance.setMatrixAt(index, mesh.matrix); parent.remove(mesh); });
          instance.instanceMatrix.needsUpdate = true; instance.computeBoundingBox(); instance.computeBoundingSphere(); parent.add(instance); instancedMeshes += 1; instancedCopies += meshes.length;
        }
      }
      p.materials = [];
      p.group.traverse(o => {
        if (!o.isMesh) return;
        if (!Array.isArray(o.material)) { const key = materialKey(o.material); if (sharedMaterials.has(key)) o.material = sharedMaterials.get(key); else sharedMaterials.set(key, o.material); }
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) if (mat.isMeshStandardMaterial && !p.materials.includes(mat)) {
          mat.userData.baseColor ||= mat.color.clone(); mat.userData.baseEmissive ||= mat.emissive.clone(); p.materials.push(mat);
        }
      });
    }
    selectable = []; ownedMaterials.clear();
    for (const p of parts.values()) p.group.traverse(o => { if (o.isMesh) { o.userData.partId = p.id; o.userData.category = p.category; selectable.push(o); } });
    const after = resources(); for (const geometry of before.geometries) if (!after.geometries.has(geometry)) geometry.dispose(); for (const mat of before.materials) if (!after.materials.has(mat)) mat.dispose();
    for (const mat of after.materials) if (mat.isMeshStandardMaterial) ownedMaterials.add(mat);
    batchStats = { originalMeshes, instancedMeshes, instancedCopies };
  }

  function configureQuality() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, { high: 1.7, balanced: 1.25, low: 1 }[effectiveQuality]));
    renderer.shadowMap.enabled = effectiveQuality !== 'low';
    const size = effectiveQuality === 'high' ? 1536 : 1024;
    if (keyLight.shadow.mapSize.x !== size) { keyLight.shadow.map?.dispose(); keyLight.shadow.map = null; keyLight.shadow.mapSize.set(size, size); keyLight.shadow.needsUpdate = true; }
  }

  function rebuildQuality(next) {
    if (effectiveQuality === next) return;
    const selection = selected, angles = rotors.map(r => r.object.rotation[r.axis]);
    effectiveQuality = next; configureQuality(); setType(type, true); selected = selection;
    rotors.forEach((r, i) => { if (Number.isFinite(angles[i])) r.object.rotation[r.axis] = angles[i]; });
    lastFrameWall = 0;
  }
  function disposeAssembly() {
    const geometries = new Set(), materials = new Set();
    assembly.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) materials.add(m); });
    for (const g of geometries) g.dispose(); for (const m of materials) m.dispose();
    assembly.clear(); leaderLayer.replaceChildren(); labelsLayer.replaceChildren(leaderLayer); parts = new Map(); rotors = []; selectable = []; flowRoutes = []; particleMeshes = []; beltSegments = []; pulleyParts = null; preselectionMarkers = []; selectorForks = []; gearboxHousing = null; ownedMaterials.clear(); beltTravel = 0;
  }

  function setType(nextType, preserveCamera = false) {
    renderInvalidated = true;
    type = ['mt', 'dct', 'cvt', 'at', 'ecvt'].includes(nextType) ? nextType : 'mt'; disposeAssembly(); selected = null; if (!preserveCamera) { lastFitExplode = -1; lastCategories = ''; }
    if (type === 'mt' || type === 'dct') buildParallel(type === 'dct');
    else if (type === 'cvt') buildCVT();
    else buildPlanetary(type === 'ecvt');
    serviceParts(type);
    freezeMechanicalAnchors(); instanceRepeatedDetails();
    if (!preserveCamera) resetCamera();
  }

  function choosePart(id) {
    const describedId = id === 'input' ? (type === 'at' ? 'turbine' : 'engine') : id;
    selected = parts.has(describedId) ? describedId : null; renderInvalidated = true; onSelectPart(selected);
  }
  function selectPart(id) { selected = parts.has(id) ? id : null; renderInvalidated = true; }

  function resize() {
    renderInvalidated = true;
    const rect = container.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    if (assembly.children.length) fitCamera();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);

  function fitCamera() {
    assembly.updateWorldMatrix(true, true); controls.update();
    const boxes = [...parts.values()].filter(p => p.group.visible).map(p => new THREE.Box3().setFromObject(p.group)).filter(box => !box.isEmpty());
    if (!boxes.length) return;
    const direction = camera.position.clone().sub(controls.target).normalize();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    let distance = 8;
    for (const box of boxes) for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const relative = point(x, y, z).sub(controls.target);
      const depth = relative.dot(direction);
      distance = Math.max(distance, depth + Math.abs(relative.dot(right)) / (tangent * camera.aspect * 0.89), depth + Math.abs(relative.dot(up)) / (tangent * 0.83));
    }
    camera.position.copy(direction).multiplyScalar(Math.min(38, distance)).add(controls.target); controls.update();
  }

  function setCamera(preset = 'isometric') {
    const center = type === 'mt' || type === 'dct' ? point(0, -0.35, 0) : point(0, 0.25, 0);
    const aspect = width / height;
    const distance = aspect < 1.1 ? 19 : aspect > 2 ? 12.6 : 15.5;
    const positions = { isometric: point(0.57, 0.38, 0.79), front: point(0.04, 0.02, 1), top: point(0.01, 1, 0.08) };
    camera.position.copy(positions[preset] || positions.isometric).normalize().multiplyScalar(distance).add(center);
    controls.target.copy(center); controls.update(); fitCamera();
  }
  function resetCamera() { setCamera('isometric'); }

  function updateBelt(snapshot, dt, speed, explode) {
    if (!pulleyParts) return;
    const primary = clamp(snapshot.primaryRadius * 14, 0.44, 1.4), secondary = clamp(snapshot.secondaryRadius * 14, 0.44, 1.4);
    const c1 = -1.68 - explode * 0.55, c2 = 1.68 + explode * 0.55;
    const distance = c2 - c1;
    // The belt plane is local y-z. Here the planar 2D x coordinate is z, y is y.
    const a1 = Math.acos(clamp((primary - secondary) / distance, -0.8, 0.8));
    const points = [];
    const add2 = (z, y) => points.push(point(0, y, z));
    const upper1 = [c1 + primary * Math.cos(a1), primary * Math.sin(a1)];
    const upper2 = [c2 + secondary * Math.cos(a1), secondary * Math.sin(a1)];
    const lower1 = [upper1[0], -upper1[1]], lower2 = [upper2[0], -upper2[1]];
    const lines = 40, arcs = 34;
    for (let i = 0; i < lines; i += 1) { const t = i / lines; add2(upper1[0] + (upper2[0] - upper1[0]) * t, upper1[1] + (upper2[1] - upper1[1]) * t); }
    for (let i = 0; i < arcs; i += 1) { const a = a1 - i / arcs * 2 * a1; add2(c2 + secondary * Math.cos(a), secondary * Math.sin(a)); }
    for (let i = 0; i < lines; i += 1) { const t = i / lines; add2(lower2[0] + (lower1[0] - lower2[0]) * t, lower2[1] + (lower1[1] - lower2[1]) * t); }
    for (let i = 0; i < arcs; i += 1) { const a = -a1 - i / arcs * (TAU - 2 * a1); add2(c1 + primary * Math.cos(a), primary * Math.sin(a)); }
    // Arc-length interpolation keeps blocks evenly spaced along straight spans and pulley wraps.
    const cumulative = [0];
    for (let i = 1; i <= points.length; i += 1) cumulative.push(cumulative[i - 1] + points[(i) % points.length].distanceTo(points[i - 1]));
    const length = cumulative[cumulative.length - 1]; beltTravel = (beltTravel + (snapshot.beltSpeed || 0) * 14 * dt * speed / length) % 1;
    const at = fraction => {
      const d = ((fraction % 1 + 1) % 1) * length; let low = 0, high = points.length;
      while (low + 1 < high) { const mid = (low + high) >> 1; if (cumulative[mid] <= d) low = mid; else high = mid; }
      const fractionSegment = (d - cumulative[low]) / (cumulative[low + 1] - cumulative[low]); return points[low].clone().lerp(points[(low + 1) % points.length], fractionSegment);
    };
    beltSegments.forEach((segment, i) => {
      const t = i / beltSegments.length + beltTravel, p = at(t), tangent = at(t + 0.001).sub(at(t - 0.001)).normalize();
      segment.position.copy(p); segment.rotation.x = -Math.atan2(tangent.y, tangent.z);
    });
    for (let i = 0; i < pulleyParts.length; i += 1) {
      const radius = i ? secondary : primary;
      // Opposing cone surfaces contact the ±.125 belt edges at the exact
      // running radius. Closing the sheaves increases that radius.
      const gap = 0.175 - 0.07 * (radius - 0.23);
      pulleyParts[i].sheaves[0].position.x = -gap; pulleyParts[i].sheaves[1].position.x = gap;
      pulleyParts[i].contactRing.scale.set(radius, radius, 1);
      pulleyParts[i].contactRing.position.x = -0.145;
      const piston = parts.get('pulley-pistons')?.group.children[i]; if (piston) piston.position.z = -0.85 + 0.125 - gap;
    }
  }

  function layoutLabels(candidates) {
    leaderLayer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const occupied = [], visible = [], suppressed = [], rect = container.getBoundingClientRect();
    const blocked = [...(container.parentElement?.querySelectorAll('.scene-toolbar, .scene-overlay, .scene-bottom, .scene-quick-controls, .scene-quick-tools, .scene-heading') || [])].map(e => e.getBoundingClientRect()).filter(r => r.width && r.height && r.bottom > rect.top && r.top < rect.bottom).map(r => ({ left: r.left - rect.left - 4, right: r.right - rect.left + 4, top: r.top - rect.top - 3, bottom: r.bottom - rect.top + 3 }));
    const intersects = (a, b, padding = 0) => a.left < b.right + padding && a.right > b.left - padding && a.top < b.bottom + padding && a.bottom > b.top - padding;
    candidates.sort((a, b) => a.priority - b.priority || a.p.order - b.p.order);
    for (const { p, x: originalX, y: originalY, anchorX, anchorY, priority } of candidates) {
      const labelWidth = Math.min(p.labelWidth, Math.max(16, width - 16)), labelHeight = p.labelHeight;
      const xMin = 8 + labelWidth / 2, xMax = width - xMin, yMin = 8 + labelHeight / 2, yMax = height - yMin;
      if (xMax < xMin || yMax < yMin) { suppressed.push(p.id); continue; }
      const x = clamp(originalX, xMin, xMax), y = clamp(originalY, yMin, yMax), slots = [];
      for (let step = 0; step <= Math.ceil(height / 30); step += 1) for (const direction of step ? [1, -1] : [1]) {
        const dy = step * 30 * direction;
        for (const trialX of [x, x - labelWidth - 12, x + labelWidth + 12, xMin, xMax]) slots.push({ x: clamp(trialX, xMin, xMax), y: clamp(y + dy, yMin, yMax) });
      }
      slots.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
      let chosen = null;
      for (const slot of slots) {
        const box = { left: slot.x - labelWidth / 2, right: slot.x + labelWidth / 2, top: slot.y - labelHeight / 2, bottom: slot.y + labelHeight / 2 };
        if (occupied.some(other => intersects(box, other, 7)) || blocked.some(other => intersects(box, other))) continue;
        chosen = { ...slot, ...box }; break;
      }
      // The selected component receives the first slot. On a very small panel,
      // preserve its name even when fixed UI overlays occupy the whole margin.
      if (!chosen && priority === 0) chosen = { x, y, left: x - labelWidth / 2, right: x + labelWidth / 2, top: y - labelHeight / 2, bottom: y + labelHeight / 2 };
      if (!chosen) { suppressed.push(p.id); continue; }
      occupied.push(chosen);
      p.labelElement.style.display = 'block'; p.labelElement.style.left = `${chosen.x}px`; p.labelElement.style.top = `${chosen.y}px`; p.labelElement.style.maxWidth = `${width - 16}px`; p.labelElement.style.overflow = 'hidden'; p.labelElement.style.textOverflow = 'ellipsis';
      const target = { x: Number.isFinite(anchorX) ? anchorX : chosen.x, y: Number.isFinite(anchorY) ? anchorY : chosen.y };
      const endpoint = { x: clamp(target.x, chosen.left, chosen.right), y: clamp(target.y, chosen.top, chosen.bottom) };
      // Move the endpoint to the nearest rectangle edge when the anchor lies
      // inside the text box, so no leader line runs through the lettering.
      if (target.x >= chosen.left && target.x <= chosen.right && target.y >= chosen.top && target.y <= chosen.bottom) endpoint.y = target.y < chosen.y ? chosen.top : chosen.bottom;
      const path = `M ${target.x} ${target.y} L ${endpoint.x} ${endpoint.y}`;
      p.leaderShadow.setAttribute('d', path); p.leaderShadow.style.display = 'block'; p.leader.setAttribute('d', path); p.leader.setAttribute('stroke', priority === 0 ? '#c1eeff' : '#9ab3c5'); p.leader.setAttribute('opacity', priority === 0 ? '.95' : '.8'); p.leader.style.display = 'block';
      visible.push({ id: p.id, ...chosen, width: labelWidth, height: labelHeight, anchorX: target.x, anchorY: target.y, lineEndX: endpoint.x, lineEndY: endpoint.y, selected: priority === 0 });
    }
    let overlaps = 0; for (let i = 0; i < occupied.length; i += 1) for (let j = i + 1; j < occupied.length; j += 1) if (intersects(occupied[i], occupied[j])) overlaps += 1;
    labelLayout = { visible, suppressed, overlaps };
  }

  function capture({ annotations = true } = {}) {
    if (contextLost) throw new Error('3D 화면을 다시 연결한 뒤 저장해 주세요.');
    renderInvalidated = true;
    if (currentSnapshot && lastUpdateView) update(currentSnapshot, lastUpdateView, 0);
    else { controls.update(); renderer.render(scene, camera); renderFrames += 1; }
    if (!annotations || !labelLayout.visible.length) return renderer.domElement.toDataURL('image/png');
    const canvas = document.createElement('canvas'); canvas.width = renderer.domElement.width; canvas.height = renderer.domElement.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(renderer.domElement, 0, 0); ctx.scale(canvas.width / width, canvas.height / height);
    for (const label of labelLayout.visible) {
      ctx.beginPath(); ctx.moveTo(label.anchorX, label.anchorY); ctx.lineTo(label.lineEndX, label.lineEndY); ctx.strokeStyle = '#07121db8'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = label.selected ? '#c1eefff2' : '#9ab3c5cc'; ctx.lineWidth = 1; ctx.stroke();
    }
    for (const label of labelLayout.visible) {
      const p = parts.get(label.id), style = getComputedStyle(p.labelElement); ctx.fillStyle = style.backgroundColor; ctx.strokeStyle = style.borderColor; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(label.left, label.top, label.width, label.height, 5); ctx.fill(); ctx.stroke(); ctx.font = style.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = style.color;
      ctx.save(); ctx.beginPath(); ctx.rect(label.left + 4, label.top, label.width - 8, label.height); ctx.clip(); ctx.fillText(p.labelElement.textContent, label.x, label.y); ctx.restore();
    }
    return canvas.toDataURL('image/png');
  }

  function update(snapshot, view = {}, dtSeconds = 0) {
    const now = performance.now(), nextRequested = qualityName(view.quality);
    if (nextRequested !== requestedQuality) {
      requestedQuality = nextRequested; autoAdapted = false; qualitySamples = 0; frameMs = 0; qualityStarted = now;
      rebuildQuality(requestedQuality === 'auto' ? 'balanced' : requestedQuality);
    }
    if (dtSeconds > 0 && lastFrameWall && !document.hidden && !contextLost) {
      const elapsed = now - lastFrameWall;
      if (elapsed > 0 && elapsed < 2000) { frameMs = frameMs ? frameMs * 0.92 + elapsed * 0.08 : elapsed; qualitySamples += 1; }
      if (requestedQuality === 'auto' && !autoAdapted && effectiveQuality === 'balanced' && qualitySamples >= 45 && now - qualityStarted > 6000 && frameMs > 38) { autoAdapted = true; rebuildQuality('low'); }
    }
    lastFrameWall = now;
    currentSnapshot = snapshot;
    lastUpdateView = view;
    const viewKey = JSON.stringify(view), cameraChanged = controls.update();
    if (contextLost) return;
    if (dtSeconds <= 0 && !renderInvalidated && !cameraChanged && snapshot === lastRenderedSnapshot && viewKey === lastRenderedViewKey) { skippedIdleFrames += 1; return; }
    const dt = clamp(dtSeconds, 0, 1), speed = clamp(view.speed ?? 0.015, 0, 0.12), explode = clamp(view.explode ?? 0.06, 0, 1), housingAmount = clamp(view.housing ?? 1, 0, 1);
    for (const [id, p] of parts) { p.group.position.copy(p.base).addScaledVector(p.explode, explode); if (id !== 'housing') p.group.visible = view[p.category] !== false; }
    gearboxHousing?.update(view);
    const categories = [...['bearings', 'clutches', 'lubrication'].map(c => view[c] !== false), gearboxHousing?.group.visible ?? false, view.housingMode || 'cutaway'].join('/');
    if (Math.abs(explode - lastFitExplode) > 0.0005 || categories !== lastCategories) { fitCamera(); lastFitExplode = explode; lastCategories = categories; }
    const active = new Set(snapshot.activeParts || []), preselected = new Set(snapshot.preselectedParts || []); if (view.selectedPart !== undefined) selected = view.selectedPart;
    for (const marker of preselectionMarkers) marker.mesh.visible = preselected.has(marker.id) && !active.has(marker.id);
    for (const fork of selectorForks) {
      const selectedGears = fork.dual ? [snapshot.selectedA, snapshot.selectedB] : [snapshot.gear];
      const selectedIndex = fork.gears.findIndex(gearId => selectedGears.includes(gearId));
      const offset = selectedIndex < 0 ? 0 : fork.dual ? fork.direction * 0.10 : selectedIndex === 0 ? -0.14 : 0.14;
      fork.group.position.x = THREE.MathUtils.lerp(fork.group.position.x, fork.base + offset, dt > 0 ? 1 - Math.exp(-dt * 16) : 1);
    }
    for (const rotor of rotors) {
      let rpm = snapshot.partRpm?.[rotor.rpmKey || rotor.key];
      if (!Number.isFinite(rpm)) rpm = rotor.key === 'engine' || rotor.key === 'input' ? snapshot.inputRpm : rotor.key === 'output' ? snapshot.outputRpm : 0;
      if (rotor.subtract) rpm -= snapshot.partRpm?.[rotor.subtract] || 0;
      rotor.object.rotation[rotor.axis] = (rotor.object.rotation[rotor.axis] + rpm * TAU / 60 * dt * speed * rotor.multiplier) % TAU;
    }
    const projected = new THREE.Vector3();
    const labelCandidates = [];
    for (const [id, p] of parts) {
      p.group.position.copy(p.base).addScaledVector(p.explode, explode);
      const isActive = active.has(id), isSelected = selected === id, isPreselected = preselected.has(id) && !isActive;
      if (id !== 'housing') {
        for (const mat of p.materials) {
          mat.color.copy(mat.userData.baseColor);
          if (!isActive && snapshot.gear !== 'N' && p.category === 'gears') mat.color.lerp(new THREE.Color(0x656c72), 0.1);
          mat.emissive.setHex(isSelected ? 0xd4ebf0 : isActive ? 0xa9b9c1 : isPreselected ? C.purple : 0x000000);
          mat.emissiveIntensity = mat.userData.surface === 'oil volume' ? 0 : isSelected ? 0.045 : isActive ? 0.015 : isPreselected ? 0.012 : 0;
        }
      }
      p.labelElement.style.borderColor = isSelected ? '#c1eeff' : isActive ? `#${new THREE.Color(p.color).getHexString()}77` : 'rgba(102,147,179,.28)';
      p.labelElement.style.color = isSelected ? '#eefaff' : isActive ? '#e0eff8' : '#94aabb';
      const labelText = `${NAMES[id] || id}${isPreselected && id.startsWith('gear-') ? ' · 대기' : ''}`;
      if (p.labelElement.textContent !== labelText) { p.labelElement.textContent = labelText; p.labelElement.style.display = 'block'; p.labelWidth = p.labelElement.getBoundingClientRect().width; }
      p.labelElement.style.display = 'none';
      p.leader.style.display = 'none';
      p.leaderShadow.style.display = 'none';
      const focus = view.focusCategory || 'all';
      const exterior = ['housing', 'engine', 'input', 'output', 'cooler', 'inverter', 'battery'].includes(id);
      const closedOpaque = view.housingMode === 'closed' && housingAmount > 0.8;
      if (id === 'oil-lines') for (const object of p.group.children) if (object.isMesh && !flowRoutes.some(r => r.line === object)) object.visible = !closedOpaque;
      const showAnnotation = isSelected || ((!closedOpaque || exterior) && (focus === 'all' ? p.label : p.category === focus));
      if (view.labels !== false && showAnnotation && p.group.visible) {
        // Anchors live in the fixed assembly frame. The component's own spin
        // affects its mesh, never the position of its anatomy annotation.
        p.group.parent.updateWorldMatrix(true, false); projected.copy(p.anchor).add(p.group.position).applyMatrix4(p.group.parent.matrixWorld).project(camera);
        const onScreen = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 0.97 && Math.abs(projected.y) < 0.92;
        if (onScreen || isSelected) {
          const x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2;
          const anchor = p.mechanicalAnchor.clone().add(p.group.position).applyMatrix4(p.group.parent.matrixWorld).project(camera);
          labelCandidates.push({ p, x: Number.isFinite(x) ? x : width / 2, y: Number.isFinite(y) ? y : height / 2, anchorX: (anchor.x + 1) * width / 2, anchorY: (1 - anchor.y) * height / 2, priority: isSelected ? 0 : isActive ? 1 : 2 });
        }
      }
    }
    layoutLabels(labelCandidates);
    updateBelt(snapshot, dt, speed, explode);
    const releaseFraction = clamp(snapshot.releaseBearing?.releaseFraction ?? 0, 0, 1);
    if (type === 'mt') {
      const release = parts.get('release-bearing'), pressure = parts.get('pressure-plate'), fork = parts.get('release-fork');
      if (release) release.group.position.x -= releaseFraction * 0.15;
      if (pressure) pressure.group.position.x += releaseFraction * 0.045;
      if (fork) fork.group.rotation.z = releaseFraction * 0.14;
    }
    for (const id of ['clutch-a', 'clutch-b', 'forward-clutch', 'reverse-clutch', 'shift-clutches', 'lock-clutch']) {
      const p = parts.get(id); if (!p) continue;
      const engagement = id === 'clutch-a' ? snapshot.clutchA : id === 'clutch-b' ? snapshot.clutchB : id === 'forward-clutch' ? (snapshot.gear === 'D' ? 1 : 0) : id === 'reverse-clutch' ? (snapshot.gear === 'R' ? 1 : 0) : id === 'lock-clutch' ? (snapshot.gear === '3' ? 1 : 0) : snapshot.gear === 'N' ? 0 : 1;
      p.group.traverse(o => { for (const layer of o.userData.stackLayers || []) layer.mesh.position.x = layer.index * (0.08 - clamp(engagement, 0, 1) * 0.023); });
    }
    const selectedGroup = parts.get(selected)?.group;
    selectionOutline.visible = Boolean(selectedGroup?.visible); if (selectionOutline.visible) { selectionOutline.box.setFromObject(selectedGroup); selectionOutline.updateMatrixWorld(true); }
    for (const r of flowRoutes) {
      const routePower = r.oil ? 1 : r.power ? r.power(snapshot) : snapshot.outputPowerKW;
      const oilRunning = type === 'mt' ? Math.max(Math.abs(snapshot.partRpm?.['input-shaft'] || 0), Math.abs(snapshot.partRpm?.['output-shaft'] || 0)) > 1 : type === 'ecvt' ? Math.max(Math.abs(snapshot.sunRpm || 0), Math.abs(snapshot.ringRpm || 0), Math.abs(snapshot.carrierRpm || 0)) > 1 : Math.abs(snapshot.inputRpm || 0) > 1;
      const enabled = explode < 0.4 && (r.oil ? !(view.housingMode === 'closed' && housingAmount > 0.8) && view.lubrication !== false && view.oilFlow !== false && oilRunning : view.flow !== false && (!r.condition || r.condition(snapshot)) && r.ids.every(id => active.has(id)) && Number.isFinite(routePower) && Math.abs(routePower) > 0.01);
      r.line.visible = enabled;
      r.progress = (r.progress + dt * (0.24 + Math.abs(snapshot.inputRpm || 0) / 5500) * 0.6 * Math.sign(routePower || 1) + 1) % 1;
      r.beads.forEach((bead, i) => { bead.visible = enabled; if (enabled) bead.position.copy(r.curve.getPointAt((r.progress + i / r.beads.length) % 1)); });
    }
    const renderStarted = performance.now(); renderer.render(scene, camera); lastRenderMs = performance.now() - renderStarted; renderFrames += 1;
    renderInvalidated = false; lastRenderedSnapshot = snapshot; lastRenderedViewKey = viewKey;
  }

  function pointerDown(event) { pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }; }
  function pointerUp(event) {
    if (!pointerStart || pointerStart.id !== event.pointerId || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6) { pointerStart = null; return; }
    pointerStart = null; const rect = renderer.domElement.getBoundingClientRect();
    mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); pickRay.setFromCamera(mouse, camera);
    const visible = object => { for (let o = object; o; o = o.parent) if (!o.visible) return false; return true; };
    const hits = pickRay.intersectObjects(selectable.filter(visible), false);
    const hit = currentSnapshot && gearboxHousing?.group.userData.housingMode === 'closed' && (gearboxHousing.diagnostics().opacity > 0.8)
      ? hits[0] : hits.find(h => h.object.userData.partId !== 'housing');
    lastPick = { meshPartId: hit?.object.userData.partId || null, intersections: hits.length, x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (hit) choosePart(hit.object.userData.partId);
  }
  renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pointerUp);
  const graphicsMessage = document.createElement('div'); graphicsMessage.className = 'scene-graphics-recovery';
  Object.assign(graphicsMessage.style, { position: 'absolute', inset: '0', zIndex: '10', display: 'none', placeContent: 'center', padding: '24px', textAlign: 'center', background: '#0d1b25ed', color: '#c5d9e8', font: '12px system-ui', lineHeight: '1.8' });
  graphicsMessage.innerHTML = '<p>3D 화면을 다시 연결하는 중입니다.<br>실험 조건과 프로젝트는 유지됩니다.</p><button type="button" style="margin-top:14px;padding:9px 14px;border:1px solid #579b9b;border-radius:5px;background:#264d51;color:#d4f3ed">화면 다시 연결</button>'; container.appendChild(graphicsMessage);
  graphicsMessage.querySelector('button').onclick = () => { if (graphicsControl && renderer.getContext().isContextLost()) graphicsControl.restoreContext(); else window.location.reload(); };
  const onContextLost = event => { event.preventDefault(); contextLost = true; renderInvalidated = true; graphicsMessage.style.display = 'grid'; };
  const onContextRestored = () => {
    // Render-target environment textures have no CPU pixels to upload after a
    // GPU interruption. Recreate the studio reflection instead of showing black steel.
    const generator = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(), replacement = generator.fromScene(room, 0.035);
    environmentTarget.dispose(); environmentTarget = replacement; scene.environment = replacement.texture; room.dispose(); generator.dispose();
    contextLost = false; renderInvalidated = true; graphicsMessage.style.display = 'none'; lastFrameWall = 0;
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost); renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);
  configureQuality(); resize(); setType('mt');

  return {
    setType, update, selectPart, resetCamera, setCamera,
    capture,
    getDiagnostics() {
      let meshCount = 0; assembly.traverse(o => { if (o.isMesh) meshCount += 1; });
      const entries = [...parts.values()];
      const gears = []; for (const p of entries) p.group.traverse(o => { if (o.userData.gear) gears.push({ partId: p.id, ...o.userData.gear }); });
      return { type, partIds: [...parts.keys()], parts: entries.map(p => ({ id: p.id, category: p.category, visible: p.group.visible })),
        gears, housing: gearboxHousing?.diagnostics() || null, lastPick,
        labelPositions: entries.filter(p => p.labelElement.style.display !== 'none').map(p => ({ id: p.id, x: Number.parseFloat(p.labelElement.style.left), y: Number.parseFloat(p.labelElement.style.top) })),
        materialProperties: entries.map(p => ({ id: p.id, category: p.category, surfaces: [...new Set(p.materials.map(m => m.userData.surface))], materials: [...new Set(p.materials)].slice(0, 4).map(m => ({ surface: m.userData.surface, color: `#${m.color.getHexString()}`, metalness: m.metalness, roughness: m.roughness, bumpScale: m.bumpScale, emissiveIntensity: m.emissiveIntensity })) })),
        oilPaths: flowRoutes.filter(r => r.oil).map(r => ({ visible: r.line.visible, animatedDrops: r.beads.filter(b => b.visible).length, color: `#${r.line.material.color.getHexString()}`, phase: r.progress, firstDrop: r.beads[0]?.position.toArray() })),
        requestedQuality, effectiveQuality, performance: { frameMs, renderMs: lastRenderMs, renderFrames, skippedIdleFrames, triangles: renderer.info.render.triangles, drawCalls: renderer.info.render.calls, geometries: renderer.info.memory.geometries, visibleLabels: labelLayout.visible.length, suppressedLabels: labelLayout.suppressed.length, labelOverlaps: labelLayout.overlaps, ...batchStats },
        annotations: labelLayout.visible.map(label => ({ ...label })), suppressedLabels: [...labelLayout.suppressed], contextLost,
        meshCount, visibleLabels: entries.filter(p => p.labelElement.style.display !== 'none').length, rotors: rotors.length, rotorAngles: rotors.map(r => ({ key: r.key, axis: r.axis, angle: r.object.rotation[r.axis] })), cameraDistance: camera.position.distanceTo(controls.target), beltSegments: beltSegments.length, beltPhase: beltTravel, beltSamplePositions: beltSegments.filter((_,i)=>i===0||i===71).map(o=>o.position.toArray()), width, height, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, snapshotType: currentSnapshot?.type || null, renderer: renderer.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL' };
    },
    dispose() {
      observer.disconnect(); controls.removeEventListener('change', invalidateRender); controls.dispose(); renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost); renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      disposeAssembly(); floor.geometry.dispose(); floor.material.dispose(); grid.geometry.dispose(); grid.material.dispose(); selectionOutline.geometry.dispose(); selectionOutline.material.dispose(); environmentTarget.dispose(); renderer.dispose(); labelsLayer.remove(); graphicsMessage.remove(); renderer.domElement.remove();
    },
  };
}
