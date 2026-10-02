const TAU = Math.PI * 2;

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function teeth(value, name) {
  if (!Number.isSafeInteger(value) || value < 3) throw new RangeError(`${name} must be an integer of at least 3`);
  return value;
}

/** Ideal radial ball bearing: zero contact angle, rigid races, no slip.
 * Ratios use ball radius / ball-centre pitch radius, not shaft radius.
 * A ball parented to the cage needs the relative ratio; its world spin is
 * the sum of its own rotation and the cage parent's rotation.
 */
export function radialBearingRatios({ pitchRadius, ballRadius }) {
  finite(pitchRadius, 'pitchRadius'); finite(ballRadius, 'ballRadius');
  if (pitchRadius <= 0 || ballRadius <= 0 || ballRadius >= pitchRadius) {
    throw new RangeError('require 0 < ballRadius < pitchRadius');
  }
  const q = ballRadius / pitchRadius;
  const cageInner = (1 - q) / 2, cageOuter = (1 + q) / 2;
  const relativeMagnitude = (1 / q - q) / 2;
  if (!Number.isFinite(relativeMagnitude)) throw new RangeError('bearing radius ratio exceeds finite precision');
  return Object.freeze({
    cageInner, cageOuter,
    ballRelativeInner: -relativeMagnitude, ballRelativeOuter: relativeMagnitude,
    ballWorldInner: cageInner - relativeMagnitude,
    ballWorldOuter: cageOuter + relativeMagnitude,
  });
}

export function radialBearingKinematics({ pitchRadius, ballRadius, innerRpm = 0, outerRpm = 0 }) {
  finite(innerRpm, 'innerRpm'); finite(outerRpm, 'outerRpm');
  const ratios = radialBearingRatios({ pitchRadius, ballRadius });
  const cageRpm = ratios.cageInner * innerRpm + ratios.cageOuter * outerRpm;
  const ballRelativeRpm = ratios.ballRelativeInner * innerRpm + ratios.ballRelativeOuter * outerRpm;
  const ballWorldRpm = cageRpm + ballRelativeRpm;
  if (![cageRpm, ballRelativeRpm, ballWorldRpm].every(Number.isFinite)) {
    throw new RangeError('bearing speeds exceed finite precision');
  }
  return Object.freeze({
    cageRpm, ballRelativeRpm, ballWorldRpm,
    innerContactRadius: pitchRadius - ballRadius,
    outerContactRadius: pitchRadius + ballRadius,
    ratios,
  });
}

/** Initial phase of an external driven gear, modulo one driven tooth pitch.
 * All angles are about the same +X axis. centerAngleRad is the direction
 * from driver centre to driven centre in the local YZ plane, measured from
 * +Y toward +Z. Profiles place a tooth centre at angle zero.
 * This aligns tooth/gap phases; it does not certify tooth-profile clearance.
 */
export function externalGearDrivenPhase({ driverTeeth, drivenTeeth, centerAngleRad, driverAngleRad = 0 }) {
  teeth(driverTeeth, 'driverTeeth'); teeth(drivenTeeth, 'drivenTeeth');
  finite(centerAngleRad, 'centerAngleRad'); finite(driverAngleRad, 'driverAngleRad');
  const center = centerAngleRad % TAU, driver = driverAngleRad % TAU;
  const toothPhase = ((driverTeeth + drivenTeeth) * center + drivenTeeth * Math.PI - Math.PI - driverTeeth * driver) % TAU;
  const phase = ((toothPhase + TAU) % TAU) / drivenTeeth;
  return Object.is(phase, -0) ? 0 : phase;
}
