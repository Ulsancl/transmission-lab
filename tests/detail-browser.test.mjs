import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const output = path.join(root, 'output', 'detail-v1.4.0');
const url = 'http://127.0.0.1:5241';
const checks = [], errors = [], evidence = [];
let server, browser, page;
await mkdir(output, { recursive: true });
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const angleClose = (actual, expected) => close(Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected)), 0);
const state = () => page.evaluate(() => window.transmissionLab.getState());
async function check(name, action) {
  try { await action(); checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) {
    checks.push({ name, passed: false, error: error.message });
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  }
}
async function select(type, part, settings = {}) {
  await page.evaluate(({ type, settings }) => {
    const app = window.transmissionLab; app.pause(); app.selectType(type); app.setSettings(settings);
  }, { type, settings });
  await page.locator(`.parts-list [data-part="${part}"]`).click();
  await page.waitForFunction(part => window.transmissionLab.getState().view.selectedPart === part && document.querySelector('#component-details dl>div'), part);
  return state();
}
async function readRows() {
  return page.locator('#component-details dl>div').evaluateAll(rows => Object.fromEntries(rows.map(row => [row.querySelector('dt').textContent, Number.parseFloat(row.querySelector('dd').textContent.replaceAll(',', ''))])));
}
function readout(rows, label, expected, digits = 1) {
  assert.ok(Object.hasOwn(rows, label), `Missing readout: ${label}`);
  close(rows[label], expected, 0.5 * 10 ** -digits + 1e-8);
}
async function capture(name, closeup = false) {
  await page.evaluate(() => { document.querySelector('.control-panel').scrollTop = 0; });
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  if (closeup) await page.locator('.scene-panel').screenshot({ path: path.join(output, `${name}-scene.png`) });
}

try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 5241, strictPort: true } });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
  page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, deviceScaleFactor: 1, acceptDownloads: true });
  page.setDefaultTimeout(45000);
  page.on('pageerror', error => errors.push({ kind: 'page', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ kind: 'console', message: message.text() }); });
  await page.goto(url);
  await page.waitForFunction(() => window.transmissionLab?.getState().scene?.meshCount > 0);
  await page.evaluate(() => window.transmissionLab.pause());
  await page.locator('#quality').selectOption('balanced');

  await check('MT inspector shows actual clutch slip, torque, and dissipated power', async () => {
    const s = await select('mt', 'clutch', { rpm: 2400, torque: 160, clutch: 0.5 });
    const rows = await readRows(), c = s.snapshot.detail.couplings[0];
    readout(rows, '입출력 회전차', c.slipRpm, 0);
    readout(rows, '전달 토크', c.transmittedTorqueNm);
    readout(rows, '미끄럼 손실', c.heatKW, 2);
    close(c.slipRpm, 1200); close(c.transmittedTorqueNm, 80);
    assert.match(await page.locator('#component-details p').textContent(), /온도는 계산하지/);
    await capture('mt-slip'); evidence.push({ type: 'mt', rows, coupling: c });
  });

  await check('DCT open preselected clutch can overrun the engine with zero transmitted heat', async () => {
    await select('dct', 'clutch-a', { gear: '6' });
    await page.evaluate(() => window.transmissionLab.advance(1));
    await page.waitForFunction(() => Number.parseFloat([...document.querySelectorAll('#component-details dl>div')].find(row => row.querySelector('dt').textContent === '입출력 회전차')?.querySelector('dd').textContent.replaceAll(',', '')) < 0);
    const s = await state(), rows = await readRows(), c = s.snapshot.detail.couplings.find(c => c.id === 'clutch-a');
    assert.equal(c.state, 'open'); assert.ok(c.slipRpm < 0); assert.equal(c.heatKW, 0);
    readout(rows, '입출력 회전차', c.slipRpm, 0); readout(rows, '전달 토크', 0); readout(rows, '미끄럼 손실', 0, 2);
    await capture('dct-preselection'); evidence.push({ type: 'dct', rows, coupling: c });
  });

  await check('CVT reverse inspector reports signed belt force and complementary wrap angles', async () => {
    const s = await select('cvt', 'belt', { gear: 'R', cvtRatio: 2.4, clutch: 0.7 });
    const b = s.snapshot.detail.belt, rows = await readRows();
    assert.ok(b.tangentialForceN < 0); close(b.primaryWrapDeg + b.secondaryWrapDeg, 360);
    readout(rows, '벨트 순환', b.circulationHz, 2); readout(rows, '구동 감김각', b.primaryWrapDeg);
    readout(rows, '종동 감김각', b.secondaryWrapDeg); readout(rows, '이상 접선 전달력', b.tangentialForceN, 0);
    assert.match(await page.locator('#component-details p').textContent(), /장력·압착력·허용 하중은 아닙니다/);
    await capture('cvt-reverse'); evidence.push({ type: 'cvt', rows, belt: b });
  });

  await check('AT fixed brake shows ideal reaction torque and zero transferred power', async () => {
    const s = await select('at', 'brake-ring', { gear: '1', torque: 140 });
    const t = s.snapshot.detail.idealPlanetaryTorques, rows = await readRows();
    close(t.holdingTorqueNm, 364); readout(rows, '고정 요소 반력 토크', t.holdingTorqueNm); readout(rows, '고정부 전달 동력', 0);
    assert.match(await page.locator('#component-details p').textContent(), /이상 평형/);
    await capture('at-reaction'); evidence.push({ type: 'at', rows, torque: t });
  });

  await check('eCVT total losses agree with the signed energy budget during regeneration', async () => {
    const s = await select('ecvt', 'inverter', { mg1Rpm: -2500, mg2Torque: -200 });
    const d = s.snapshot.detail, rows = await readRows();
    readout(rows, '미끄럼 손실', d.slipLossKW, 2); readout(rows, '기계 전달 손실', d.mechanicalLossKW, 2); readout(rows, '모터·인버터 손실', d.electricalLossKW, 2);
    close(d.slipLossKW + d.mechanicalLossKW + d.electricalLossKW, s.snapshot.inputPowerKW - s.snapshot.outputPowerKW);
    await capture('ecvt-losses'); evidence.push({ type: 'ecvt', rows, detail: d });
  });

  await check('Component focus and return buttons preserve inputs while bearings show actual cage and ball speeds', async () => {
    await select('mt', 'gear-1', { rpm: 2100 });
    await page.locator('#lubrication').uncheck();
    await page.waitForFunction(() => window.transmissionLab.getState().scene.parts.filter(p => p.category === 'lubrication').every(p => !p.visible));
    let before = await state();
    await page.locator('#focus-part').click();
    await page.waitForFunction(() => window.transmissionLab.getState().scene.focusedPart === 'gear-1');
    let focused = await state();
    assert.ok(focused.scene.cameraDistance < before.scene.cameraDistance);
    assert.deepEqual(focused.scene.parts.filter(p => p.visible).map(p => p.id), ['gear-1']);
    assert.deepEqual(focused.view, before.view, 'Isolating a component must preserve category preferences');
    assert.deepEqual(focused.snapshot, before.snapshot); await capture('gear-closeup', true);
    await page.locator('#unfocus-part').click();
    await page.waitForFunction(() => window.transmissionLab.getState().scene.focusedPart === null);
    let restored = await state();
    assert.deepEqual(restored.scene.parts, before.scene.parts, 'Returning to the assembly must restore previous visibility');
    assert.deepEqual(restored.view, before.view);
    await page.locator('.parts-list [data-part="bearings"]').click();
    await page.waitForFunction(() => document.querySelector('#component-details').textContent.includes('케이지 공전'));
    before = await state(); const bearing = before.scene.bearings[0], rows = await readRows();
    readout(rows, '케이지 공전', bearing.cageRpm, 0); readout(rows, '볼 자전 · 고정 좌표', bearing.ballWorldRpm, 0);
    const shaftRpm = before.snapshot.partRpm[bearing.key];
    close(bearing.cageRpm * bearing.pitchRadius - bearing.ballWorldRpm * bearing.ballRadius, shaftRpm * (bearing.pitchRadius - bearing.ballRadius));
    close(bearing.cageRpm * bearing.pitchRadius + bearing.ballWorldRpm * bearing.ballRadius, 0);
    await page.locator('#focus-part').click();
    await page.waitForFunction(() => window.transmissionLab.getState().scene.focusedPart === 'bearings');
    focused = await state(); assert.ok(focused.scene.cameraDistance < before.scene.cameraDistance * 0.5, 'Bearing focus must fit one bearing rather than the assembly-wide bearing collection');
    assert.deepEqual(focused.scene.parts.filter(p => p.visible).map(p => p.id), ['bearings']);
    assert.deepEqual(focused.view, before.view);
    assert.deepEqual(focused.snapshot, before.snapshot); await capture('bearing-closeup', true);
    evidence.push({ focus: { fullDistance: before.scene.cameraDistance, bearingDistance: focused.scene.cameraDistance }, bearing, rows });
    await page.locator('#unfocus-part').click();
    await page.waitForFunction(() => window.transmissionLab.getState().scene.focusedPart === null);
    restored = await state();
    assert.deepEqual(restored.scene.parts, before.scene.parts);
    assert.deepEqual(restored.view, before.view);
    assert.equal(await page.locator('#lubrication').isChecked(), false);
    await page.locator('#lubrication').check();
  });

  await check('DCT bearing top RPM and detail rows describe the same first K2 bearing', async () => {
    await select('dct', 'bearings', { gear: '1', rpm: 2400 });
    await page.waitForFunction(() => document.querySelector('#part-motion-label').textContent.includes('K2'));
    const s = await state(), bearing = s.scene.bearings[0], rows = await readRows();
    assert.equal(bearing.key, 'shaft-b');
    const topText = await page.locator('#part-rpm').textContent();
    const innerRpm = Number.parseFloat(topText.split('/')[0].replaceAll(',', ''));
    const outerRpm = Number.parseFloat(topText.split('/')[1].replaceAll(',', ''));
    close(innerRpm, s.snapshot.partRpm[bearing.key], 0.5 + 1e-8); assert.equal(outerRpm, 0);
    assert.notEqual(innerRpm, s.snapshot.inputRpm, 'Preselected K2 bearing must not show the engine/K1 speed');
    readout(rows, '케이지 공전', bearing.cageRpm, 0); readout(rows, '볼 자전 · 고정 좌표', bearing.ballWorldRpm, 0);
    evidence.push({ dctBearing: bearing, topText, rows });
  });

  await check('Project export, import, and reload preserve captured handover detail exactly', async () => {
    const captured = await page.evaluate(() => {
      const app = window.transmissionLab; app.selectType('dct'); app.pause();
      const clean = app.project(); clean.comparisons = []; clean.experiment = null; app.loadProject(JSON.stringify(clean));
      app.setSettings({ gear: '2' }); app.advance(0.32);
      const snapshot = app.getState().snapshot; app.recordComparison();
      return { snapshot, project: app.project() };
    });
    assert.ok(captured.snapshot.clutchA > 0 && captured.snapshot.clutchB > 0);
    assert.deepEqual(captured.project.comparisons[0].snapshot.detail, captured.snapshot.detail);
    await page.locator('#close-modal').click();
    const downloading = page.waitForEvent('download'); await page.locator('#save-project').click();
    const download = await downloading, filename = path.join(output, 'captured-detail-project.json'); await download.saveAs(filename);
    const exported = JSON.parse(await readFile(filename, 'utf8'));
    assert.deepEqual(exported.comparisons[0].snapshot.detail, captured.snapshot.detail);
    const restored = await page.evaluate(data => {
      const app = window.transmissionLab; app.setSettings({ gear: '6' }); app.advance(1); app.loadProject(JSON.stringify(data)); app.pause(); app.persistNow(); return app.project();
    }, exported);
    assert.deepEqual(restored.comparisons[0], exported.comparisons[0]);
    await page.reload(); await page.waitForFunction(() => window.transmissionLab?.getState().scene?.meshCount > 0);
    await page.evaluate(() => window.transmissionLab.pause());
    const afterReload = await page.evaluate(() => window.transmissionLab.project());
    assert.deepEqual(afterReload.comparisons[0].snapshot.detail, captured.snapshot.detail);
    evidence.push({ captureTime: captured.snapshot.time, capturedDetail: captured.snapshot.detail });
  });

  await page.goto(`${url}/src/scene/product-preview.html`);
  await page.waitForFunction(() => window.qa?.scene);
  await check('Actual bearing cage and ball phases are independent of frame partition for all types', async () => {
    for (const type of ['mt', 'dct', 'cvt', 'at', 'ecvt']) {
      const r = await page.evaluate(type => {
        qa.view.quality = 'balanced'; qa.type(type); qa.sim.setSettings({ rpm: 2300 });
        const snapshot = qa.sim.snapshot(); qa.scene.update(snapshot, qa.view, 1); const single = qa.scene.getDiagnostics();
        qa.type(type); for (let i = 0; i < 10; i++) qa.scene.update(snapshot, qa.view, 0.1);
        return { single, repeated: qa.scene.getDiagnostics() };
      }, type);
      assert.ok(r.single.bearings.length > 0); assert.equal(r.single.bearings.length, r.repeated.bearings.length);
      r.single.bearings.forEach((b, i) => {
        const other = r.repeated.bearings[i]; assert.equal(b.key, other.key);
        angleClose(b.cageAngle, other.cageAngle); angleClose(b.ballAngle, other.ballAngle);
        angleClose(b.cageAngle, b.cageRpm * Math.PI * 2 / 60 / 60);
        angleClose(b.ballAngle, b.ballRelativeRpm * Math.PI * 2 / 60 / 60);
      });
      evidence.push({ framePartition: type, bearings: r.single.bearings });
    }
  });

  await check('Quality rebuild preserves actual bearing spin, focus, and model snapshot', async () => {
    const result = await page.evaluate(() => {
      qa.type('dct'); qa.draw(0.73); qa.view.selectedPart = 'bearings'; qa.scene.selectPart('bearings'); qa.draw(); qa.scene.focusPart('bearings'); qa.draw();
      const initial = qa.scene.getDiagnostics(), snapshot = qa.sim.snapshot(), rows = [];
      for (const quality of ['low', 'high', 'balanced']) { qa.view.quality = quality; qa.draw(); rows.push(qa.scene.getDiagnostics()); }
      return { initial, rows, snapshot, after: qa.sim.snapshot() };
    });
    assert.deepEqual(result.snapshot, result.after);
    for (const row of result.rows) {
      assert.equal(row.focusedPart, 'bearings'); assert.deepEqual(row.bearings, result.initial.bearings);
      assert.deepEqual(row.partIds, result.initial.partIds); close(row.cameraDistance, result.initial.cameraDistance);
    }
    evidence.push({ quality: result.rows.map(r => ({ quality: r.effectiveQuality, focusedPart: r.focusedPart, bearing: r.bearings[0] })) });
  });

  await check('Rendered final gear pair retains half-tooth phase at rest and while moving', async () => {
    for (const type of ['mt', 'dct']) {
      const result = await page.evaluate(type => {
        qa.type(type); const before = qa.scene.getDiagnostics(); qa.draw(0.63); return { before, after: qa.scene.getDiagnostics() };
      }, type);
      // The first output rotor is the driven final gear; its separate output
      // shaft and bearing rotors are registered later by scene construction.
      const output = result.before.rotorAngles.find(r => r.key === 'output');
      close(output.angle, Math.PI / 32);
      const counter = result.after.rotorAngles.find(r => r.key === 'output-shaft');
      const driven = result.after.rotorAngles.find(r => r.key === 'output');
      angleClose((counter.angle + driven.angle) * 32, Math.PI);
      evidence.push({ finalGearPhase: type, rest: output.angle, counter: counter.angle, driven: driven.angle });
    }
  });
  assert.deepEqual(errors, []); console.log(`All ${checks.length} detail browser checks passed.`);
} finally {
  await writeFile(path.join(output, 'detail-browser-results.json'), JSON.stringify({ version, checks, passed: checks.filter(c => c.passed).length, failed: checks.filter(c => !c.passed).length, errors, evidence, rendererScope: 'Headless Chromium with SwiftShader. Functional and geometric verification, not a physical GPU performance claim.' }, null, 2));
  await browser?.close(); await server?.close();
}
