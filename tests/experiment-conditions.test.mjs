import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulator, defaultSettings, normalizeSettings, openBeltLength } from '../src/model.js';
import { EXPERIMENT_TIMING, createExperimentPlan } from '../src/experiment-timing.js';
import { captureComparison, createProject, readProject } from '../src/project.js';
import { createProjectStorage, LEGACY_KEY, STORAGE_KEY } from '../src/storage.js';

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `Expected ${expected}, got ${actual}`);

test('missing timings preserve the previous schedules and DCT handover', () => {
  const legacyTimings = {
    mt: ['mtEngagementSeconds', 3, 5],
    dct: ['dctShiftSeconds', 0.85, 7],
    cvt: ['cvtSweepSeconds', 6, 8],
    at: ['atDwellSeconds', 2, 9],
    ecvt: ['ecvtSweepSeconds', 6, 8],
  };
  for (const [type, [key, value, duration]] of Object.entries(legacyTimings)) {
    const settings = normalizeSettings({ type, rpm: 2300 });
    assert.equal(settings[key], value);
    assert.equal(settings.rpm, 2300);
    assert.equal(createExperimentPlan(settings).duration, duration);
  }
  const dct = createSimulator({ type: 'dct' });
  dct.setSettings({ gear: '2' });
  near(dct.step(0.425).shiftProgress, 0.5);
  assert.equal(dct.step(0.425).shiftFrom, undefined);
});

test('timing inputs are bounded, aligned to their keyboard step and scoped to the active type', () => {
  for (const [type, { key, min, max, initial }] of Object.entries(EXPERIMENT_TIMING)) {
    assert.equal(normalizeSettings({ type, [key]: -100 })[key], min);
    assert.equal(normalizeSettings({ type, [key]: 100 })[key], max);
    for (const value of ['', null, NaN, Infinity, true, {}, '잘못된 값']) {
      assert.equal(normalizeSettings({ type, [key]: value })[key], initial);
    }
  }
  const dct = normalizeSettings({ type: 'dct', dctShiftSeconds: '1.62', mtEngagementSeconds: 8 });
  assert.equal(dct.dctShiftSeconds, 1.6);
  assert.equal(dct.mtEngagementSeconds, undefined);
});

test('DCT shift timing changes the overlap at equal elapsed time and latches at command time', () => {
  const quick = createSimulator({ type: 'dct', dctShiftSeconds: 0.4 });
  const slow = createSimulator({ type: 'dct', dctShiftSeconds: 1.6 });
  for (const simulator of [quick, slow]) simulator.setSettings({ gear: '2' });
  const settled = quick.step(0.4);
  const handover = slow.step(0.4);
  assert.equal(settled.shiftFrom, undefined);
  near(settled.clutchB, 1);
  near(handover.shiftProgress, 0.25);
  near(handover.clutchA, 0.75);
  near(handover.clutchB, 0.25);
  near(settled.outputTorque, 313.6);
  near(handover.outputTorque, 425.6);
  near(handover.inputPowerKW, handover.outputPowerKW + handover.lossPowerKW);

  near(slow.setSettings({ dctShiftSeconds: 0.2 }).shiftProgress, 0.25);
  near(slow.step(0.4).shiftProgress, 0.5);
  slow.setSettings({ gear: '4' });
  near(slow.step(0.1).outputTorque, 0);
  assert.equal(slow.step(0.1).shiftFrom, undefined);
  assert.equal(slow.setSettings({ gear: 'R' }).shiftFrom, undefined);
  assert.ok(slow.snapshot().outputRpm < 0);
  assert.equal(slow.setSettings({ gear: 'N' }).outputTorque, 0);
});

test('changing guided timings changes the commanded conditions at equal elapsed time', () => {
  function sample(type, timing, elapsed) {
    const key = EXPERIMENT_TIMING[type].key;
    const settings = normalizeSettings({ type, [key]: timing });
    const plan = createExperimentPlan(settings);
    const simulator = createSimulator({ ...settings, ...plan.initial });
    if (plan.continuous) simulator.setSettings(plan.continuous(elapsed));
    else for (const step of plan.steps) {
      if (step.at <= elapsed) simulator.setSettings(step.settings);
    }
    return simulator.snapshot();
  }

  const mtQuick = sample('mt', 1, 1), mtSlow = sample('mt', 4, 1);
  near(mtQuick.outputRpm, 1800 * 18 / 62);
  near(mtSlow.outputRpm, mtQuick.outputRpm / 4);
  assert.ok(mtSlow.clutchLossKW > mtQuick.clutchLossKW);

  const cvtQuick = sample('cvt', 2, 3), cvtSlow = sample('cvt', 10, 3);
  near(cvtQuick.ratio, 0.45);
  near(cvtSlow.ratio, 1.955);
  near(cvtQuick.beltLength, openBeltLength(cvtSlow.primaryRadius, cvtSlow.secondaryRadius));

  const atQuick = sample('at', 0.5, 2), atSlow = sample('at', 4, 2);
  assert.equal(atQuick.converterLocked, true);
  assert.equal(atQuick.gear, '4');
  assert.equal(atSlow.converterLocked, false);
  assert.equal(atSlow.gear, '1');
  assert.equal(atSlow.heldElement, 'ring');

  const ecvtQuick = sample('ecvt', 2, 3), ecvtSlow = sample('ecvt', 10, 3);
  near(ecvtQuick.sunRpm, -1000);
  near(ecvtSlow.sunRpm, 2500);
  for (const snapshot of [ecvtQuick, ecvtSlow]) {
    near(snapshot.planetaryResidual, 0);
    near(snapshot.inputPowerKW, snapshot.outputPowerKW + snapshot.lossPowerKW);
  }
});

test('timings round-trip through project, comparison and automatic storage with legacy defaults', () => {
  const simulator = createSimulator({ type: 'dct', dctShiftSeconds: 1.6 });
  simulator.setSettings({ gear: '2' });
  const snapshot = simulator.step(0.4);
  const capture = captureComparison(simulator.settings, snapshot, '1 → 2');
  const project = createProject({ settings: simulator.settings, view: {}, comparisons: [capture] });
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const manager = createProjectStorage(storage, readProject);
  assert.equal(manager.save(project).ok, true);
  const restored = createProjectStorage(storage, readProject).load().data;
  assert.equal(restored.settings.dctShiftSeconds, 1.6);
  assert.deepEqual(restored.comparisons[0], capture);

  const legacySettings = defaultSettings('dct');
  delete legacySettings.dctShiftSeconds;
  const olderProject = createProject({
    settings: legacySettings,
    view: {},
    comparisons: [{ ...capture, settings: { ...legacySettings, gear: '2' } }],
  });
  const legacyV2 = readProject(JSON.stringify(olderProject));
  assert.equal(legacyV2.settings.dctShiftSeconds, 0.85);
  assert.equal(legacyV2.comparisons[0].settings.dctShiftSeconds, 0.85);
  assert.deepEqual(legacyV2.comparisons[0].snapshot, snapshot);

  const legacyRaw = JSON.stringify({
    settings: legacySettings,
    comparisons: [{ type: 'dct', settings: legacySettings, name: '이전 조건' }],
  });
  values.delete(STORAGE_KEY);
  values.set(LEGACY_KEY, legacyRaw);
  const migrated = manager.load().data;
  assert.equal(migrated.settings.dctShiftSeconds, 0.85);
  assert.equal(migrated.comparisons[0].source, 'recalculated-legacy');
  assert.equal(migrated.comparisons[0].settings.dctShiftSeconds, 0.85);
  assert.equal(values.get(LEGACY_KEY), legacyRaw);
});
