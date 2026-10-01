import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGearboxHousing } from '../src/geometry/housing.js';
import { createHelicalGearGeometry, createMachinedGear } from '../src/geometry/gears.js';

const types = ['mt', 'dct', 'cvt', 'at', 'ecvt'];
const tolerance = 2e-6;
const near = (actual, expected, tol = tolerance) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);
const meshes = root => { const result = []; root.traverse(o => { if (o.isMesh) result.push(o); }); return result; };
const isVisible = object => { for (let p = object; p; p = p.parent) if (!p.visible) return false; return true; };
const visibleMeshes = root => meshes(root).filter(isVisible);
const geometries = root => new Set(meshes(root).map(o => o.geometry));
const materialSet = root => new Set(meshes(root).flatMap(o => Array.isArray(o.material) ? o.material : [o.material]));
const triangleCount = geometry => (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;

function eachTriangle(geometry, callback) {
  const position = geometry.getAttribute('position'), index = geometry.index;
  const count = index?.count ?? position.count;
  assert.equal(count % 3, 0);
  for (let i = 0; i < count; i += 3) {
    const vertices = [i, i + 1, i + 2].map(j => {
      const vertex = index ? index.getX(j) : j;
      assert.ok(vertex >= 0 && vertex < position.count, 'triangle index must reference an existing vertex');
      return new THREE.Vector3(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
    });
    callback(vertices);
  }
}

function surfaceArea(geometry) {
  let area = 0;
  eachTriangle(geometry, ([a, b, c]) => { area += b.sub(a).cross(c.sub(a)).length() / 2; });
  return area;
}

function assertRenderable(geometry, label) {
  const position = geometry.getAttribute('position');
  assert.ok(position, `${label}: position attribute`);
  for (const name of ['position', 'normal', 'uv']) {
    const attribute = geometry.getAttribute(name);
    assert.ok(attribute, `${label}: ${name} attribute`);
    assert.equal(attribute.count, position.count, `${label}: ${name} vertex count`);
    for (const value of attribute.array) assert.ok(Number.isFinite(value), `${label}: finite ${name}`);
  }
  if (!position.count) return;
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  for (const value of [...geometry.boundingBox.min.toArray(), ...geometry.boundingBox.max.toArray(), ...geometry.boundingSphere.center.toArray(), geometry.boundingSphere.radius]) assert.ok(Number.isFinite(value), `${label}: finite bounds`);
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i += 1) {
    const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
    assert.ok(length > 0.98 && length < 1.02, `${label}: usable unit normal at vertex ${i}: ${length}`);
  }
  const scale = geometry.boundingBox.getSize(new THREE.Vector3()).length();
  let degenerate = 0;
  eachTriangle(geometry, ([a, b, c]) => { if (b.sub(a).cross(c.sub(a)).length() <= Math.max(1, scale * scale) * 1e-10) degenerate += 1; });
  assert.equal(degenerate, 0, `${label}: zero-area triangles cause invalid shading and waste render work`);
}

// Weld by position, independently of helper indices/UV seams, then check that
// every physical edge has exactly two oppositely wound incident triangles.
function assertClosedSurface(items, label) {
  const edges = new Map();
  const key = v => v.toArray().map(n => Math.round(n / tolerance)).join(':');
  for (const geometry of items) eachTriangle(geometry, triangle => {
    const vertices = triangle.map(key);
    assert.equal(new Set(vertices).size, 3, `${label}: triangle must survive geometric welding`);
    for (let i = 0; i < 3; i += 1) {
      const a = vertices[i], b = vertices[(i + 1) % 3], forward = a < b;
      const edge = forward ? `${a}|${b}` : `${b}|${a}`;
      const value = edges.get(edge) || { count: 0, winding: 0 };
      value.count += 1; value.winding += forward ? 1 : -1; edges.set(edge, value);
    }
  });
  assert.ok(edges.size > 0, `${label}: surface contains actual triangles`);
  const defective = [...edges.values()].filter(edge => edge.count !== 2 || edge.winding !== 0);
  assert.equal(defective.length, 0, `${label}: open or inconsistently wound physical edges`);
}

function dispose(root) {
  for (const geometry of geometries(root)) geometry.dispose();
  for (const material of materialSet(root)) material.dispose();
}

function crossSections(geometry) {
  const rows = new Map(), p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i), key = x.toFixed(6);
    if (!rows.has(key)) rows.set(key, { x, points: [] });
    rows.get(key).points.push(new THREE.Vector2(p.getY(i), p.getZ(i)));
  }
  return [...rows.values()].sort((a, b) => a.x - b.x);
}

function assertPointsMatch(actual, expected, label, tol = 6e-6) {
  const buckets = new Map(), gridKey = p => `${Math.floor(p.x / tol)}:${Math.floor(p.y / tol)}`;
  for (const p of expected) { const key = gridKey(p); if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(p); }
  for (const p of actual) {
    const x = Math.floor(p.x / tol), y = Math.floor(p.y / tol);
    let match = false;
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) if ((buckets.get(`${x + dx}:${y + dy}`) || []).some(q => q.distanceTo(p) < tol)) match = true;
    assert.ok(match, `${label}: matching cross-section vertex at ${p.x},${p.y}`);
  }
}

test('all five housings render finite nondegenerate walls, normals, UVs and transforms at cutaway endpoints', () => {
  for (const type of types) {
    const housing = createGearboxHousing(type);
    for (const [housingMode, cutaway] of [['cutaway', 0], ['cutaway', 0.2], ['cutaway', 0.8], ['cutaway', 1], ['closed', 0.8]]) {
      housing.update({ housingMode, cutaway, housing: 1 }); housing.group.updateMatrixWorld(true);
      let triangles = 0;
      for (const object of visibleMeshes(housing.group)) {
        assert.ok(object.matrixWorld.elements.every(Number.isFinite), `${type}: finite transform`);
        assertRenderable(object.geometry, `${type}/${housingMode}/${cutaway}/${object.userData.feature || 'cover'}`);
        triangles += triangleCount(object.geometry);
      }
      assert.ok(triangles > 0, `${type}: visible physical case`);
    }
    dispose(housing.group);
  }
});

test('cutaway control removes actual wall area and attached detail rather than merely changing opacity', () => {
  for (const type of types) {
    const housing = createGearboxHousing(type), wall = housing.group.children.find(o => o.userData.feature === 'cast-wall');
    housing.update({ housingMode: 'cutaway', cutaway: 0.2, housing: 1 });
    const small = { area: surfaceArea(wall.geometry), position: [...wall.geometry.getAttribute('position').array], visibleTriangles: visibleMeshes(housing.group).reduce((sum, o) => sum + triangleCount(o.geometry), 0) };
    housing.update({ housingMode: 'cutaway', cutaway: 0.8, housing: 1 });
    const largeArea = surfaceArea(wall.geometry);
    assert.ok(largeArea < small.area * 0.8, `${type}: larger opening materially removes wall`);
    assert.notDeepEqual([...wall.geometry.getAttribute('position').array], small.position, `${type}: actual shape changes`);
    assert.ok(visibleMeshes(housing.group).reduce((sum, o) => sum + triangleCount(o.geometry), 0) < small.visibleTriangles, `${type}: ribs/fasteners leave the opened sector`);
    assert.ok([...materialSet(housing.group)].every(material => material.opacity === 1 && !material.transparent));
    dispose(housing.group);
  }
});

test('cast wall has closed inner/outer thickness with real opening side caps and a varying axial envelope', () => {
  for (const type of types) {
    const housing = createGearboxHousing(type), [wall, lip, cuts] = housing.group.children;
    assert.equal(wall.userData.feature, 'cast-wall'); assert.equal(lip.userData.feature, 'machined-edge'); assert.equal(cuts.userData.feature, 'cut-face');
    for (const housingMode of ['closed', 'cutaway']) {
      housing.update({ housingMode, cutaway: 0.8, housing: 1 });
      assertClosedSurface([wall.geometry, lip.geometry, cuts.geometry], `${type}/${housingMode} solid wall`);
      if (housingMode === 'closed') assert.equal(triangleCount(cuts.geometry), 0);
      else { assert.ok(surfaceArea(cuts.geometry) > 0.02); assert.equal(cuts.visible, true); }
    }
    housing.update({ housingMode: 'closed', housing: 1 });
    const spans = crossSections(wall.geometry).map(row => {
      const ys = row.points.map(p => p.x), zs = row.points.map(p => p.y);
      return Math.hypot(Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs));
    });
    assert.ok(Math.max(...spans) > Math.min(...spans) * 1.02, `${type}: cast envelope varies along the shafts`);
    dispose(housing.group);
  }
});

test('closed end covers are solid around the required shaft bores, and are removed in cutaway mode', () => {
  const ports = { mt: [[0.9, 0], [-1.1, 0]], dct: [[0.9, 0], [-1.1, 0]], cvt: [[0, 1.68], [0, -1.68]], at: [[0, 0]], ecvt: [[0, 0]] };
  for (const type of types) {
    const housing = createGearboxHousing(type);
    const covers = housing.group.children.filter(o => o.isMesh && !o.userData.feature && o.geometry.type === 'ExtrudeGeometry');
    assert.ok(covers.length >= 2, `${type}: actual axial covers`);
    housing.update({ housingMode: 'closed', housing: 1 }); housing.group.updateMatrixWorld(true);
    const direction = new THREE.Vector3(1, 0, 0).transformDirection(housing.group.matrixWorld);
    for (const cover of covers.slice(0, 2)) {
      assert.equal(cover.visible, true); assert.ok(surfaceArea(cover.geometry) > 1);
      cover.material.side = THREE.DoubleSide;
      for (const [y, z] of ports[type]) {
        const origin = new THREE.Vector3(cover.position.x - 1, y, z).applyMatrix4(housing.group.matrixWorld);
        assert.equal(new THREE.Raycaster(origin, direction, 0, 2).intersectObject(cover, false).length, 0, `${type}: shaft bore must stay open`);
      }
      const box = cover.geometry.boundingBox || (cover.geometry.computeBoundingBox(), cover.geometry.boundingBox);
      let solidHits = 0;
      for (const yFraction of [0.25, 0.4, 0.6, 0.75]) for (const zFraction of [0.25, 0.4, 0.6, 0.75]) {
        const y = THREE.MathUtils.lerp(box.min.y, box.max.y, yFraction), z = THREE.MathUtils.lerp(box.min.z, box.max.z, zFraction);
        const origin = new THREE.Vector3(cover.position.x - 1, y, z).applyMatrix4(housing.group.matrixWorld);
        if (new THREE.Raycaster(origin, direction, 0, 2).intersectObject(cover, false).length) solidHits += 1;
      }
      assert.ok(solidHits >= 8, `${type}: end cover is filled outside shaft bores`);
    }
    housing.update({ housingMode: 'cutaway', cutaway: 0.8, housing: 1 });
    assert.ok(covers.every(o => !o.visible));
    dispose(housing.group);
  }
});

test('closed MT/DCT body walls contain the rotating main gear teeth with radial assembly clearance', () => {
  // Use the generated tooth-tip radius and its actual axial extent. Sweeping
  // every direction also covers the phases reached as each shaft rotates.
  const pairs = [[18, 62], [24, 56], [30, 50], [36, 44], [42, 38], [46, 34]];
  for (const type of ['mt', 'dct']) {
    const housing = createGearboxHousing(type);
    housing.update({ housingMode: 'closed', housing: 1 }); housing.group.updateMatrixWorld(true);
    const wall = housing.group.children.find(object => object.userData.feature === 'cast-wall');
    wall.material.side = THREE.DoubleSide;
    const order = type === 'dct' ? [2, 4, 6, 1, 3, 5] : [1, 2, 3, 4, 5, 6];
    for (const [index, number] of order.entries()) for (const [shaft, y] of [[0, 0.9], [1, -1.1]]) {
      const teeth = pairs[number - 1][shaft];
      const gear = createHelicalGearGeometry({ teeth, pitchRadius: teeth * 0.025, width: 0.28, helixDegrees: shaft ? -25 : 25, boreRadius: shaft ? 0.19 : 0.17 });
      const position = gear.getAttribute('position'); let tipRadius = 0;
      for (let i = 0; i < position.count; i += 1) tipRadius = Math.max(tipRadius, Math.hypot(position.getY(i), position.getZ(i)));
      gear.computeBoundingBox();
      for (const axial of [gear.boundingBox.min.x, 0, gear.boundingBox.max.x]) for (let sample = 0; sample < 96; sample += 1) {
        const angle = sample * Math.PI * 2 / 96;
        const origin = new THREE.Vector3(-1.65 + index * 0.64 + axial, y, 0), direction = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle));
        const hit = new THREE.Raycaster(origin, direction, 0, 5).intersectObject(wall, false)[0];
        assert.ok(hit, `${type}/${number}/${shaft}: enclosing actual inner wall at direction ${sample}`);
        assert.ok(hit.distance - tipRadius >= 0.02, `${type}/${number}/${shaft}: rotating tooth-to-wall clearance ${(hit.distance - tipRadius).toFixed(4)} at axial ${axial.toFixed(2)}, direction ${sample}`);
      }
      gear.dispose();
    }
    dispose(housing.group);
  }
});

test('hidden housing has no visible triangles, and opacity changes preserve shape and opaque depth behavior', () => {
  for (const type of types) {
    const housing = createGearboxHousing(type);
    housing.update({ housingMode: 'closed', cutaway: 0.2, housing: 1 });
    const before = geometries(housing.group);
    housing.update({ housingMode: 'closed', cutaway: 0.2, housing: 0.4 });
    assert.deepEqual(geometries(housing.group), before);
    assert.ok([...materialSet(housing.group)].every(m => m.transparent && !m.depthWrite && m.opacity === 0.4));
    housing.update({ housingMode: 'closed', cutaway: 0.2, housing: 1 });
    assert.ok([...materialSet(housing.group)].every(m => !m.transparent && m.depthWrite && m.opacity === 1));
    housing.update({ housingMode: 'hidden', cutaway: 0.2, housing: 1 });
    assert.equal(visibleMeshes(housing.group).length, 0); assert.equal(housing.diagnostics().visibleTriangles, 0);
    housing.update({ housingMode: 'cutaway', housing: 0 }); assert.equal(visibleMeshes(housing.group).length, 0);
    dispose(housing.group);
  }
});

test('changing cutaway repeatedly releases every replaced buffer and keeps object/resource counts bounded', () => {
  const housing = createGearboxHousing('dct'), count = meshes(housing.group).length, resourceCount = geometries(housing.group).size;
  for (const cutaway of [0.2, 0.8, 0, 1, 0.2, 0.8]) {
    const previous = geometries(housing.group), released = new Set();
    for (const geometry of previous) geometry.addEventListener('dispose', () => released.add(geometry));
    housing.update({ housingMode: 'cutaway', cutaway, housing: 1 });
    const current = geometries(housing.group);
    assert.equal(meshes(housing.group).length, count); assert.equal(current.size, resourceCount);
    const replaced = [...previous].filter(geometry => !current.has(geometry));
    assert.ok(replaced.length > 0); assert.ok(replaced.every(geometry => released.has(geometry)), 'old cutaway GPU buffers must be disposed');
    assert.ok([...released].every(geometry => !current.has(geometry)), 'retained shared primitive geometry must stay usable');
    housing.update({ housingMode: 'cutaway', cutaway, housing: 1 });
    assert.deepEqual(geometries(housing.group), current, 'unchanged controls do not allocate another copy');
  }
  dispose(housing.group);
});

test('external and internal helical teeth have finite closed surfaces, correct axial width and an open central bore', () => {
  for (const options of [
    { teeth: 18, pitchRadius: 0.45, width: 0.28, helixDegrees: 25, boreRadius: 0.13 },
    { teeth: 62, pitchRadius: 1.55, width: 0.32, helixDegrees: -25, boreRadius: 0.17 },
    { teeth: 30, pitchRadius: 0.6, width: 0.38, helixDegrees: 0, boreRadius: 0.18 },
    { teeth: 24, pitchRadius: 0.48, width: 0.3, helixDegrees: -20, boreRadius: 0.12 },
    { teeth: 78, pitchRadius: 1.56, width: 0.43, helixDegrees: 20, internal: true },
  ]) {
    const geometry = createHelicalGearGeometry(options), label = `${options.teeth}T/${options.internal ? 'ring' : 'external'}`;
    assertRenderable(geometry, label); assertClosedSurface([geometry], label);
    near(geometry.boundingBox.min.x, -options.width / 2); near(geometry.boundingBox.max.x, options.width / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld(true);
    const axial = new THREE.Raycaster(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0), 0, 2);
    assert.equal(axial.intersectObject(mesh, false).length, 0, `${label}: center is a shaft/ring opening`);
    const radial = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 0, 3);
    const contact = radial.intersectObject(mesh, false)[0]; assert.ok(contact);
    if (options.internal) assert.ok(contact.distance > options.pitchRadius * 0.85 && contact.distance < options.pitchRadius * 1.1, 'ring teeth face inward around the pitch circle');
    else near(contact.distance, options.boreRadius, 2e-4);
    geometry.dispose(); mesh.material.dispose();
  }
});

test('the generated helix twists axially by the specified mechanical angle instead of an untwisted tooth extrusion', () => {
  for (const helixDegrees of [-25, 0, 25]) {
    const pitchRadius = 0.9, geometry = createHelicalGearGeometry({ teeth: 36, pitchRadius, width: 0.36, helixDegrees });
    const rows = crossSections(geometry), a = rows[2], b = rows.at(-3);
    assert.ok(b.x > a.x && rows.length > 3);
    const twist = (b.x - a.x) * Math.tan(THREE.MathUtils.degToRad(helixDegrees)) / pitchRadius;
    const rotated = a.points.map(point => point.clone().rotateAround(new THREE.Vector2(), twist));
    assertPointsMatch(b.points, rotated, `${helixDegrees} degree mechanical helix`);
    if (helixDegrees) {
      let different = false;
      try { assertPointsMatch(b.points, a.points, 'untwisted reference'); } catch { different = true; }
      assert.ok(different, 'nonzero helix must produce visibly different axial tooth phases');
    }
    geometry.dispose();
  }
});

test('opposite helix hands produce mirrored physical tooth forms for parallel shaft meshing', () => {
  for (const internal of [false, true]) {
    const plus = createHelicalGearGeometry({ teeth: 42, pitchRadius: 1.05, width: 0.32, helixDegrees: 25, internal });
    const minus = createHelicalGearGeometry({ teeth: 42, pitchRadius: 1.05, width: 0.32, helixDegrees: -25, internal });
    const a = crossSections(plus), b = crossSections(minus).reverse(); assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i += 1) { near(a[i].x, -b[i].x); assertPointsMatch(a[i].points, b[i].points, `mirrored ${internal ? 'ring' : 'external'} section`); }
    plus.dispose(); minus.dispose();
  }
});

test('machined gear webs and hubs retain a real splined shaft passage rather than a solid disk', () => {
  const materials = [0xaaaaaa, 0xbbbbbb, 0x333333].map(color => new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
  const gear = createMachinedGear({ teeth: 62, pitchRadius: 1.55, width: 0.32, boreRadius: 0.2, steelMaterial: materials[0], faceMaterial: materials[1], darkMaterial: materials[2] });
  gear.updateMatrixWorld(true);
  for (const mesh of meshes(gear)) assertRenderable(mesh.geometry, 'machined tooth/web/hub');
  const axial = new THREE.Raycaster(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0), 0, 2);
  assert.equal(axial.intersectObject(gear, true).length, 0, 'shaft can pass through web and hub');
  const bore = [];
  for (let i = 0; i < 80; i += 1) {
    const angle = i * Math.PI * 2 / 80;
    const hit = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, Math.cos(angle), Math.sin(angle)), 0, 0.4).intersectObject(gear, true)[0];
    assert.ok(hit, 'spline wall surrounds the shaft'); bore.push(hit.distance);
  }
  assert.ok(Math.min(...bore) > 0.17 && Math.max(...bore) < 0.23, 'shaft passage matches the requested bore');
  assert.ok(Math.max(...bore) - Math.min(...bore) > 0.01, 'spline passage has alternating teeth rather than a circular bore');
  dispose(gear);
});
