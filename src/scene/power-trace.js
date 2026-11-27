import * as THREE from 'three';

const up = new THREE.Vector3(0, 1, 0);

// Survey lines follow the model's connection points. Arrows mark power direction
// at a readable display speed, independent of shaft and belt animation speeds.
export function createPowerTrace({ id, ports, points, color, power }) {
  const group = new THREE.Group();
  group.visible = false;
  const vertices = points.map(p => new THREE.Vector3(...p));
  const lineMaterial = new THREE.LineBasicMaterial({
    color, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
  });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices), lineMaterial);
  line.frustumCulled = false;
  line.renderOrder = 30;
  group.add(line);
  const arrowMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.12),
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
  });
  const head = new THREE.ConeGeometry(0.064, 0.195, 10);
  const arrows = Array.from({ length: 7 }, () => {
    const arrow = new THREE.Mesh(head, arrowMaterial);
    arrow.renderOrder = 31;
    group.add(arrow);
    return arrow;
  });
  const lengths = new Float32Array(points.length);
  const direction = new THREE.Vector3();
  let distance = 0, phase = 0, signedKW = 0;

  function measure() {
    for (let i = 1; i < vertices.length; i += 1) {
      lengths[i] = lengths[i - 1] + vertices[i].distanceTo(vertices[i - 1]);
    }
    distance = lengths.at(-1);
  }
  measure();

  function setPoints(newPoints) {
    const positions = line.geometry.attributes.position;
    for (let i = 0; i < vertices.length; i += 1) {
      vertices[i].set(...newPoints[i]);
      positions.setXYZ(i, ...newPoints[i]);
    }
    positions.needsUpdate = true;
    measure();
  }

  function update(snapshot, enabled, dt, speed) {
    signedKW = power(snapshot);
    group.visible = enabled && Number.isFinite(signedKW) && Math.abs(signedKW) > 1e-5;
    if (!group.visible) return;
    const count = Math.min(arrows.length, Math.max(1, Math.round(distance / 0.65)));
    const strength = THREE.MathUtils.clamp(Math.sqrt(Math.abs(signedKW) / 40), 0.16, 1);
    lineMaterial.opacity = 0.38 + strength * 0.34;
    arrowMaterial.opacity = 0.78 + strength * 0.22;
    const sign = Math.sign(signedKW);
    phase = ((phase + sign * dt * speed * 65 / distance) % 1 + 1) % 1;
    for (let i = 0; i < arrows.length; i += 1) {
      const arrow = arrows[i];
      arrow.visible = i < count;
      if (!arrow.visible) continue;
      const at = ((phase + (i + 0.5) / count) % 1) * distance;
      let end = 1;
      while (end < lengths.length - 1 && lengths[end] <= at) end += 1;
      const a = vertices[end - 1], b = vertices[end];
      arrow.position.copy(a).lerp(b, (at - lengths[end - 1]) / (lengths[end] - lengths[end - 1]));
      direction.subVectors(b, a).normalize().multiplyScalar(sign);
      arrow.quaternion.setFromUnitVectors(up, direction);
    }
  }

  return {
    id, ports, group, setPoints, update,
    diagnostics: () => ({
      id, ports, visible: group.visible, signedKW: Number.isFinite(signedKW) ? signedKW : 0,
      direction: Math.sign(signedKW) || 0, phase, points: vertices.map(p => p.toArray()),
    }),
  };
}
