import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulator, defaultSettings } from '../src/model.js';
import { captureComparison, createProject, readProject } from '../src/project.js';
import { advanceClock } from '../src/clock.js';
import { createProjectStorage, STORAGE_KEY, LEGACY_KEY } from '../src/storage.js';

test('captured DCT handover results survive file and automatic storage round trips exactly', () => {
  const simulator = createSimulator(defaultSettings('dct'));
  simulator.setSettings({ gear: '2' }); simulator.step(0.32);
  const result = captureComparison(simulator.settings, simulator.snapshot(), '변속 중');
  const project = createProject({ settings: simulator.settings, view: {}, comparisons: [result] });
  assert.deepEqual(readProject(JSON.stringify(project)).comparisons[0], result);
  const values = new Map(), storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const saved = createProjectStorage(storage, readProject); assert.equal(saved.save(project).ok, true);
  assert.deepEqual(createProjectStorage(storage, readProject).load().data.comparisons[0], result);
  simulator.step(1); assert.notEqual(result.snapshot.outputRpm, simulator.snapshot().outputRpm);
});
test('all five model snapshots including reverse, neutral and eCVT standstill are accepted', () => {
  for (const type of ['mt', 'dct', 'cvt', 'at', 'ecvt']) for (const gear of ['N', 'R', type === 'cvt' || type === 'ecvt' ? 'D' : '1']) {
    const simulator = createSimulator({ ...defaultSettings(type), gear, rpm: 0 });
    const result = captureComparison(simulator.settings, simulator.snapshot(), type);
    assert.deepEqual(readProject(JSON.stringify(createProject({ settings: simulator.settings, view: {}, comparisons: [result] }))).comparisons[0], result);
  }
});
test('old project conditions are explicitly labelled as reconstructed results', () => {
  const settings = defaultSettings('dct');
  const result = readProject(JSON.stringify({ format: 'transmission-lab-project', version: 1, settings, comparisons: [{ type: 'dct', settings, name: 'old' }] }));
  assert.equal(result.legacy, true); assert.equal(result.comparisons[0].source, 'recalculated-legacy');
});
test('invalid, future, missing and over-capacity results are rejected atomically', () => {
  const simulator = createSimulator(defaultSettings('dct'));
  const project = createProject({ settings: simulator.settings, view: {}, comparisons: [captureComparison(simulator.settings, simulator.snapshot(), 'x')] });
  for (const mutate of [p => p.version = 99, p => delete p.comparisons[0].snapshot, p => p.comparisons[0].snapshot.outputRpm = null, p => p.comparisons[0].type = 'mt', p=>p.comparisons[0].settings.rpm=0, p => p.comparisons = Array(5).fill(p.comparisons[0])]) {
    const bad = structuredClone(project); mutate(bad); assert.throws(() => readProject(JSON.stringify(bad)));
  }
});
test('old settings and unreadable raw storage are preserved without silently overwriting them', () => {
  const values = new Map([[LEGACY_KEY, JSON.stringify({ settings: defaultSettings('mt'), view: {} })]]);
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const old = values.get(LEGACY_KEY), manager = createProjectStorage(storage, readProject);
  assert.equal(manager.load().data.settings.type, 'mt'); manager.save(createProject({ settings: defaultSettings('mt'), view: {} }));
  assert.equal(values.get(LEGACY_KEY), old);
  values.set(STORAGE_KEY, '{broken'); const broken = createProjectStorage(storage, readProject);
  assert.equal(broken.load().recovery.raw, '{broken'); assert.equal(values.get(`${STORAGE_KEY}.recovery`), '{broken');
  broken.save(createProject({ settings: defaultSettings('dct'), view: {} })); assert.equal(values.get(`${STORAGE_KEY}.recovery`), '{broken');
});
test('failed or conflicting recovery backup never permits overwriting original storage', () => {
  for (const fail of [true, false]) {
    const values = new Map([[STORAGE_KEY, '{broken'], [`${STORAGE_KEY}.recovery`, 'older recovery']]);
    const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { if (fail) throw new Error('quota'); values.set(k, v); } };
    const manager = createProjectStorage(storage, readProject); assert.equal(manager.load().blocked, true);
    assert.equal(manager.save({}).ok, false); assert.equal(values.get(STORAGE_KEY), '{broken');
    assert.equal(values.get(`${STORAGE_KEY}.recovery`), 'older recovery');
  }
  const values = new Map([[STORAGE_KEY, '{no-backup']]);
  const storage={getItem:k=>values.get(k)??null,setItem:()=>{throw new Error('quota');}};
  const manager=createProjectStorage(storage,readProject);assert.equal(manager.load().blocked,true);
  assert.equal(manager.save({}).ok,false);assert.equal(values.get(STORAGE_KEY),'{no-backup');
});
test('simulation clocks agree at 60 FPS and 3 FPS, including a DCT transition', () => {
  const values = [];
  for (const fps of [60, 3]) {
    const simulator = createSimulator(defaultSettings('dct')); simulator.setSettings({ gear: '2' });
    for (let i = 0; i < fps * 5; i++) advanceClock(1 / fps, dt => simulator.step(dt));
    values.push(simulator.snapshot());
  }
  assert.ok(Math.abs(values[0].time - 5) < 1e-10); assert.ok(Math.abs(values[1].time - 5) < 1e-10);
  assert.equal(values[0].outputRpm, values[1].outputRpm); assert.equal(values[0].gear, '2');
});
test('large stalls and invalid elapsed times are explicit and do not change model state', () => {
  let calls = 0; const step = () => { calls++; };
  assert.equal(advanceClock(1.01, step).stalled, true);
  for (const dt of [-1, NaN, Infinity, 0]) assert.equal(advanceClock(dt, step).advanced, 0);
  assert.equal(calls, 0); const dts = []; advanceClock(0.37, dt => dts.push(dt));
  assert.ok(dts.every(dt => dt <= 0.05)); assert.ok(Math.abs(dts.reduce((a, b) => a + b, 0) - 0.37) < 1e-12);
});
