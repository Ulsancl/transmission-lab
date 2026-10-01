import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'output', `consumer-v${version}`);
const url = process.env.TRANSMISSION_CONSUMER_URL || 'http://127.0.0.1:5181';
await fs.mkdir(output, { recursive: true });
const errors = [], results = [], evidence = {};
let server, browser, page, context;

function observe(target, label) {
  target.on('pageerror', error => errors.push({ page: label, kind: 'page', message: error.message }));
  target.on('console', message => { if (message.type() === 'error') errors.push({ page: label, kind: 'console', message: message.text() }); });
}
async function ready(target) {
  await target.waitForFunction(() => {
    const app = window.transmissionLab;
    return app?.getState().scene?.meshCount > 0 && ['advance', 'recordComparison', 'persistNow', 'showComparisons', 'toggleFocus'].every(key => typeof app[key] === 'function');
  }, {}, { timeout: 45000 });
  await target.evaluate(() => window.transmissionLab.pause());
}
const state = () => page.evaluate(() => window.transmissionLab.getState());
const project = () => page.evaluate(() => window.transmissionLab.project());
async function closeModal(target = page) {
  if (await target.locator('#modal').evaluate(node => node.open)) await target.locator('#close-modal').click();
}
async function fresh(type = 'dct') {
  await closeModal();
  await page.evaluate(type => {
    const app = window.transmissionLab;
    const data = app.project();
    data.comparisons = []; data.experiment = null;
    app.loadProject(JSON.stringify(data)); app.selectType(type); app.pause();
  }, type);
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.control-panel').scrollTop = 0; });
}
async function check(name, action) {
  try { await action(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) {
    results.push({ name, passed: false, error: error.message });
    await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  }
}
function atom(state) {
  return { settings: state.settings, view: state.view, snapshot: state.snapshot, paused: state.paused, comparisons: state.comparisons, experiment: state.experiment, focused: state.focused };
}
function assertFullVisibility(layout, selector) {
  const box = layout.boxes[selector];
  assert.ok(box, `${selector} has no box`);
  assert.ok(box.visible && box.width > 0 && box.height > 0, `${selector} is hidden`);
  assert.ok(box.x >= -1 && box.y >= -1 && box.right <= layout.width + 1 && box.bottom <= layout.height + 1, `${selector} extends outside ${layout.width}x${layout.height}: ${JSON.stringify(box)}`);
}

try {
  if (!process.env.TRANSMISSION_CONSUMER_URL) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5181', '--strictPort'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Consumer test server did not start')), 20000);
      let diagnostic = '';
      server.stdout.on('data', data => { if (data.toString().includes('Local:')) { clearTimeout(timer); resolve(); } });
      server.stderr.on('data', data => { diagnostic += data; if (/already in use|error/i.test(diagnostic)) { clearTimeout(timer); reject(new Error(diagnostic.trim())); } });
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.once('exit', code => { if (code) { clearTimeout(timer); reject(new Error(`Consumer test server exited ${code}: ${diagnostic}`)); } });
    });
  }
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, acceptDownloads: true });
  page = await context.newPage(); observe(page, 'primary');
  await page.goto(url); await ready(page);

  let captured;
  await check('DCT handover comparison exports and reloads the captured instant exactly', async () => {
    await fresh();
    const result = await page.evaluate(() => {
      const app = window.transmissionLab;
      app.setSettings({ gear: '2' }); app.advance(0.32);
      const snapshot = app.getState().snapshot;
      const accepted = app.recordComparison();
      return { snapshot, accepted, project: app.project() };
    });
    assert.equal(result.accepted, true); assert.equal(result.project.version, 2);
    assert.equal(result.project.comparisons.length, 1);
    assert.ok(result.snapshot.clutchA > 0 && result.snapshot.clutchB > 0, 'Capture must be during DCT handover');
    captured = result.project.comparisons[0];
    assert.equal(captured.source, 'captured'); assert.equal(captured.appVersion, version);
    assert.deepEqual(captured.snapshot, result.snapshot);
    await closeModal();
    const pending = page.waitForEvent('download'); await page.locator('#save-project').click();
    const download = await pending, file = path.join(output, 'captured-project.json'); await download.saveAs(file);
    const exported = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(exported.version, 2); assert.deepEqual(exported.comparisons[0], captured);
    await page.evaluate(data => {
      const app = window.transmissionLab; app.setSettings({ gear: '6' }); app.advance(1); app.loadProject(JSON.stringify(data)); app.pause();
    }, exported);
    const restored = await project(); assert.deepEqual(restored.comparisons[0], captured);
    assert.notEqual((await state()).snapshot.outputRpm, captured.snapshot.outputRpm, 'Saved handover must not be replaced by the live steady-state calculation');
    await page.evaluate(() => window.transmissionLab.showComparisons());
    assert.ok((await page.locator('.comparison-grid').textContent()).includes(Math.round(captured.snapshot.outputRpm).toLocaleString('ko-KR')));
    await page.screenshot({ path: path.join(output, 'captured-comparison.png') }); await closeModal();
  });

  await check('Automatic storage restores comparison values after a browser restart', async () => {
    const result = await page.evaluate(() => window.transmissionLab.persistNow()); assert.equal(result.ok, true);
    await page.reload(); await ready(page);
    assert.deepEqual((await project()).comparisons[0], captured);
    assert.equal((await state()).comparisons, 1);
  });

  await check('A fifth comparison is rejected without discarding the first four', async () => {
    await fresh();
    for (let i = 0; i < 4; i++) {
      await closeModal();
      const accepted = await page.evaluate(i => { const app = window.transmissionLab; app.setSettings({ rpm: 1800 + i * 350 }); return app.recordComparison(); }, i);
      assert.equal(accepted, true);
    }
    const before = (await project()).comparisons;
    await closeModal(); assert.equal(await page.evaluate(() => window.transmissionLab.recordComparison()), false);
    assert.deepEqual((await project()).comparisons, before); assert.equal((await state()).comparisons, 4);
    assert.match(await page.locator('#toast').textContent(), /최대 4개|기존 결과/); await closeModal();
  });

  await check('Unsupported future project import leaves the entire current session intact', async () => {
    const before = atom(await state()), beforeComparisons = (await project()).comparisons;
    const rejected = await page.evaluate(() => {
      const app = window.transmissionLab, data = app.project(); data.version = 999; data.settings.rpm = 6900; data.comparisons = [];
      try { app.loadProject(JSON.stringify(data)); return false; } catch { return true; }
    });
    assert.equal(rejected, true); assert.deepEqual(atom(await state()), before);
    assert.deepEqual((await project()).comparisons, beforeComparisons);
  });

  await check('All five guided experiments finish paused with actual before and after results', async () => {
    evidence.experiments = [];
    for (const type of ['mt', 'dct', 'cvt', 'at', 'ecvt']) {
      const result = await page.evaluate(type => {
        const app = window.transmissionLab; app.selectType(type); app.pause(); app.setSettings({ rpm: 1800 }); app.runExperiment();
        const started = app.getState(); let calls = 0;
        while (app.getState().sequence && calls++ < 50) app.advance(0.25);
        return { started: { sequence: started.sequence, paused: started.paused }, final: app.getState(), project: app.project(), calls };
      }, type);
      assert.equal(result.started.sequence, true); assert.equal(result.started.paused, false);
      assert.ok(result.calls < 50, `${type} did not finish`); assert.equal(result.final.sequence, false); assert.equal(result.final.paused, true);
      const experiment = result.final.experiment;
      assert.ok(experiment, `${type} has no captured experiment`);
      const controls=await page.evaluate(()=>[...document.querySelectorAll('[data-setting]')].map(el=>({key:el.dataset.setting,value:el.type==='checkbox'?el.checked:Number(el.value)})));
      for(const control of controls){const expected=result.final.settings[control.key];assert.ok(typeof expected==='boolean'?control.value===expected:Math.abs(control.value-expected)<1e-8,`${type} visible ${control.key} control differs from actual setting`);}
      for (const value of [experiment.before, experiment.after]) { assert.equal(value.type, type); assert.equal(value.source, 'captured'); assert.equal(value.snapshot.inputRpm, 1800); }
      assert.ok(['outputRpm', 'outputTorque', 'ratio'].some(key => experiment.before.snapshot[key] !== experiment.after.snapshot[key]), `${type} has no measured change`);
      assert.ok(Math.abs(experiment.after.snapshot.time - experiment.before.snapshot.time - experiment.duration) < 1e-8);
      assert.deepEqual(result.project.experiment, experiment);
      assert.equal(await page.locator('#experiment-result').isVisible(), true);
      assert.match(await page.locator('#experiment-result').textContent(), /전후|전·후/);
      await page.screenshot({ path: path.join(output, `${type}-experiment.png`), fullPage: true });
      evidence.experiments.push({ type, duration: experiment.duration, inputRpm: experiment.before.snapshot.inputRpm, beforeOutputRpm: experiment.before.snapshot.outputRpm, afterOutputRpm: experiment.after.snapshot.outputRpm });
    }
    const retained = (await project()).experiment;
    assert.equal((await page.evaluate(() => window.transmissionLab.persistNow())).ok, true);
    await page.reload(); await ready(page); assert.deepEqual((await project()).experiment, retained);
  });

  await check('An experiment at zero engine RPM preserves the input and explains its stopped condition', async () => {
    const result = await page.evaluate(() => {
      const app = window.transmissionLab; app.selectType('dct'); app.pause(); app.setSettings({ rpm: 0 }); app.runExperiment();
      let calls = 0; while (app.getState().sequence && calls++ < 50) app.advance(0.25);
      return app.getState();
    });
    assert.equal(result.sequence, false); assert.equal(result.paused, true); assert.equal(result.settings.rpm, 0);
    assert.equal(result.experiment.before.snapshot.inputRpm, 0); assert.equal(result.experiment.after.snapshot.inputRpm, 0);
    assert.equal(result.experiment.after.snapshot.outputRpm, 0);
    assert.match(await page.locator('#experiment-result').textContent(), /엔진이 정지|정지한 조건/);
  });

  await check('Laptop and scaled laptop views keep engine input, scene and quick experiment visible together', async () => {
    await fresh(); evidence.layouts = [];
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1093, height: 614 }]) {
      await page.setViewportSize(viewport); await page.waitForTimeout(150);
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.control-panel').scrollTop = 0; });
      const layout = await page.evaluate(() => {
        const selectors = ['.scene-quick-tools', '#rpm', '#quick-experiment', '#scene canvas'];
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, boxes: Object.fromEntries(selectors.map(selector => {
          const el = document.querySelector(selector), b = el?.getBoundingClientRect(), css = el && getComputedStyle(el);
          return [selector, b ? { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom, visible: css.display !== 'none' && css.visibility !== 'hidden' } : null];
        })) };
      });
      for (const selector of ['.scene-quick-tools', '#rpm', '#quick-experiment', '#scene canvas']) assertFullVisibility(layout, selector);
      assert.ok(layout.scrollWidth <= viewport.width + 1, 'Horizontal page overflow');
      const clicked = await page.evaluate(() => { const el = document.querySelector('#quick-experiment'), b = el.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return el === hit || el.contains(hit); });
      assert.equal(clicked, true, 'Quick experiment is covered by another element');
      await page.screenshot({ path: path.join(output, `laptop-${viewport.width}x${viewport.height}.png`) }); evidence.layouts.push(layout);
    }
  });

  await check('Scrolling the control panel keeps the scene position and window scroll unchanged', async () => {
    const result = await page.evaluate(() => {
      const panel = document.querySelector('.control-panel'), scene = document.querySelector('.scene-panel');
      const before = { x: scene.getBoundingClientRect().x, y: scene.getBoundingClientRect().y, width: scene.getBoundingClientRect().width, height: scene.getBoundingClientRect().height, windowY: scrollY };
      panel.scrollTop = panel.scrollHeight;
      return { before, panelScroll: panel.scrollTop, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight };
    });
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => { const b = document.querySelector('.scene-panel').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, windowY: scrollY }; });
    assert.ok(result.panelScroll > 100 && result.scrollHeight > result.clientHeight, 'Panel does not scroll independently');
    for (const key of ['x', 'y', 'width', 'height', 'windowY']) assert.ok(Math.abs(after[key] - result.before[key]) < 0.5, `Scene moved while panel scrolled: ${key}`);
    await page.evaluate(() => { document.querySelector('.control-panel').scrollTop = 0; });
  });

  await check('F and Escape restore the focused scene without changing inputs or selected part', async () => {
    await page.setViewportSize({ width: 1366, height: 768 }); await fresh();
    await page.evaluate(() => window.transmissionLab.selectPart('shaft-a'));
    const beforeState=await state(),before = atom(beforeState); assert.equal(before.view.selectedPart, 'shaft-a');
    await page.locator('.scene-panel').click({position:{x:4,y:4}}); await page.keyboard.press('f');
    await page.waitForFunction(() => window.transmissionLab.getState().focused === true);
    await page.waitForFunction(frames=>{const scene=window.transmissionLab.getState().scene,box=document.querySelector('#scene').getBoundingClientRect();return Math.abs(scene.width-box.width)<1&&Math.abs(scene.height-box.height)<1&&scene.performance.renderFrames>frames;},beforeState.scene.performance.renderFrames);
    const metalPixels=await page.evaluate(()=>{const source=document.querySelector('#scene canvas'),copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;const ctx=copy.getContext('2d');ctx.drawImage(source,0,0);const pixels=ctx.getImageData(0,0,copy.width,copy.height).data;let metal=0;for(let i=0;i<pixels.length;i+=4){const [r,g,b,a]=pixels.slice(i,i+4);if(a>200&&Math.min(r,g,b)>100&&Math.max(r,g,b)-Math.min(r,g,b)<40)metal++;}return metal;});
    assert.ok(metalPixels>1000,`Focused WebGL canvas is blank or lacks visible metal geometry (${metalPixels} pixels)`);
    assert.equal(await page.locator('.scene-panel').evaluate(el => el.classList.contains('is-focused')), true);
    await page.screenshot({ path: path.join(output, 'focused-scene.png') });
    await page.keyboard.press('Escape'); await page.waitForFunction(() => window.transmissionLab.getState().focused === false);
    const after = atom(await state()); assert.deepEqual(after.settings, before.settings); assert.deepEqual(after.snapshot, before.snapshot); assert.equal(after.view.selectedPart, 'shaft-a');
    assert.equal(await page.locator('.scene-panel').evaluate(el => el.classList.contains('is-focused')), false);
  });

  await check('Low and high visual quality preserve model values and part identities for all five types', async () => {
    evidence.quality = [];
    for (const type of ['mt', 'dct', 'cvt', 'at', 'ecvt']) {
      await page.evaluate(type => { const app = window.transmissionLab; app.selectType(type); app.pause(); app.setSettings({ rpm: 2250 }); app.advance(0.5); }, type);
      const before = await state(), ids = [...before.scene.partIds].sort();
      for (const quality of ['low', 'high']) {
        await page.locator('#quality').selectOption(quality);
        await page.waitForFunction(quality => { const value = window.transmissionLab.getState(); return value.view.quality === quality && value.scene.requestedQuality === quality && value.scene.effectiveQuality === quality; }, quality);
        const after = await state(); assert.deepEqual(after.settings, before.settings); assert.deepEqual(after.snapshot, before.snapshot); assert.deepEqual([...after.scene.partIds].sort(), ids);
        assert.equal(after.view.quality, quality); evidence.quality.push({ type, quality, partCount: ids.length, effectiveQuality: after.scene.effectiveQuality });
        if (type === 'dct') await page.screenshot({ path: path.join(output, `dct-quality-${quality}.png`) });
      }
    }
  });

  await check('Storage quota failure is visible while project file export remains available', async () => {
    const quotaContext = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
    try {
      await quotaContext.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('Injected quota for consumer regression', 'QuotaExceededError'); }; });
      const quotaPage = await quotaContext.newPage(); observe(quotaPage, 'quota'); await quotaPage.goto(url); await ready(quotaPage);
      const result = await quotaPage.evaluate(() => { const app = window.transmissionLab; app.setSettings({ rpm: 3100 }); app.recordComparison(); return app.persistNow(); });
      assert.equal(result.ok, false); assert.match(result.reason, /저장|프로젝트/);
      assert.match(await quotaPage.locator('#storage-status').textContent(), /자동 저장 실패/);
      assert.equal(await quotaPage.locator('#storage-status').evaluate(el => el.classList.contains('has-warning')), true);
      await closeModal(quotaPage); const pending = quotaPage.waitForEvent('download'); await quotaPage.locator('#save-project').click();
      const download = await pending, file = path.join(output, 'quota-project.json'); await download.saveAs(file);
      const data = JSON.parse(await fs.readFile(file, 'utf8')); assert.equal(data.version, 2); assert.equal(data.settings.rpm, 3100); assert.equal(data.comparisons.length, 1);
      await quotaPage.screenshot({ path: path.join(output, 'quota-warning.png'), fullPage: true });
    } finally { await quotaContext.close(); }
  });

  assert.deepEqual(errors, []); results.push({ name: 'No consumer browser errors', passed: true });
  console.log(`All ${results.length} consumer checks passed.`);
} finally {
  await fs.writeFile(path.join(output, 'consumer-results.json'), JSON.stringify({ version, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results, errors, evidence, rendererScope: 'Headless browser implementation checks; no physical GPU FPS claim.' }, null, 2));
  await browser?.close(); server?.kill();
}
