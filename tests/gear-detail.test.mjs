import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { toothProfile, createHelicalGearGeometry, createMachinedGear } from '../src/geometry/gears.js';

const qualities = ['low', 'balanced', 'high'];
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('external and internal tooth flanks follow their own 20-degree base-circle involute at every quality', () => {
  for (const [teeth, pitchRadius, internal] of [[18, 0.45, false], [62, 1.55, false], [42, 1.05, true], [78, 1.56, true]]) {
    const pressure = Math.PI / 9, base = pitchRadius * Math.cos(pressure);
    const halfTooth = Math.PI / (2 * teeth), pitchParameter = Math.tan(pressure);
    const pitchUnwind = pitchParameter - pressure;
    for (const detail of qualities) {
      // Independently construct an involute by unwinding a taut line from its
      // base circle, then rotate/mirror that curve onto the right tooth flank.
      const firstTooth = toothProfile(teeth, pitchRadius, internal, detail).filter(p => {
        const angle = Math.atan2(p.y, p.x);
        return angle >= 0 && angle < Math.PI / teeth - 1e-10;
      });
      const pitchPoint = firstTooth.find(p => Math.abs(p.length() - pitchRadius) < 1e-10);
      assert.ok(pitchPoint, `${teeth}T/${detail}: exact pitch-circle sample`);
      near(Math.atan2(pitchPoint.y, pitchPoint.x), halfTooth);
      const module = 2 * pitchRadius / teeth;
      const lower = internal ? pitchRadius - module * 0.98 : Math.max(base, pitchRadius - module * 1.22);
      const upper = internal ? pitchRadius + module : pitchRadius + module * 0.98;
      let curveSamples = 0;
      for (const point of firstTooth) {
        const radius = point.length();
        if (radius <= lower + 1e-10 || radius >= upper - 1e-10) continue;
        const t = Math.sqrt(radius * radius / (base * base) - 1);
        const unwound = new THREE.Vector2(base * (Math.cos(t) + t * Math.sin(t)), base * (Math.sin(t) - t * Math.cos(t)));
        if (!internal) unwound.y *= -1;
        unwound.rotateAround(new THREE.Vector2(), halfTooth + (internal ? -1 : 1) * pitchUnwind);
        near(point.distanceTo(unwound), 0);
        curveSamples += 1;
      }
      assert.ok(curveSamples >= 2, `${teeth}T/${detail}: working flank samples checked`);
    }
  }
});

test('pitch-circle tooth thickness is symmetric and quality-independent around every ring tooth', () => {
  const teeth = 78, pitchRadius = 1.56;
  for (const detail of qualities) {
    const points = toothProfile(teeth, pitchRadius, true, detail).filter(p => Math.abs(p.length() - pitchRadius) < 1e-10);
    assert.equal(points.length, teeth * 2);
    for (let tooth = 0; tooth < teeth; tooth += 1) {
      const center = tooth * 2 * Math.PI / teeth;
      const expected = [-1, 1].map(sign => new THREE.Vector2(Math.cos(center + sign * Math.PI / (2 * teeth)), Math.sin(center + sign * Math.PI / (2 * teeth))).multiplyScalar(pitchRadius));
      for (const point of expected) assert.ok(points.some(p => p.distanceTo(point) < 1e-10));
    }
  }
});

test('quality changes preserve watertight outward winding and finite unit normals for the corrected ring', () => {
  let previousTriangleCount = 0;
  for (const detail of qualities) {
    const geometry = createHelicalGearGeometry({ teeth: 78, pitchRadius: 1.56, width: 0.43, helixDegrees: -20, internal: true, detail });
    const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), index = geometry.index;
    assert.ok(index.count > previousTriangleCount); previousTriangleCount = index.count;
    const weldedEdges = new Map(), key = p => p.toArray().map(value => Math.round(value * 1e6)).join(':');
    let volume = 0;
    for (let i = 0; i < normal.count; i += 1) {
      const n = new THREE.Vector3().fromBufferAttribute(normal, i);
      near(n.length(), 1, 1e-6);
    }
    for (let i = 0; i < index.count; i += 3) {
      const vertices = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(position, index.getX(i + offset)));
      assert.ok(vertices.every(p => p.toArray().every(Number.isFinite)));
      const [a, b, c] = vertices;
      assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).length() > 1e-10);
      volume += a.dot(b.clone().cross(c)) / 6;
      const keys = vertices.map(key);
      for (let j = 0; j < 3; j += 1) {
        const aKey = keys[j], bKey = keys[(j + 1) % 3], forward = aKey < bKey;
        const edgeKey = forward ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
        const edge = weldedEdges.get(edgeKey) || { count: 0, orientation: 0 };
        edge.count += 1; edge.orientation += forward ? 1 : -1; weldedEdges.set(edgeKey, edge);
      }
    }
    assert.ok(volume > 0, 'outward surface encloses positive solid volume');
    assert.ok([...weldedEdges.values()].every(edge => edge.count === 2 && edge.orientation === 0), 'each physical edge joins opposite triangle windings');
    geometry.dispose();
  }
});

test('working tooth surfaces use ground material while end faces and edge chamfers retain face material', () => {
  const steelMaterial = new THREE.MeshBasicMaterial(), faceMaterial = new THREE.MeshBasicMaterial(), flankMaterial = new THREE.MeshBasicMaterial(), darkMaterial = new THREE.MeshBasicMaterial();
  for (const internal of [false, true]) for (const detail of qualities) {
    const width = 0.32, pitchRadius = 1.56;
    const gear = createMachinedGear({ teeth: 78, pitchRadius, width, internal, helixDegrees: 0, steelMaterial, faceMaterial, flankMaterial, darkMaterial, detail });
    const mesh = gear.children[0], geometry = mesh.geometry, position = geometry.getAttribute('position');
    assert.deepEqual(mesh.material, [flankMaterial, faceMaterial]);
    assert.equal(geometry.groups.length, 2, 'material separation needs only two draw groups');
    const [flanks, faces] = geometry.groups;
    assert.equal(flanks.start, 0); assert.equal(flanks.materialIndex, 0);
    assert.equal(faces.start, flanks.count); assert.equal(faces.materialIndex, 1);
    assert.equal(flanks.count + faces.count, geometry.index.count, 'every triangle belongs to one material');
    const endOfFlank = width / 2 - geometry.userData.chamfer;
    for (const group of geometry.groups) for (let i = group.start; i < group.start + group.count; i += 3) {
      const x = [0, 1, 2].map(offset => Math.abs(position.getX(geometry.index.getX(i + offset))));
      if (group.materialIndex === 0) assert.ok(x.every(value => value <= endOfFlank + 1e-7));
      else assert.ok(x.some(value => value > endOfFlank + 1e-7));
    }
    mesh.updateMatrixWorld(true);
    const radial = new THREE.Raycaster(new THREE.Vector3(0, internal ? 0 : pitchRadius + 0.3, 0), new THREE.Vector3(0, internal ? 1 : -1, 0));
    assert.equal(radial.intersectObject(mesh)[0]?.face.materialIndex, 0, 'radial contact sees the working material');
    const axial = new THREE.Raycaster(new THREE.Vector3(-1, internal ? pitchRadius + 0.1 : pitchRadius, 0), new THREE.Vector3(1, 0, 0));
    assert.equal(axial.intersectObject(mesh)[0]?.face.materialIndex, 1, 'axial inspection sees machined end face');
    gear.traverse(object => object.geometry?.dispose());
  }
  for (const material of [steelMaterial, faceMaterial, flankMaterial, darkMaterial]) material.dispose();
});

test('actual helical triangle surfaces preserve planetary phase with bounded tessellation residual over a mesh cycle', () => {
  const tau = Math.PI * 2, module = 0.04;
  const angle = point => (Math.atan2(point.y, point.x) + tau) % tau;
  const crossSection = (geometry, x, minRadius, maxRadius) => {
    const position = geometry.getAttribute('position'), index = geometry.index, points = new Map();
    // Intersect actual rendered triangles, including their axial diagonals.
    // A rotated ideal 2D profile alone would miss helix tessellation errors.
    for (let i = 0; i < index.count; i += 3) {
      const triangle = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, index.getX(i + j)));
      if (triangle.every(p => p.x > x) || triangle.every(p => p.x < x)) continue;
      for (let j = 0; j < 3; j += 1) {
        const a = triangle[j], b = triangle[(j + 1) % 3];
        if (a.x === b.x || !((a.x <= x && b.x >= x) || (a.x >= x && b.x <= x))) continue;
        const t = (x - a.x) / (b.x - a.x), p = new THREE.Vector2(a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
        if (p.length() > minRadius && p.length() < maxRadius) points.set(p.toArray().map(v => Math.round(v * 1e8)).join(':'), p);
      }
    }
    const contour = [...points.values()].sort((a, b) => angle(a) - angle(b));
    assert.ok(contour.length > 100, 'slice includes the working tooth contour');
    return contour;
  };
  const radialBoundary = contour => {
    const angles = contour.map(angle);
    return query => {
      query = ((query % tau) + tau) % tau;
      let lo = 0, hi = contour.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (angles[mid] <= query) lo = mid + 1; else hi = mid; }
      const a = contour[(lo - 1 + contour.length) % contour.length], b = contour[lo % contour.length];
      return (a.x * b.y - a.y * b.x) / (Math.cos(query) * (b.y - a.y) - Math.sin(query) * (b.x - a.x));
    };
  };
  for (const detail of qualities) {
    const sunGeometry = createHelicalGearGeometry({ teeth: 30, pitchRadius: 0.6, width: 0.38, helixDegrees: 20, detail });
    const ringGeometry = createHelicalGearGeometry({ teeth: 78, pitchRadius: 1.56, width: 0.43, helixDegrees: -20, internal: true, detail });
    const planetGeometry = createHelicalGearGeometry({ teeth: 24, pitchRadius: 0.48, width: 0.3, helixDegrees: -20, detail });
    let sunResidual = -Infinity, ringResidual = -Infinity, incorrectPhaseResidual = -Infinity;
    for (const x of [-0.138, -0.073, 0, 0.073, 0.138]) {
      const sun = radialBoundary(crossSection(sunGeometry, x, 0.4, 0.8));
      const ring = radialBoundary(crossSection(ringGeometry, x, 1.4, 1.64));
      const planet = crossSection(planetGeometry, x, 0.3, 0.6);
      for (let phase = 0; phase < 64; phase += 1) {
        const sunAngle = phase / 64 * tau / 30, ringAngle = -phase / 64 * tau / 78;
        const planetAngle = -phase / 64 * tau / 24;
        for (let i = 0; i < planet.length; i += 1) for (let subdivision = 0; subdivision < 4; subdivision += 1) {
          const a = planet[i], b = planet[(i + 1) % planet.length];
          const p = a.clone().lerp(b, subdivision / 4).rotateAround(new THREE.Vector2(), planetAngle);
          p.add(new THREE.Vector2(Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)).multiplyScalar(1.08));
          sunResidual = Math.max(sunResidual, sun(Math.atan2(p.y, p.x) - sunAngle) - p.length());
          ringResidual = Math.max(ringResidual, p.length() - ring(Math.atan2(p.y, p.x) - ringAngle));
          if (x === 0 && phase === 0) {
            const incorrect = a.clone().rotateAround(new THREE.Vector2(), Math.PI / 24).add(new THREE.Vector2(Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)).multiplyScalar(1.08));
            incorrectPhaseResidual = Math.max(incorrectPhaseResidual, sun(Math.atan2(incorrect.y, incorrect.x)) - incorrect.length());
          }
        }
      }
    }
    // These are zero-backlash educational teeth. Polygon chords of the inner
    // ring have small contact residuals; this is not a CAD interference proof.
    assert.ok(Math.abs(sunResidual) < 1e-5, `${detail}: sun/planet contact ${sunResidual}`);
    assert.ok(ringResidual < module * { high: 0.025, balanced: 0.035, low: 0.045 }[detail], `${detail}: ring/planet tessellation residual ${ringResidual}`);
    assert.ok(incorrectPhaseResidual > module * 0.25, 'a mistaken half-tooth planet rotation must visibly fail the contact check');
    for (const geometry of [sunGeometry, ringGeometry, planetGeometry]) geometry.dispose();
  }
});
