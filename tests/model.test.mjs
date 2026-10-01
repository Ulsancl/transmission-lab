import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSMISSIONS, GEAR_TEETH, PLANETARY_TEETH, CVT_GEOMETRY, defaultSettings, normalizeSettings, createSimulator, cvtRadii, openBeltLength } from '../src/model.js';

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const power = (torque, rpm) => torque * rpm * 2 * Math.PI / 60000;
const snapshot = (type, partial = {}) => createSimulator({ ...defaultSettings(type), ...partial }).snapshot();
function numbersFinite(value) {
  for (const item of Object.values(value)) {
    if (typeof item === 'number') assert.ok(Number.isFinite(item));
    else if (item && typeof item === 'object') numbersFinite(item);
  }
}
function budget(s) {
  numbersFinite(s);
  close(s.outputPowerKW, power(s.outputTorque, s.outputRpm));
  close(s.inputPowerKW - s.outputPowerKW, s.lossPowerKW);
  assert.ok(s.lossPowerKW >= -1e-9, `${s.type} negative losses ${s.lossPowerKW}`);
  if (s.type !== 'ecvt') {
    close(s.inputPowerKW, power(s.inputTorque, s.inputRpm));
    close(s.clutchLossKW + s.gearLossKW, s.lossPowerKW);
  }
}
function planetary(s) {
  const { sun: ns, ring: nr, planet: np } = PLANETARY_TEETH;
  close((ns + nr) * s.carrierRpm, ns * s.sunRpm + nr * s.ringRpm);
  close(s.planetRpm - s.carrierRpm, -ns / np * (s.sunRpm - s.carrierRpm));
  close(np * (s.planetRpm - s.carrierRpm), nr * (s.ringRpm - s.carrierRpm));
  close(s.partRpm.planets, s.planetRpm - s.carrierRpm);
}

test('five transmission definitions have unique interactive part ids and valid defaults', () => {
  assert.deepEqual(Object.keys(TRANSMISSIONS), ['mt', 'dct', 'cvt', 'at', 'ecvt']);
  for (const [type, definition] of Object.entries(TRANSMISSIONS)) {
    assert.equal(new Set(definition.parts.map(part => part.id)).size, definition.parts.length);
    assert.ok(definition.gears.some(gear => gear.id === defaultSettings(type).gear));
    assert.ok(definition.lessons.length >= 3);
    const s = snapshot(type);
    for (const p of definition.parts) assert.ok(Number.isFinite(s.partRpm[p.id]), `${type}:${p.id} missing part RPM`);
    for (const id of s.activeParts) assert.ok(definition.parts.some(p => p.id === id), `${type}:${id} missing part definition`);
  }
});

test('part categories preserve distinct dry MT, wet DCT, hydraulic CVT/AT, and clutch-free eCVT structures', () => {
  const categories = new Set(['gears', 'clutches', 'bearings', 'lubrication', 'housing', 'electrical', 'input']);
  for (const definition of Object.values(TRANSMISSIONS)) {
    for (const p of definition.parts) assert.ok(categories.has(p.category), `${definition.id}:${p.id} invalid category`);
    for (const id of ['bearings', 'shaft-seals', 'oil-pan', 'oil-lines']) assert.ok(definition.parts.some(p => p.id === id));
  }
  assert.equal(TRANSMISSIONS.mt.clutchArchitecture, 'dry-single');
  assert.equal(TRANSMISSIONS.mt.lubricationMode, 'splash');
  for (const id of ['pressure-plate', 'diaphragm', 'release-bearing', 'release-fork']) assert.ok(TRANSMISSIONS.mt.parts.some(p => p.id === id));
  for (const id of ['oil-pump', 'oil-filter', 'valve-body']) assert.ok(!TRANSMISSIONS.mt.parts.some(p => p.id === id));
  assert.equal(TRANSMISSIONS.dct.clutchArchitecture, 'wet-dual');
  assert.ok(TRANSMISSIONS.dct.parts.some(p => p.id === 'cooler'));
  for (const id of ['forward-clutch', 'reverse-clutch', 'pulley-pistons']) assert.ok(TRANSMISSIONS.cvt.parts.some(p => p.id === id && p.category === 'clutches'));
  assert.ok(TRANSMISSIONS.at.parts.some(p => p.id === 'shift-clutches' && p.category === 'clutches'));
  assert.equal(TRANSMISSIONS.ecvt.clutchArchitecture, 'none');
  assert.equal(TRANSMISSIONS.ecvt.lubricationMode, 'motor-cooling');
  assert.ok(!TRANSMISSIONS.ecvt.parts.some(p => p.category === 'clutches' || p.id === 'valve-body'));
});

test('dry clutch friction disc follows gearbox input while pressure plate and spring follow engine', () => {
  for (const clutch of [0, 0.5, 1]) {
    const s = snapshot('mt', { rpm: 2400, clutch });
    close(s.partRpm.clutch, 2400 * clutch);
    close(s.partRpm['pressure-plate'], 2400);
    close(s.partRpm.diaphragm, 2400);
    close(s.releaseBearing.contactRpm, 2400);
    assert.equal(s.releaseBearing.housingRpm, 0);
    close(s.releaseBearing.releaseFraction, 1 - clutch);
    assert.equal(s.partRpm['release-fork'], 0);
    budget(s);
  }
});

test('bearing outer races stay fixed while each inner race follows its actual shaft', () => {
  for (const type of Object.keys(TRANSMISSIONS)) {
    const s = snapshot(type);
    for (const [shaft, races] of Object.entries(s.bearingRpm)) {
      close(races.inner, s.partRpm[shaft]);
      assert.equal(races.outer, 0);
    }
    assert.equal(s.partRpm.bearings, 0);
    assert.equal(s.partRpm['shaft-seals'], 0);
    assert.equal(s.lubrication.schematic, true);
    assert.equal(s.lubrication.pressureSolved, false);
    assert.equal(s.lubrication.flowSolved, false);
    assert.equal(s.lubrication.temperatureSolved, false);
    budget(s);
  }
});

test('representative mechanical pumps run from engine in neutral and eCVT pump has no invented speed', () => {
  for (const type of ['dct', 'cvt', 'at']) {
    const s = snapshot(type, { gear: 'N', rpm: 2200 });
    close(s.partRpm['oil-pump'], 2200);
    assert.ok(s.activeParts.includes('oil-pump'));
    assert.equal(s.outputPowerKW, 0);
    budget(s);
  }
  const hybrid = snapshot('ecvt');
  assert.equal(hybrid.partRpm['oil-pump'], 0);
  assert.ok(!hybrid.activeParts.some(id => id.includes('clutch')));
});

test('invalid saved settings fall back without unsafe types, NaN, or unknown gears', () => {
  assert.deepEqual(normalizeSettings(null), defaultSettings('dct'));
  const normalized = normalizeSettings({ type: 'ecvt', rpm: Infinity, torque: NaN, mg1Rpm: -Infinity, clutch: null, gear: 'R', converterLock: 'true', efficiency: 20, mg2Torque: '-500', cvtRatio: '2.3' });
  assert.equal(normalized.rpm, 1800);
  assert.equal(normalized.torque, 140);
  assert.equal(normalized.mg1Rpm, 2000);
  assert.equal(normalized.clutch, 1);
  assert.equal(normalized.gear, 'D');
  assert.equal(normalized.converterLock, false);
  assert.equal(normalized.efficiency, 1);
  assert.equal(normalized.mg2Torque, -200);
  assert.equal(normalized.cvtRatio, 2.3);
  assert.equal(normalizeSettings({ type: '__proto__' }).type, 'dct');
});

test('MT all six forward tooth ratios obey external mesh and final drive signs', () => {
  for (let gear = 1; gear <= 6; gear++) {
    const s = snapshot('mt', { gear: String(gear), rpm: 3000, torque: 150, efficiency: 1 });
    const [inputTeeth, outputTeeth] = GEAR_TEETH[gear];
    close(s.ratio, outputTeeth / inputTeeth);
    close(s.outputRpm, 3000 * inputTeeth / outputTeeth);
    close(s.outputTorque, 150 * outputTeeth / inputTeeth);
    assert.ok(s.partRpm['output-shaft'] < 0);
    close(s.partRpm[`gear-${gear}-output`], s.partRpm['output-shaft']);
    close(s.partRpm['final-drive'], -s.partRpm['output-shaft']);
    budget(s);
  }
});

test('MT reverse flips output while delivering positive shaft power', () => {
  const s = snapshot('mt', { gear: 'R' });
  assert.ok(s.outputRpm < 0 && s.outputTorque < 0 && s.outputPowerKW > 0);
  assert.ok(s.partRpm['output-shaft'] > 0);
  budget(s);
});

test('neutral and fully open clutch transmit no torque or power', () => {
  for (const type of ['mt', 'dct', 'cvt', 'at']) {
    const s = snapshot(type, { gear: 'N' });
    assert.equal(s.outputRpm, 0);
    assert.equal(s.inputTorque, 0);
    assert.equal(s.outputTorque, 0);
    assert.equal(s.inputPowerKW, 0);
    budget(s);
  }
  for (const type of ['mt', 'dct', 'cvt']) {
    const s = snapshot(type, { clutch: 0 });
    assert.equal(s.outputRpm, 0);
    assert.equal(s.inputTorque, 0);
    assert.equal(s.outputTorque, 0);
    budget(s);
  }
});

test('partial clutch has explicit slip energy rather than creating power', () => {
  const s = snapshot('mt', { clutch: 0.5, rpm: 2000, torque: 120, efficiency: 0.96 });
  close(s.inputTorque, 60);
  close(s.partRpm['input-shaft'], 1000);
  close(s.clutchLossKW, power(60, 1000));
  close(s.outputPowerKW, s.inputPowerKW * 0.5 * 0.96);
  budget(s);
});

test('DCT inactive preselected branch is mechanically backdriven by output', () => {
  const s = snapshot('dct', { gear: '1' });
  assert.equal(s.clutchA, 1);
  assert.equal(s.clutchB, 0);
  assert.equal(s.selectedA, '1');
  assert.equal(s.selectedB, '2');
  assert.equal(s.nextGear, '2');
  assert.ok(s.partRpm['shaft-b'] > 0);
  close(s.partRpm['shaft-b'], s.outputRpm * GEAR_TEETH['2'][1] / GEAR_TEETH['2'][0]);
  close(s.partRpm['gear-2-output'], s.partRpm['output-shaft']);
  assert.ok(!s.activeParts.includes('clutch-b'));
  budget(s);
});

test('DCT selected mechanical ratio remains separate from controlled clutch slip', () => {
  const s = snapshot('dct', { gear: '2', clutch: 0.5 });
  close(s.ratio, 56 / 24);
  close(s.kinematicInputOutputRatio, 2 * s.ratio);
  budget(s);
});

test('DCT alternating-clutch handover conserves power at every transition sample', () => {
  const sim = createSimulator(defaultSettings('dct'));
  sim.setSettings({ gear: '2' });
  const initial = sim.snapshot();
  assert.equal(initial.shiftFrom, '1'); assert.equal(initial.shiftTo, '2');
  close(initial.clutchA, 1); close(initial.clutchB, 0);
  for (let i = 0; i < 84; i++) {
    const s = sim.step(0.01);
    close(s.clutchA + s.clutchB, 1);
    assert.ok(s.partRpm['shaft-a'] <= s.inputRpm + 1e-8);
    assert.ok(s.partRpm['shaft-b'] <= s.inputRpm + 1e-8);
    budget(s);
  }
  const done = sim.step(0.01);
  close(done.clutchA, 0); close(done.clutchB, 1);
  assert.equal(done.nextGear, '3');
  assert.equal(done.shiftProgress, 1);
  close(done.outputRpm, done.inputRpm / (56 / 24));
  budget(done);
});

test('DCT same-branch skip opens clutch before selecting the new gear', () => {
  const sim = createSimulator(defaultSettings('dct'));
  sim.setSettings({ gear: '3' });
  const middle = sim.step(0.425);
  close(middle.clutchA, 0);
  close(middle.clutchB, 0);
  close(middle.outputTorque, 0);
  budget(middle);
  const after = sim.step(0.425);
  assert.equal(after.selectedA, '3');
  assert.equal(after.clutchA, 1);
  assert.equal(after.nextGear, '4');
  budget(after);
});

test('DCT direction change and neutral never overlap contradictory clutch paths', () => {
  const sim = createSimulator(defaultSettings('dct'));
  sim.setSettings({ gear: '2' });
  sim.step(0.3);
  const reverse = sim.setSettings({ gear: 'R' });
  assert.equal(reverse.shiftProgress, 1);
  assert.equal(reverse.clutchA, 0);
  assert.equal(reverse.clutchB, 1);
  assert.ok(reverse.outputRpm < 0 && reverse.outputTorque < 0);
  budget(reverse);
  budget(sim.setSettings({ gear: 'N' }));
});

test('CVT exact tangent-and-arc belt length stays constant across continuous ratios', () => {
  for (let i = 0; i <= 300; i++) {
    const ratio = 0.45 + (2.8 - 0.45) * i / 300;
    const radii = cvtRadii(ratio);
    close(radii.secondaryRadius / radii.primaryRadius, ratio);
    close(openBeltLength(radii.primaryRadius, radii.secondaryRadius), CVT_GEOMETRY.beltLength, 1e-12);
    assert.ok(radii.primaryRadius > 0.02 && radii.secondaryRadius > 0.02);
    const s = snapshot('cvt', { cvtRatio: ratio });
    close(s.beltSpeed, s.partRpm.primary * 2 * Math.PI / 60 * s.primaryRadius);
    close(s.beltSpeed, s.partRpm.secondary * 2 * Math.PI / 60 * s.secondaryRadius);
    assert.equal(s.partRpm.belt, 0);
    budget(s);
  }
});

test('CVT reversal keeps belt uncrossed, pulleys same direction, and power positive', () => {
  const s = snapshot('cvt', { gear: 'R' });
  assert.ok(s.partRpm.primary < 0 && s.partRpm.secondary < 0 && s.beltSpeed < 0);
  assert.ok(s.outputTorque < 0 && s.outputPowerKW > 0);
  budget(s);
});

test('AT each hold/drive/output configuration satisfies planetary constraints', () => {
  const expected = { '1': [3.6, 'ring', 'sun', 'carrier'], '2': [108 / 78, 'sun', 'ring', 'carrier'], '3': [1, null, 'sun', 'carrier'], '4': [78 / 108, 'sun', 'carrier', 'ring'], R: [-2.6, 'carrier', 'sun', 'ring'] };
  for (const [gear, [ratio, hold, input, output]] of Object.entries(expected)) {
    const s = snapshot('at', { gear, converterLock: true });
    close(s.ratio, ratio);
    assert.equal(s.heldElement, hold);
    assert.deepEqual(s.activePorts, { input, output });
    if (hold) assert.equal(s.partRpm[hold], 0);
    close(s.partRpm[input], s.inputRpm);
    close(s.partRpm[output], s.outputRpm);
    planetary(s); budget(s);
  }
});

test('AT converter lock removes only converter slip loss', () => {
  const unlocked = snapshot('at', { converterSlip: 0.3 });
  const locked = snapshot('at', { converterSlip: 0.3, converterLock: true });
  close(unlocked.turbineRpm, unlocked.inputRpm * 0.7);
  close(unlocked.partRpm.input, unlocked.turbineRpm);
  close(locked.turbineRpm, locked.inputRpm);
  close(locked.clutchLossKW, 0);
  assert.ok(unlocked.clutchLossKW > 0 && unlocked.outputPowerKW < locked.outputPowerKW);
  close(unlocked.outputTorque, locked.outputTorque);
  planetary(unlocked); planetary(locked); budget(unlocked); budget(locked);
});

test('eCVT output speed follows independent engine and MG1 speed commands', () => {
  const slowSun = snapshot('ecvt', { mg1Rpm: 0 });
  const fastSun = snapshot('ecvt', { mg1Rpm: 4000 });
  assert.ok(slowSun.outputRpm > fastSun.outputRpm);
  close(slowSun.carrierRpm, slowSun.inputRpm);
  close(fastSun.sunRpm, 4000);
  planetary(slowSun); planetary(fastSun); budget(slowSun); budget(fastSun);
});

test('eCVT motor assist, regeneration, and reversed electrical circulation conserve full system power', () => {
  for (const mg1Rpm of [-10000, -3000, 0, 2000, 6480, 10000]) {
    for (const mg2Torque of [-200, -40, 0, 40, 200]) {
      const s = snapshot('ecvt', { mg1Rpm, mg2Torque });
      close(s.inputPowerKW, s.enginePowerKW + s.batteryPowerKW);
      close(s.enginePowerKW - s.mg1PowerKW, power(s.engineRingTorque, s.ringRpm));
      close(s.lossPowerKW, s.electricalLossKW + s.gearLossKW);
      assert.ok(s.electricalLossKW >= -1e-9);
      planetary(s); budget(s);
    }
  }
  assert.ok(snapshot('ecvt', { mg1Rpm: -3000 }).mg1PowerKW < 0);
  assert.ok(snapshot('ecvt', { mg2Torque: 200 }).batteryPowerKW > 0);
  assert.ok(snapshot('ecvt', { mg2Torque: -200 }).batteryPowerKW < 0);
});

test('eCVT standstill has finite ratio sentinel and nonzero static torque', () => {
  const s = snapshot('ecvt', { rpm: 1800, mg1Rpm: 6480 });
  close(s.outputRpm, 0);
  assert.equal(s.ratio, 0);
  assert.ok(s.outputTorque > 0);
  close(s.outputPowerKW, 0);
  planetary(s); budget(s);
});

test('changing transmission uses type defaults and reset preserves current controls', () => {
  const sim = createSimulator(defaultSettings('dct'));
  sim.setSettings({ gear: '6' }); sim.step(0.2);
  const changed = sim.setSettings({ type: 'cvt' });
  assert.equal(changed.type, 'cvt'); assert.equal(changed.gear, 'D'); assert.equal(changed.time, 0);
  sim.setSettings({ cvtRatio: 2.1, rpm: 2400 }); sim.step(0.5);
  const reset = sim.reset();
  assert.equal(reset.time, 0); close(reset.ratio, 2.1); assert.equal(reset.inputRpm, 2400);
  sim.step(NaN); sim.step(-5); assert.equal(sim.snapshot().time, 0);
  sim.step(Infinity); assert.equal(sim.snapshot().time, 0);
  sim.step(10000); assert.equal(sim.snapshot().time, 1);
});

test('deterministic broad operating envelope has finite, nonnegative-loss snapshots', () => {
  let seed = 456781;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const type of Object.keys(TRANSMISSIONS)) {
    const sim = createSimulator(defaultSettings(type));
    const gears = TRANSMISSIONS[type].gears;
    for (let i = 0; i < 400; i++) {
      sim.setSettings({ gear: gears[Math.floor(rand() * gears.length)].id, rpm: rand() * 7000, torque: rand() * 400, clutch: rand(), cvtRatio: 0.45 + rand() * 2.35, converterLock: rand() > 0.5, converterSlip: rand() * 0.85, mg1Rpm: rand() * 20000 - 10000, mg2Torque: rand() * 400 - 200, efficiency: 0.7 + rand() * 0.3 });
      const s = sim.step(rand());
      budget(s);
      if (type === 'at' || type === 'ecvt') planetary(s);
    }
  }
});
