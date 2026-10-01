import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
const unitX = new THREE.Vector3(1, 0, 0);
let castTexture;
const primitiveGeometries = new WeakMap();

function sharedGeometry(material, key, create) {
  let geometries = primitiveGeometries.get(material);
  if (!geometries) { geometries = new Map(); primitiveGeometries.set(material, geometries); }
  if (!geometries.has(key)) geometries.set(key, create());
  return geometries.get(key);
}

function castingTexture() {
  if (castTexture) return castTexture;
  const size = 128, bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const grain = Math.sin(x * 43.17 + y * 17.83) * Math.sin(x * 9.17 - y * 31.43);
    const value = Math.round(125 + grain * 42 + Math.sin(x * 0.77 + y * 1.13) * 12);
    const index = (y * size + x) * 4;
    bytes[index] = bytes[index + 1] = bytes[index + 2] = value; bytes[index + 3] = 255;
  }
  castTexture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  castTexture.wrapS = castTexture.wrapT = THREE.RepeatWrapping;
  castTexture.magFilter = THREE.LinearFilter; castTexture.minFilter = THREE.LinearMipmapLinearFilter;
  castTexture.generateMipmaps = true; castTexture.needsUpdate = true;
  return castTexture;
}

function finish(color, metalness, roughness, surface, bumpScale = 0) {
  const material = new THREE.MeshStandardMaterial({ color, metalness, roughness,
    bumpMap: bumpScale ? castingTexture() : null, bumpScale });
  material.userData.surface = surface;
  return material;
}

function section(profile, angle, inward = 0) {
  // Softly squared and slightly lobed sections reproduce a cast envelope around
  // the shafts, rather than a transparent rectangular teaching enclosure.
  const sin = Math.sin(angle), cos = Math.cos(angle), exponent = profile.power ?? 2;
  const signedPower = value => Math.sign(value) * Math.pow(Math.abs(value), 2 / exponent);
  const castLobe = 1 + (profile.lobes || 0) * Math.cos(angle * 3 + 0.35);
  const y = (profile.cy || 0) + signedPower(sin) * Math.max(0.08, profile.ry - inward) * castLobe;
  const z = (profile.cz || 0) + signedPower(cos) * Math.max(0.08, profile.rz - inward) * castLobe;
  return [profile.x, y, z];
}

function interpolatedProfile(profiles, fraction) {
  const scaled = fraction * (profiles.length - 1), index = Math.min(profiles.length - 2, Math.floor(scaled));
  const a = profiles[index], b = profiles[index + 1], t = scaled - index, result = {};
  for (const key of ['x', 'ry', 'rz', 'cy', 'cz', 'power', 'lobes']) {
    const fallback = key === 'power' ? 2 : 0;
    result[key] = (a[key] ?? fallback) * (1 - t) + (b[key] ?? fallback) * t;
  }
  return result;
}

function bufferFromTriangles(triangles, textureScale = 1) {
  const positions = [], uvs = [];
  for (const triangle of triangles) for (const vertex of triangle) {
    positions.push(...vertex); uvs.push(vertex[0] * textureScale, (vertex[1] + vertex[2]) * textureScale);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const smooth = mergeVertices(geometry, 0.00001); geometry.dispose();
  smooth.computeVertexNormals();
  return smooth;
}

function quad(triangles, a, b, c, d, reverse = false) {
  if (reverse) triangles.push([a, c, b], [a, d, c]);
  else triangles.push([a, b, c], [a, c, d]);
}

function shellGeometry(profiles, thickness, opening, segments = 64, slices = 8) {
  const start = opening.start + opening.span, arc = TAU - opening.span;
  const outer = [], inner = [], lips = [], cuts = [];
  for (let i = 0; i < slices; i += 1) {
    const a = interpolatedProfile(profiles, i / slices), b = interpolatedProfile(profiles, (i + 1) / slices);
    for (let j = 0; j < segments; j += 1) {
      const angleA = start + arc * j / segments, angleB = start + arc * (j + 1) / segments;
      const o1 = section(a, angleA), o2 = section(b, angleA), o3 = section(b, angleB), o4 = section(a, angleB);
      const i1 = section(a, angleA, thickness), i2 = section(b, angleA, thickness), i3 = section(b, angleB, thickness), i4 = section(a, angleB, thickness);
      quad(outer, o1, o2, o3, o4); quad(inner, i1, i2, i3, i4, true);
      if (!i) quad(lips, o1, o4, i4, i1);
      if (i === slices - 1) quad(lips, o2, i2, i3, o3);
      if (opening.span > 0.001 && !j) quad(cuts, o1, i1, i2, o2);
      if (opening.span > 0.001 && j === segments - 1) quad(cuts, o4, o3, i3, i4);
    }
  }
  return { shell: bufferFromTriangles([...outer, ...inner]), lips: bufferFromTriangles(lips), cuts: bufferFromTriangles(cuts) };
}

function ringGeometry(profile, width, radialDepth = 0.17, opening) {
  return shellGeometry([{ ...profile, x: profile.x - width / 2 }, { ...profile, x: profile.x + width / 2 }], radialDepth, opening, 64, 1);
}

function mesh(geometry, material, group) {
  const object = new THREE.Mesh(geometry, material); object.castShadow = true; object.receiveShadow = true;
  group.add(object); return object;
}

function axialCylinder(radius, length, material, position, parent, segments = 24) {
  const geometry = sharedGeometry(material, `cylinder:${radius}:${length}:${segments}`,
    () => new THREE.CylinderGeometry(radius, radius, length, segments));
  const object = mesh(geometry, material, parent);
  object.rotation.z = Math.PI / 2; object.position.set(...position); return object;
}

function annularBoss(radius, bore, length, material, position, parent) {
  const geometry = sharedGeometry(material, `boss:${radius}:${bore}:${length}`, () => {
    const shape = new THREE.Shape(); shape.absarc(0, 0, radius, 0, TAU, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, bore, 0, TAU, true); shape.holes.push(hole);
    const result = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: true,
      bevelSegments: 1, bevelSize: 0.016, bevelThickness: 0.016, curveSegments: 32 });
    result.translate(0, 0, -length / 2); result.rotateY(Math.PI / 2); return result;
  });
  const object = mesh(geometry, material, parent); object.position.set(...position); return object;
}

function beam(a, b, width, depth, material, parent) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from);
  const object = mesh(new THREE.BoxGeometry(delta.length(), width, depth), material, parent);
  object.position.copy(from).add(to).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(unitX, delta.normalize()); return object;
}

function endCover(profile, holes, material, group) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 96; i += 1) {
    const [, y, z] = section(profile, i * TAU / 96, 0.08);
    if (!i) shape.moveTo(z, y); else shape.lineTo(z, y);
  }
  shape.closePath();
  for (const [y, z, radius] of holes) {
    const hole = new THREE.Path(); hole.absarc(z, y, radius, 0, TAU, true); shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false, curveSegments: 24 });
  // Shape xy -> local yz: its x maps to z, y stays y, extrusion z maps to x.
  geometry.rotateY(-Math.PI / 2);
  const cover = mesh(geometry, material, group); cover.position.x = profile.x + 0.07;
  return cover;
}

function configuration(type) {
  if (type === 'mt' || type === 'dct') return {
    orientation: 0,
    body: [
      { x: -2.35, cy: -0.14, ry: 2.76, rz: 2.13, power: 2.8, lobes: 0.018 },
      { x: -1.9, cy: -0.20, ry: 2.76, rz: 2.12, power: 2.7, lobes: 0.018 },
      { x: 0.9, cy: -0.275, ry: 2.665, rz: 1.90, power: 2.8, lobes: 0.025 },
      { x: 2.65, cy: -0.21, ry: 2.43, rz: 1.78, power: 2.6, lobes: 0.012 },
    ],
    bell: [
      { x: type === 'dct' ? -4.06 : -3.84, cy: 0.9, ry: 1.29, rz: 1.29 },
      { x: -3.46, cy: 0.9, ry: 1.29, rz: 1.27 },
      { x: -2.35, cy: 0.9, ry: 1.04, rz: 1.08 },
    ],
    tail: [
      { x: 2.50, cy: -1.56, ry: 1.11, rz: 1.15, power: 2.3 },
      { x: 3.08, cy: -1.58, ry: 1.10, rz: 1.10, power: 2.1 },
      { x: 3.43, cy: -2.02, ry: 0.54, rz: 0.60 },
    ],
    bearings: [[-2.35, 0.9, 0, type === 'mt' ? 0.15 : 0.24], [2.25, 0.9, 0, 0.15], [-2.35, -1.1, 0, 0.17], [2.50, -1.1, 0, 0.17]],
    portsLeft: [[0.9, 0, type === 'mt' ? 0.413 : 0.503], [-1.1, 0, 0.433]],
    portsRight: [[0.9, 0, 0.413], [-1.1, 0, 0.433]], panY: -2.78,
  };
  if (type === 'cvt') return {
    orientation: -Math.PI / 2,
    body: [
      { x: -2.15, ry: 1.86, rz: 3.20, power: 2.5, lobes: 0.015 },
      { x: -1.45, ry: 1.86, rz: 3.20, power: 2.6, lobes: 0.015 },
      { x: 0.75, ry: 1.81, rz: 3.15, power: 2.5, lobes: 0.012 },
      { x: 1.40, ry: 1.72, rz: 3.00, power: 2.5, lobes: 0.012 },
    ],
    bell: [
      { x: -3.00, cz: 1.68, ry: 1.13, rz: 1.13 },
      { x: -2.60, cz: 1.68, ry: 1.10, rz: 1.10 },
      { x: -2.15, cz: 1.68, ry: 0.97, rz: 1.00 },
    ],
    tail: [{ x: 1.32, cz: -1.68, ry: 0.80, rz: 0.80 }, { x: 1.95, cz: -1.68, ry: 0.49, rz: 0.49 }],
    bearings: [[-1.12, 0, 1.68, 0.205], [1.12, 0, 1.68, 0.205], [-1.12, 0, -1.68, 0.205], [1.12, 0, -1.68, 0.205]],
    portsLeft: [[0, 1.68, 0.468], [0, -1.68, 0.468]],
    portsRight: [[0, 1.68, 0.468], [0, -1.68, 0.468]], panY: -1.86,
  };
  return {
    orientation: 0,
    body: [
      { x: -2.24, ry: type === 'ecvt' ? 1.54 : 1.68, rz: type === 'ecvt' ? 1.54 : 1.68, power: 2.15 },
      { x: -1.35, ry: 1.98, rz: 1.98, power: 2.20, lobes: 0.018 },
      { x: 1.75, ry: 2.04, rz: 2.04, power: 2.22, lobes: 0.018 },
      { x: 3.32, ry: type === 'ecvt' ? 1.29 : 1.45, rz: type === 'ecvt' ? 1.29 : 1.45, power: 2.12 },
    ],
    bell: [
      { x: -4.16, ry: type === 'at' ? 1.51 : 1.21, rz: type === 'at' ? 1.51 : 1.21 },
      { x: -3.78, ry: type === 'at' ? 1.50 : 1.20, rz: type === 'at' ? 1.50 : 1.20 },
      { x: -2.24, ry: 1.22, rz: 1.22 },
    ],
    tail: [{ x: 3.15, ry: 1.22, rz: 1.22 }, { x: 3.85, ry: 0.61, rz: 0.64 }, { x: 4.45, ry: 0.41, rz: 0.44 }],
    bearings: [[-2.25, 0, 0, type === 'at' ? 0.155 : 0.130], [3.25, 0, 0, type === 'at' ? 0.205 : 0.220]],
    portsLeft: [[0, 0, type === 'at' ? 0.418 : 0.393]],
    portsRight: [[0, 0, type === 'at' ? 0.468 : 0.483]], panY: -2.02,
  };
}

/** Cast gearbox envelope: representative geometry, not manufacturer CAD. */
export function createGearboxHousing(type = 'mt', options = {}) {
  const config = configuration(type), group = new THREE.Group(); group.name = `${type}-cast-cutaway-housing`;
  group.rotation.y = config.orientation;
  const cast = finish(options.color ?? 0x8a9092, 0.78, 0.68, 'grain cast aluminum gearbox shell', 0.019);
  const machine = finish(0xbfc4c6, 0.96, 0.28, 'machined aluminum assembly flange');
  const cut = finish(0x813124, 0.20, 0.75, 'painted saw-cut wall cross-section', 0.005);
  const steel = finish(0x81868b, 0.95, 0.32, 'zinc plated hex head fastener');
  const gasket = finish(0x343536, 0.04, 0.93, 'case split elastomer gasket');
  const wallThickness = 0.13, dynamic = [], angularDetails = [], covers = [], bearingSupports = [], bearingFits = [];
  let ribCount = 0, boltCount = 0, mode = 'cutaway', cutaway = 0.55, opacity = 1, lastKey = '';
  const openingFor = (amount, closed = false) => ({ start: -0.46 + (type === 'cvt' ? Math.PI / 2 : 0), span: closed ? 0 : 0.46 + amount * 3.84 });

  function dynamicBand(profiles, thickness, surface, width = null, radialDepth = null) {
    const shell = mesh(new THREE.BufferGeometry(), surface, group);
    const lip = mesh(new THREE.BufferGeometry(), machine, group);
    const cutFace = mesh(new THREE.BufferGeometry(), cut, group);
    shell.userData.feature = 'cast-wall'; lip.userData.feature = 'machined-edge'; cutFace.userData.feature = 'cut-face';
    dynamic.push({ profiles, thickness, shell, lip, cutFace, width, radialDepth });
    return shell;
  }
  dynamicBand(config.body, wallThickness, cast);
  dynamicBand(config.bell, wallThickness + 0.02, cast);
  dynamicBand(config.tail, wallThickness, cast);

  function addFlange(profile, width = 0.15, extension = 0.12, bolts = 12) {
    const outside = { ...profile, ry: profile.ry + extension, rz: profile.rz + extension };
    dynamicBand([outside, outside], 0.24, machine, width, 0.24);
    const seam = { ...outside, x: outside.x + width * 0.47, ry: outside.ry - 0.035, rz: outside.rz - 0.035 };
    dynamicBand([seam, seam], 0.04, gasket, 0.024, 0.04);
    for (let i = 0; i < bolts; i += 1) {
      const angle = i * TAU / bolts + 0.1, position = section(outside, angle, 0.095), assembly = new THREE.Group(); group.add(assembly);
      const boss = axialCylinder(0.145, width + 0.14, cast, position, assembly, 20); boss.userData.feature = 'bolt-boss';
      const washer = axialCylinder(0.112, 0.026, steel, [position[0] + width / 2 + 0.072, position[1], position[2]], assembly, 20);
      const bolt = axialCylinder(0.08, 0.072, steel, [position[0] + width / 2 + 0.11, position[1], position[2]], assembly, 6);
      bolt.userData.feature = 'hex-bolt'; washer.userData.feature = 'bolt-washer';
      angularDetails.push({ group: assembly, angle }); boltCount += 1;
    }
  }
  addFlange(config.bell[0], 0.16, 0.15, 14);
  addFlange(config.body[0], 0.16, 0.11, 14);
  addFlange(config.body.at(-1), 0.13, 0.10, 12);
  addFlange(config.tail.at(-1), 0.12, 0.08, 8);

  // Tall exterior ribs are attached to the cast body. A removed housing sector
  // also removes its ribs and fasteners so that none floats in the cut window.
  for (let i = 0; i < 12; i += 1) {
    const angle = i * TAU / 12 + 0.05, reinforcement = new THREE.Group(); group.add(reinforcement);
    for (let j = 0; j < config.body.length - 1; j += 1) {
      const a = section(config.body[j], angle, -0.065), b = section(config.body[j + 1], angle, -0.065);
      const rib = beam(a, b, 0.105, 0.11, cast, reinforcement); rib.userData.feature = 'reinforcing-rib'; ribCount += 1;
    }
    angularDetails.push({ group: reinforcement, angle });
  }
  for (const fraction of [0.24, 0.52, 0.78]) {
    const profile = interpolatedProfile(config.body, fraction);
    dynamicBand([{ ...profile, ry: profile.ry + 0.095, rz: profile.rz + 0.095 }, { ...profile, ry: profile.ry + 0.095, rz: profile.rz + 0.095 }], 0.11, cast, 0.075, 0.11);
    ribCount += 1;
  }

  for (const [x, y, z, shaftRadius] of config.bearings) {
    const position = [x, y, z], outerRaceRadius = shaftRadius + 0.235;
    // The bearing meshes include an 0.008 outer-race edge bevel; the receiving
    // bore includes both that envelope and its own 0.016 inward chamfer.
    const receivingBore = outerRaceRadius + 0.028, bossRadius = receivingBore + 0.15;
    const support = new THREE.Group(); group.add(support); bearingSupports.push(support);
    const bore = annularBoss(bossRadius, receivingBore, 0.23, cast, position, support); bore.userData.feature = 'bearing-bore-support';
    // A retaining shoulder contacts the stationary outer-race end face. It is
    // axially beyond the race, rather than occupying the balls or inner race.
    const seat = annularBoss(receivingBore + 0.07, outerRaceRadius - 0.035, 0.04, machine, [x + 0.17, y, z], support); seat.userData.feature = 'machined-bearing-seat';
    const profile = config.body.reduce((nearest, candidate) => Math.abs(candidate.x - x) < Math.abs(nearest.x - x) ? candidate : nearest);
    const isParallel = type === 'mt' || type === 'dct', targetZ = isParallel ? -1 : z;
    const sectionPower = profile.power ?? 2, lateral = clamp(Math.abs(targetZ - (profile.cz || 0)) / profile.rz, 0, 0.99);
    const lowerWallY = (profile.cy || 0) - profile.ry * Math.pow(1 - Math.pow(lateral, sectionPower), 1 / sectionPower);
    const target = [x, lowerWallY + 0.035, targetZ];
    const web = beam([x, y - bossRadius, z - 0.12], target, 0.13, 0.22, cast, support); web.userData.feature = 'internal-cast-bearing-web';
    const backSign = type === 'cvt' ? Math.sign(z) : -1;
    const back = beam([x, y, z + backSign * bossRadius], [x, y - 0.18, (profile.cz || 0) + backSign * (profile.rz - 0.08)], 0.12, 0.22, cast, support);
    back.userData.feature = 'internal-cast-bearing-web';
    bearingFits.push({ position, shaftRadius, outerRaceRadius, receivingBore,
      minimumBoreRadius: receivingBore - 0.016, retainerAxialOffset: 0.17 });
  }
  covers.push(endCover(config.body[0], config.portsLeft, cast, group));
  covers.push(endCover(config.body.at(-1), config.portsRight, cast, group));
  const tail = config.tail.at(-1);
  covers.push(endCover(tail, [[tail.cy || 0, tail.cz || 0, 0.245]], cast, group));

  // Cast mounting ears, machined drain plug and raised casting identifier.
  for (const fraction of [0.22, 0.74]) {
    const profile = interpolatedProfile(config.body, fraction), bracket = new THREE.Group(); group.add(bracket);
    const p = section(profile, Math.PI * 1.34, -0.12);
    const ear = mesh(new THREE.BoxGeometry(0.42, 0.30, 0.37), cast, bracket); ear.position.set(...p);
    const bolt = axialCylinder(0.09, 0.45, steel, p, bracket, 6); bolt.userData.feature = 'mounting-fastener'; boltCount += 1;
    ear.userData.feature = 'cast-mounting-ear';
    angularDetails.push({ group: bracket, angle: Math.PI * 1.34 });
  }
  const drainProfile = interpolatedProfile(config.body, 0.56), drainPoint = section(drainProfile, Math.PI * 1.48, -0.06);
  const drain = axialCylinder(0.115, 0.13, steel, drainPoint, group, 6); drain.userData.feature = 'drain-plug';
  const identifier = mesh(new THREE.BoxGeometry(0.78, 0.18, 0.032), cast, group);
  const identifierPosition = section(interpolatedProfile(config.body, 0.58), Math.PI * 1.97, -0.03);
  identifier.position.set(...identifierPosition); identifier.userData.feature = 'raised-casting-pad';
  angularDetails.push({ group: identifier, angle: Math.PI * 1.97 });
  const materials = [cast, machine, cut, steel, gasket];

  function update(view = {}) {
    mode = ['cutaway', 'closed', 'hidden'].includes(view.housingMode) ? view.housingMode : 'cutaway';
    cutaway = clamp(view.cutaway ?? 0.55, 0, 1); opacity = clamp(view.housing ?? 1, 0, 1);
    group.visible = mode !== 'hidden' && opacity > 0.012;
    const key = `${mode === 'closed'}:${Math.round(cutaway * 1000)}`;
    const opening = openingFor(cutaway, mode === 'closed');
    if (key !== lastKey) {
      for (const item of dynamic) {
        const geometries = item.width == null ? shellGeometry(item.profiles, item.thickness, opening) : ringGeometry(item.profiles[0], item.width, item.radialDepth, opening);
        for (const [object, geometry] of [[item.shell, geometries.shell], [item.lip, geometries.lips], [item.cutFace, geometries.cuts]]) {
          object.geometry.dispose(); object.geometry = geometry;
        }
        item.cutFace.visible = mode !== 'closed';
      }
      const removed = angle => ((angle - opening.start + TAU * 2) % TAU) < opening.span;
      for (const detail of angularDetails) detail.group.visible = mode === 'closed' || !removed(detail.angle);
      for (const cover of covers) cover.visible = mode === 'closed';
      lastKey = key;
    }
    for (const material of materials) {
      const transparent = opacity < 0.995;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.opacity = opacity; material.depthWrite = !transparent;
    }
    group.userData.housingMode = mode; group.userData.cutaway = cutaway;
  }

  function diagnostics() {
    let triangles = 0, visibleTriangles = 0, cutFaces = 0, cutFaceTriangles = 0, meshes = 0;
    group.traverse(object => {
      if (!object.isMesh) return; meshes += 1;
      const count = object.geometry.index ? object.geometry.index.count / 3 : object.geometry.attributes.position?.count / 3 || 0;
      triangles += count;
      let visible = object.visible;
      for (let parent = object.parent; parent && parent !== group.parent; parent = parent.parent) visible &&= parent.visible;
      if (visible) visibleTriangles += count;
      if (object.userData.feature === 'cut-face' && count > 0) { cutFaces += 1; cutFaceTriangles += count; }
    });
    return { type, mode, cutaway, opacity, wallThickness, cutFaces, cutFaceTriangles, ribCount, boltCount,
      bearingSupportCount: bearingSupports.length, bearingFits, closedEndCovers: covers.length, triangles, visibleTriangles, meshes,
      supportsModes: ['cutaway', 'closed', 'hidden'], castSurface: true, rectangularProxy: false };
  }
  update({ housingMode: 'cutaway', cutaway: 0.55, housing: 1 });
  group.userData.housingDiagnostics = diagnostics;
  return { group, update, diagnostics };
}
