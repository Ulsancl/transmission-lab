import test from 'node:test';
import assert from 'node:assert/strict';
import { radialBearingRatios, radialBearingKinematics, externalGearDrivenPhase } from '../src/mechanical-motion.js';

const TAU = Math.PI * 2;
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const phaseResidual = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

test('bearing cage and ball world velocities satisfy both independent no-slip contacts', () => {
  for (const shaftRadius of [.125, .145, .18, .3]) {
    const pitchRadius = shaftRadius + .128, ballRadius = .048;
    for (const [innerRpm, outerRpm] of [[1000, 0], [-700, 0], [0, 1000], [1200, -400], [-500, -1800], [860, 860], [0, 0]]) {
      const motion = radialBearingKinematics({ pitchRadius, ballRadius, innerRpm, outerRpm });
      // RPM-to-rad/s is common to all terms and cancels. The ball's inward
      // and outward contact points have opposite spin-induced velocities.
      const centreVelocity = motion.cageRpm * pitchRadius;
      near(centreVelocity - motion.ballWorldRpm * ballRadius, innerRpm * (pitchRadius - ballRadius));
      near(centreVelocity + motion.ballWorldRpm * ballRadius, outerRpm * (pitchRadius + ballRadius));
      near(motion.ballWorldRpm, motion.cageRpm + motion.ballRelativeRpm);
      near(motion.innerContactRadius, pitchRadius - ballRadius);
      near(motion.outerContactRadius, pitchRadius + ballRadius);
    }
  }
});

test('cage-parented ball rotation preserves no-slip travel over multiple frame partitions', () => {
  const pitchRadius = .273, ballRadius = .048, innerRpm = -1300, outerRpm = 250;
  const motion = radialBearingKinematics({ pitchRadius, ballRadius, innerRpm, outerRpm });
  const radiansPerRpmSecond = TAU / 60;
  for (const frames of [[1.3], [.1, .2, .4, .6], Array.from({ length: 130 }, () => .01)]) {
    let cageAngle = 0, relativeAngle = 0, time = 0;
    for (const dt of frames) {
      time += dt;
      cageAngle += motion.cageRpm * radiansPerRpmSecond * dt;
      relativeAngle += motion.ballRelativeRpm * radiansPerRpmSecond * dt;
    }
    const worldSpin = cageAngle + relativeAngle;
    near(cageAngle * pitchRadius - worldSpin * ballRadius, innerRpm * radiansPerRpmSecond * time * (pitchRadius - ballRadius));
    near(cageAngle * pitchRadius + worldSpin * ballRadius, outerRpm * radiansPerRpmSecond * time * (pitchRadius + ballRadius));
  }
});

test('stationary outer race exposes geometry-derived rotor multipliers and signed reversal', () => {
  const radii = { pitchRadius: .273, ballRadius: .048 };
  const ratios = radialBearingRatios(radii);
  near(ratios.cageInner, 75 / 182);
  const forward = radialBearingKinematics({ ...radii, innerRpm: 1000 });
  const reverse = radialBearingKinematics({ ...radii, innerRpm: -1000 });
  for (const key of ['cageRpm', 'ballRelativeRpm', 'ballWorldRpm']) near(reverse[key], -forward[key]);
  near(forward.cageRpm, ratios.cageInner * 1000);
  near(forward.ballRelativeRpm, ratios.ballRelativeInner * 1000);
  near(forward.ballWorldRpm, ratios.ballWorldInner * 1000);
  const sameSpeed = radialBearingKinematics({ ...radii, innerRpm: 1234, outerRpm: 1234 });
  near(sameSpeed.cageRpm, 1234); near(sameSpeed.ballRelativeRpm, 0); near(sameSpeed.ballWorldRpm, 1234);
});

test('bearing motion rejects invalid radii and non-finite speeds', () => {
  for (const [pitchRadius, ballRadius] of [[0, .048], [.273, 0], [.048, .048], [.04, .048], [Infinity, .048], [.273, NaN]]) {
    assert.throws(() => radialBearingRatios({ pitchRadius, ballRadius }));
  }
  for (const value of [Infinity, NaN, '1000']) {
    assert.throws(() => radialBearingKinematics({ pitchRadius: .273, ballRadius: .048, innerRpm: value }));
    assert.throws(() => radialBearingKinematics({ pitchRadius: .273, ballRadius: .048, outerRpm: value }));
  }
});

test('external gear phases oppose teeth and gaps for final drive and offset reverse meshes', () => {
  const cases = [[32, 32, Math.PI], [18, 18, Math.atan2(.527913, .4104 - .9)], [18, 62, Math.atan2(-.527913, -1.1 - .4104)], [17, 31, -.7]];
  for (const [driverTeeth, drivenTeeth, centerAngleRad] of cases) for (const driverAngleRad of [0, .13, -2.4, 8.2]) {
    const phase = externalGearDrivenPhase({ driverTeeth, drivenTeeth, centerAngleRad, driverAngleRad });
    assert.ok(phase >= 0 && phase < TAU / drivenTeeth);
    // Tooth phase viewed at the mutual pitch contact must differ by a
    // half-pitch, including the opposite-facing side of the driven gear.
    near(phaseResidual(driverTeeth * (centerAngleRad - driverAngleRad)
      + drivenTeeth * (centerAngleRad + Math.PI - phase) - Math.PI), 0);
  }
  near(externalGearDrivenPhase({ driverTeeth: 32, drivenTeeth: 32, centerAngleRad: Math.PI }), Math.PI / 32);
});

test('current planetary 30-degree placement stays phased through carrier rotation and helical width', () => {
  const ns = 30, np = 24, nr = 78;
  for (const initialCenter of [0, Math.PI / 6]) for (let i = 0; i < 3; i++) {
    const centreBase = initialCenter + i * TAU / 3;
    const initialPlanet = externalGearDrivenPhase({ driverTeeth: ns, drivenTeeth: np, centerAngleRad: centreBase });
    if (initialCenter === Math.PI / 6) near(phaseResidual(np * initialPlanet), 0);
    else near(initialPlanet, Math.PI / np);
    for (const sunAngle of [0, .7, 5, -3]) for (const carrierAngle of [0, .4, -1]) for (const x of [-.15, 0, .15]) {
      const centre = centreBase + carrierAngle;
      const sun = sunAngle + x * Math.tan(20 * Math.PI / 180) / .6;
      const planet = carrierAngle + initialPlanet - ns / np * (sunAngle - carrierAngle) + x * Math.tan(-20 * Math.PI / 180) / .48;
      const ring = ((ns + nr) * carrierAngle - ns * sunAngle) / nr + x * Math.tan(-20 * Math.PI / 180) / 1.56;
      near(phaseResidual(ns * sun + np * planet - (ns + np) * centre + Math.PI), 0);
      near(phaseResidual(nr * ring - np * planet - (nr - np) * centre + Math.PI), 0);
    }
  }
});

test('gear phases reject invalid tooth counts and angles', () => {
  for (const driverTeeth of [0, 2, 30.5, Infinity]) assert.throws(() => externalGearDrivenPhase({ driverTeeth, drivenTeeth: 32, centerAngleRad: 0 }));
  assert.throws(() => externalGearDrivenPhase({ driverTeeth: 32, drivenTeeth: 2, centerAngleRad: 0 }));
  assert.throws(() => externalGearDrivenPhase({ driverTeeth: 32, drivenTeeth: 32, centerAngleRad: NaN }));
  assert.throws(() => externalGearDrivenPhase({ driverTeeth: 32, drivenTeeth: 32, centerAngleRad: 0, driverAngleRad: Infinity }));
});
