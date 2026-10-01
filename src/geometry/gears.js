import * as THREE from 'three';

const TAU = Math.PI * 2;
const involute = (radius, base) => { const t = Math.sqrt(Math.max(0, radius * radius / (base * base) - 1)); return t - Math.atan(t); };
const DETAIL = {
  high: { fillets: 3, flanks: 5, tips: 3, axial: 9, circle: 80, curves: 36, ring: 56 },
  balanced: { fillets: 2, flanks: 4, tips: 2, axial: 5, circle: 48, curves: 20, ring: 40 },
  low: { fillets: 2, flanks: 3, tips: 2, axial: 3, circle: 32, curves: 12, ring: 28 },
};
const detailSettings = value => DETAIL[value] || DETAIL.high;

/** A sampled 20° involute with rounded dedendum transitions, in the yz plane.
 * This is explanatory rendering geometry, not a manufacturing tooth drawing. */
export function toothProfile(teeth, pitchRadius, internal = false, detail = 'high') {
  const resolution = detailSettings(detail);
  const module = pitchRadius * 2 / teeth;
  const pressure = THREE.MathUtils.degToRad(20), base = pitchRadius * Math.cos(pressure);
  const root = pitchRadius - module * 1.22, outer = pitchRadius + module * 0.98;
  const pitch = TAU / teeth, half = Math.PI / (2 * teeth), invPitch = involute(pitchRadius, base);
  const flank = radius => half + invPitch - involute(Math.max(base, radius), base);
  const samples = [];
  const add = (r, a) => { const radius = internal ? pitchRadius * 2 - r : r; samples.push(new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius)); };
  for (let tooth = 0; tooth < teeth; tooth += 1) {
    const center = tooth * pitch;
    const flankBase = flank(base), rootAngle = Math.min(pitch * 0.44, flankBase + pitch * 0.08);
    add(root, center - pitch / 2); add(root, center - rootAngle);
    // Root fillets blend into the involute rather than forming rectangular steps.
    for (let j = 1; j <= resolution.fillets; j += 1) { const t = j / resolution.fillets; add(root + (Math.max(base, root) - root) * t * t, center - rootAngle + (rootAngle - flankBase) * t); }
    for (let j = 1; j <= resolution.flanks; j += 1) { const r = Math.max(base, root) + (outer - Math.max(base, root)) * j / resolution.flanks; add(r, center - flank(r)); }
    const tipHalf = flank(outer); for (let j = 1; j <= resolution.tips; j += 1) add(outer, center - tipHalf + tipHalf * 2 * j / resolution.tips);
    for (let j = 1; j <= resolution.flanks; j += 1) { const r = outer - (outer - Math.max(base, root)) * j / resolution.flanks; add(r, center + flank(r)); }
    for (let j = 1; j <= resolution.fillets; j += 1) { const t = j / resolution.fillets; add(Math.max(base, root) - (Math.max(base, root) - root) * (1 - (1 - t) ** 2), center + flankBase + (rootAngle - flankBase) * t); }
    add(root, center + pitch / 2);
  }
  const clean = samples.filter((p, i) => i === 0 || p.distanceToSquared(samples[i - 1]) > 1e-16);
  if (clean.length > 1 && clean[0].distanceToSquared(clean[clean.length - 1]) < 1e-16) clean.pop();
  return clean;
}

function circle(radius, count = 72, reverse = false, splined = false) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (reverse ? count - i - 1 : i) / count * TAU;
    const r = splined ? radius * (i % 4 === 1 || i % 4 === 2 ? 1.04 : 0.96) : radius;
    return new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r);
  });
}

function extrudedTwistedContours(outer, holes, width, pitchRadius, helixDegrees, chamfer = 0.011, detail = 'high') {
  const angleSlope = Math.tan(THREE.MathUtils.degToRad(helixDegrees)) / pitchRadius;
  const contourList = [outer, ...holes];
  const positions = [], uv = [], indices = [];
  const steps = detailSettings(detail).axial;
  const layers = [-width / 2, ...Array.from({ length: steps }, (_, i) => -width / 2 + chamfer + (width - chamfer * 2) * i / (steps - 1)), width / 2];
  const maxRadius = Math.max(...outer.map(p => p.length()));
  for (let c = 0; c < contourList.length; c += 1) {
    const contour = contourList[c], count = contour.length, start = positions.length / 3;
    for (let layer = 0; layer < layers.length; layer += 1) {
      const x = layers[layer], twist = x * angleSlope;
      const bevel = layer === 0 || layer === layers.length - 1 ? chamfer * (c ? 1 : -1) : 0;
      for (let i = 0; i < count; i += 1) {
        const radius = contour[i].length() + bevel, angle = Math.atan2(contour[i].y, contour[i].x) + twist;
        positions.push(x, Math.cos(angle) * radius, Math.sin(angle) * radius); uv.push(i / count * 4, (x / width + 0.5));
      }
    }
    for (let layer = 0; layer < layers.length - 1; layer += 1) for (let i = 0; i < count; i += 1) {
      const a = start + layer * count + i, b = start + layer * count + (i + 1) % count, d = a + count, e = b + count;
      indices.push(a, b, d, b, e, d);
    }
  }
  const faces = THREE.ShapeUtils.triangulateShape(outer, holes);
  const all = [...outer, ...holes.flat()];
  for (const sign of [-1, 1]) {
    const start = positions.length / 3, x = sign * width / 2, twist = x * angleSlope;
    for (let i = 0; i < all.length; i += 1) {
      const p = all[i], radius = p.length() + (i < outer.length ? -chamfer : chamfer), angle = Math.atan2(p.y, p.x) + twist;
      positions.push(x, Math.cos(angle) * radius, Math.sin(angle) * radius); uv.push(Math.cos(angle) * radius / (maxRadius * 2) + 0.5, Math.sin(angle) * radius / (maxRadius * 2) + 0.5);
    }
    for (const tri of faces) if (sign > 0) indices.push(start + tri[0], start + tri[1], start + tri[2]); else indices.push(start + tri[2], start + tri[1], start + tri[0]);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData = { profile: 'sampled involute', helixDegrees, width, pitchRadius, axialLayers: layers.length, chamfer, detail }; return geometry;
}

export function createHelicalGearGeometry({ teeth, pitchRadius, width = 0.32, helixDegrees = 25, internal = false, boreRadius = 0.18, detail = 'high' }) {
  const resolution = detailSettings(detail), profile = toothProfile(teeth, pitchRadius, internal, detail);
  const outer = internal ? circle(pitchRadius + 0.17, detail === 'high' ? 96 : resolution.circle) : profile;
  const holes = internal ? [profile.slice().reverse()] : [circle(boreRadius, resolution.circle, true)];
  const geometry = extrudedTwistedContours(outer, holes, width, pitchRadius, helixDegrees, Math.min(0.011, width * 0.06), detail);
  geometry.userData.teeth = teeth; geometry.userData.internal = internal; return geometry;
}

function annularShape(outerRadius, boreRadius, holeCount = 0, holeRadius = 0, holeCenter = 0, detail = 'high') {
  const shape = new THREE.Shape(); shape.absarc(0, 0, outerRadius, 0, TAU, false);
  const bore = new THREE.Path(); const spline = circle(boreRadius, 80, true, true); bore.setFromPoints(spline); bore.closePath(); shape.holes.push(bore);
  for (let i = 0; i < holeCount; i += 1) { const angle = TAU * i / holeCount; const hole = new THREE.Path(); hole.absarc(Math.cos(angle) * holeCenter, Math.sin(angle) * holeCenter, holeRadius, 0, TAU, true); shape.holes.push(hole); }
  return shape;
}

function shapeMesh(shape, depth, material, detail = 'high') {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, curveSegments: detailSettings(detail).curves, bevelEnabled: true, bevelSize: 0.009, bevelThickness: 0.009, bevelSegments: 2 });
  const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
  geometry.computeBoundingBox(); const r = Math.max(Math.abs(geometry.boundingBox.min.x), Math.abs(geometry.boundingBox.max.x));
  for (let i = 0; i < p.count; i += 1) if (Math.abs(n.getZ(i)) > 0.9) uv.setXY(i, p.getX(i) / (r * 2) + 0.5, p.getY(i) / (r * 2) + 0.5);
  geometry.translate(0, 0, -depth / 2); geometry.rotateY(Math.PI / 2); const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}

export function createMachinedGear({ teeth, pitchRadius, width = 0.32, helixDegrees = 25, internal = false, boreRadius = 0.18, steelMaterial, faceMaterial, darkMaterial, detail = 'high' }) {
  const group = new THREE.Group();
  const root = pitchRadius - pitchRadius * 2 / teeth * 1.22;
  boreRadius = Math.min(boreRadius, root * 0.81);
  const hubRadius = Math.min(root * 0.94, Math.max(boreRadius + 0.025, Math.min(pitchRadius * 0.3, root * 0.7)));
  const rimBore = internal ? boreRadius : Math.min(root * 0.965, Math.max(hubRadius + 0.02, root * 0.64));
  const toothBody = new THREE.Mesh(createHelicalGearGeometry({ teeth, pitchRadius, width, helixDegrees, internal, boreRadius: rimBore, detail }), faceMaterial); toothBody.castShadow = true; toothBody.receiveShadow = true; group.add(toothBody);
  let reliefHoleCount = 0;
  if (!internal) {
    const webOuter = Math.min(root * 0.99, Math.max(rimBore + 0.008, root * 0.72));
    const gap = webOuter - hubRadius;
    reliefHoleCount = gap > 0.19 ? 6 : 0;
    const web = shapeMesh(annularShape(webOuter, boreRadius, reliefHoleCount, Math.min(gap * 0.26, 0.105), hubRadius + gap * 0.52, detail), Math.max(0.09, width * 0.38), steelMaterial, detail); group.add(web);
    const hub = shapeMesh(annularShape(hubRadius, boreRadius, 0, 0, 0, detail), width + 0.12, steelMaterial, detail); group.add(hub);
    for (const sign of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(hubRadius * 0.94, 0.012, 8, detailSettings(detail).ring), darkMaterial); ring.rotation.y = Math.PI / 2; ring.position.x = sign * (width / 2 + 0.064); group.add(ring);
      const recessRing = new THREE.Mesh(new THREE.TorusGeometry(webOuter * 0.92, 0.006, 6, detailSettings(detail).ring), darkMaterial); recessRing.rotation.y = Math.PI / 2; recessRing.position.x = sign * width * 0.22; group.add(recessRing);
    }
  }
  group.userData.gear = { teeth, pitchRadius, width, helixDegrees, internal, boreRadius, involute: true, recessedWeb: !internal, splinedHub: !internal, reliefHoleCount, detail };
  return group;
}
