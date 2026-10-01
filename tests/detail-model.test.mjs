import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSMISSIONS, GEAR_TEETH, PLANETARY_TEETH, CVT_GEOMETRY, createSimulator, defaultSettings } from '../src/model.js';

const power = (torque, rpm) => torque * rpm * Math.PI * 2 / 60000;
const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const snapshot = (type, settings = {}) => createSimulator({ ...defaultSettings(type), ...settings }).snapshot();
const sum = (values, key) => values.reduce((total, value) => total + value[key], 0);

function verifyDetail(s) {
  const d = s.detail;
  close(d.outputLoadTorqueNm, -s.outputTorque);
  close(d.powerBalanceResidualKW, 0);
  close(d.slipLossKW + d.mechanicalLossKW + d.electricalLossKW, s.lossPowerKW);
  close(sum(d.couplings, 'heatKW'), s.clutchLossKW);
  close(sum(d.powerPaths, 'lossPowerKW'), s.lossPowerKW);
  for (const c of d.couplings) {
    close(c.inputRpm - c.outputRpm, c.slipRpm);
    close(c.heatKW, power(c.transmittedTorqueNm, c.slipRpm));
    assert.ok(c.heatKW >= -1e-9);
  }
  for (const p of d.powerPaths) {
    close(p.inputPowerKW - p.outputPowerKW, p.lossPowerKW);
    assert.ok(p.lossPowerKW >= -1e-9);
  }
  if (s.type !== 'ecvt') {
    close(sum(d.powerPaths, 'inputPowerKW'), s.inputPowerKW);
    close(sum(d.powerPaths, 'outputPowerKW'), s.outputPowerKW);
  }
  if (d.idealPlanetaryTorques) {
    const t = d.idealPlanetaryTorques;
    close(t.sun + t.ring + t.carrier, 0);
    close(power(t.sun, s.sunRpm) + power(t.ring, s.ringRpm) + power(t.carrier, s.carrierRpm), 0);
    close(t.torqueBalanceResidualNm, 0);
    close(t.powerBalanceResidualKW, 0);
    assert.equal(t.holdingPowerKW, 0);
  }
  function finite(value) {
    for (const item of Object.values(value)) {
      if (typeof item === 'number') assert.ok(Number.isFinite(item));
      else if (item && typeof item === 'object') finite(item);
    }
  }
  finite(d);
}

test('detail balances preserve all modes, neutral, static torque, zero torque, and extremes', () => {
  for (const type of Object.keys(TRANSMISSIONS)) {
    for (const gear of TRANSMISSIONS[type].gears) {
      for (const rpm of [0, 1800, 7000]) {
        for (const torque of [0, 140, 400]) {
          for (const clutch of [0, 0.45, 1]) {
            verifyDetail(snapshot(type, { gear: gear.id, rpm, torque, clutch }));
          }
        }
      }
    }
  }
});

test('MT neutral distinguishes a closed rotating clutch from an unloaded selected gear', () => {
  const neutral = snapshot('mt', { gear: 'N', rpm: 3000, clutch: 1 });
  const c = neutral.detail.couplings[0];
  assert.equal(c.state, 'locked');
  assert.equal(c.transmittedTorqueNm, 0);
  assert.equal(c.heatKW, 0);
  assert.ok(neutral.detail.mesh.every(m => !m.loaded && m.frequencyHz > 0));
  const partial = snapshot('mt', { rpm: 3000, clutch: 0.4 });
  assert.equal(partial.detail.couplings[0].state, 'slipping');
  close(partial.detail.couplings[0].slipRpm, 1800);
  close(partial.detail.couplings[0].heatKW, power(56, 1800));
});

test('constant-mesh tooth-passage rate agrees at both gear members including reverse idler', () => {
  for (const type of ['mt', 'dct']) {
    for (const gear of ['1', '2', '6', 'R']) {
      const s = snapshot(type, { gear });
      for (const m of s.detail.mesh) {
        const id = m.id.slice(5);
        const [inputTeeth, outputTeeth] = GEAR_TEETH[id];
        close(m.frequencyHz, Math.abs(s.partRpm[`${m.id}-input`]) * inputTeeth / 60);
        close(m.frequencyHz, Math.abs(s.partRpm[`${m.id}-output`]) * outputTeeth / 60);
        assert.equal(m.loaded, id === gear);
      }
      const reverse = s.detail.mesh.find(m => m.id === 'gear-R');
      close(reverse.frequencyHz, Math.abs(s.partRpm['reverse-idler']) * 18 / 60);
      assert.ok(reverse.partIds.includes('reverse-idler'));
    }
  }
});

test('DCT open preselected clutch may overrun engine without creating negative heat', () => {
  const s = snapshot('dct', { gear: '6' });
  const open = s.detail.couplings.find(c => c.id === 'clutch-a');
  assert.equal(open.state, 'open');
  assert.ok(open.outputRpm > open.inputRpm);
  assert.ok(open.slipRpm < 0);
  assert.equal(open.heatKW, 0);
  assert.equal(open.transmittedTorqueNm, 0);
  verifyDetail(s);
});

test('DCT branch heat and power sum through upshift, downshift, same-bank skip and interruption', () => {
  for (const [from, to] of [['1', '2'], ['2', '1'], ['5', '6'], ['6', '5'], ['1', '3'], ['6', '2']]) {
    const sim = createSimulator({ ...defaultSettings('dct'), gear: from });
    sim.setSettings({ gear: to });
    for (let i = 0; i < 85; i++) verifyDetail(sim.step(0.01));
  }
  const sim = createSimulator(defaultSettings('dct'));
  sim.setSettings({ gear: '2' }); sim.step(0.3);
  verifyDetail(sim.setSettings({ gear: '4' }));
  verifyDetail(sim.step(0.2));
  verifyDetail(sim.setSettings({ gear: 'R' }));
  verifyDetail(sim.setSettings({ gear: 'N' }));
});

test('CVT wrap arcs plus tangents reproduce fixed belt length and ideal force conserves power', () => {
  for (const gear of ['D', 'R', 'N']) {
    for (const cvtRatio of [0.45, 0.75, 1, 1.5, 2.8]) {
      for (const rpm of [0, 2400]) {
        const s = snapshot('cvt', { gear, cvtRatio, rpm, clutch: 0.6 });
        const b = s.detail.belt;
        close(b.primaryWrapDeg + b.secondaryWrapDeg, 360);
        close(2 * b.tangentLengthM + b.primaryWrapDeg * Math.PI / 180 * s.primaryRadius + b.secondaryWrapDeg * Math.PI / 180 * s.secondaryRadius, CVT_GEOMETRY.beltLength, 1e-12);
        close(b.primaryTorqueNm, (gear === 'R' ? -1 : 1) * s.inputTorque);
        close(b.idealSecondaryTorqueNm * s.efficiency, s.outputTorque);
        close(b.tangentialForceN * s.beltSpeed / 1000, s.inputPowerKW - s.clutchLossKW);
        close(b.contactSpeedResidualMps, 0);
        close(b.circulationHz * CVT_GEOMETRY.beltLength, Math.abs(s.beltSpeed));
        assert.equal(b.tensionSolved, false);
        assert.equal(b.tractionLimitSolved, false);
        if (cvtRatio > 1) assert.ok(b.secondaryWrapDeg > b.primaryWrapDeg);
        if (cvtRatio < 1) assert.ok(b.secondaryWrapDeg < b.primaryWrapDeg);
        verifyDetail(s);
      }
    }
  }
});

test('CVT reverse uses equivalent upstream clutch speed so reversing does not invent heat', () => {
  for (const clutch of [0, 0.4, 1]) {
    const forward = snapshot('cvt', { gear: 'D', clutch });
    const reverse = snapshot('cvt', { gear: 'R', clutch });
    close(reverse.detail.couplings[0].heatKW, forward.detail.couplings[0].heatKW);
    close(reverse.detail.couplings[0].slipRpm, forward.detail.couplings[0].slipRpm);
    close(reverse.detail.belt.tangentialForceN, -forward.detail.belt.tangentialForceN);
  }
});

test('ideal planetary brake reactions balance torque while a held brake consumes zero power', () => {
  const reactions = { '1': 364, '2': 140 * 30 / 78, '4': -140 * 30 / 108, R: -504 };
  for (const [gear, holdingTorqueNm] of Object.entries(reactions)) {
    const s = snapshot('at', { gear, torque: 140 });
    const t = s.detail.idealPlanetaryTorques;
    close(t.holdingTorqueNm, holdingTorqueNm);
    close(t[s.activePorts.input], 140);
    close(-t[s.activePorts.output] * s.efficiency, s.outputTorque);
    assert.equal(t.holdingElement, s.heldElement);
    close(t.holdingPowerKW, 0);
    verifyDetail(s);
  }
  for (const gear of ['N', '3']) assert.equal(snapshot('at', { gear }).detail.idealPlanetaryTorques, null);
});

test('planetary tooth-passage rate uses carrier-relative RPM and vanishes in direct drive', () => {
  for (const type of ['at', 'ecvt']) {
    const s = snapshot(type);
    close(s.detail.mesh[0].frequencyHz, s.detail.mesh[1].frequencyHz);
    close(s.detail.mesh[0].frequencyHz, Math.abs(s.planetRpm - s.carrierRpm) * PLANETARY_TEETH.planet / 60);
  }
  const direct = snapshot('at', { gear: '3' });
  assert.ok(direct.detail.mesh.every(m => m.frequencyHz === 0));
  assert.ok(direct.carrierRpm > 0);
  const stationaryFluid = snapshot('at', { rpm: 0, converterLock: false });
  assert.equal(stationaryFluid.detail.couplings[0].state, 'synchronous');
  assert.equal(snapshot('at', { converterLock: true }).detail.couplings[0].state, 'locked');
});

test('eCVT signed electrical stage balances survive regeneration, reverse and standstill', () => {
  for (const rpm of [0, 1800, 7000]) {
    for (const mg1Rpm of [-10000, 0, 2000, 6480, 10000]) {
      for (const mg2Torque of [-200, 0, 200]) {
        const s = snapshot('ecvt', { rpm, mg1Rpm, mg2Torque });
        verifyDetail(s);
        const t = s.detail.idealPlanetaryTorques;
        close(t.sun, s.mg1Torque);
        close(t.ring, -s.engineRingTorque);
        close(t.carrier, s.inputTorque);
        assert.equal(t.holdingElement, null);
        assert.equal(s.detail.couplings.length, 0);
      }
    }
  }
  const stationary = snapshot('ecvt', { rpm: 1800, mg1Rpm: 6480 });
  assert.ok(stationary.detail.outputLoadTorqueNm < 0);
  assert.equal(stationary.outputRpm, 0);
  assert.equal(stationary.outputPowerKW, 0);
});
