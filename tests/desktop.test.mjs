import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const anatomyKeys = ['bearings', 'clutches', 'lubrication', 'oilFlow'];
const output = path.join(root, 'output', `${process.env.TRANSMISSION_DESKTOP_EXE ? 'desktop-packaged' : 'desktop'}-v${expectedVersion}`);
await fs.mkdir(output, { recursive: true });
const profile = await fs.mkdtemp(path.join(output, 'profile-'));
const executablePath = process.env.TRANSMISSION_DESKTOP_EXE || require('electron');
const env = { ...process.env, TRANSMISSION_LAB_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [], remoteRequests = [], checks = [];
let app, page;
const state = () => page.evaluate(() => window.transmissionLab.getState());
const projectPath = path.join(output, '변속기 실험.transmission.json');
async function check(name, action) { await action(); checks.push(name); console.log(`PASS ${name}`); }
async function launch() {
  app = await electron.launch({ executablePath, args: process.env.TRANSMISSION_DESKTOP_EXE ? [] : [root], env, timeout: 45000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(90000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { if (/^https?:/.test(r.url())) remoteRequests.push(r.url()); });
  await page.waitForFunction(() => window.transmissionLab?.getState().scene?.meshCount > 0, {}, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
  await page.evaluate(() => window.transmissionLab.pause());
}
async function menu(label, item) {
  await app.evaluate(({ Menu }, names) => {
    const found = Menu.getApplicationMenu().items.find(i => i.label === names[0])?.submenu?.items.find(i => i.label === names[1]);
    if (!found || typeof found.click !== 'function') throw new Error(`Missing menu: ${names.join(' > ')}`);
    found.click();
  }, [label, item]);
}
async function nativeShortcut(key, shift = false) {
  // CDP keyboard events reach the renderer directly and do not exercise native menu accelerators.
  await app.evaluate(({ BrowserWindow }, payload) => {
    const window = BrowserWindow.getAllWindows()[0]; window.focus();
    const modifiers = payload.shift ? ['control', 'shift'] : ['control'];
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: payload.key, modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: payload.key, modifiers });
  }, { key, shift });
}
async function saveDialog(filePath, canceled = false) {
  await app.evaluate(({ dialog }, payload) => {
    dialog.showSaveDialog = async (_window, options) => {
      globalThis.saveDialogCalls = (globalThis.saveDialogCalls || 0) + 1;
      globalThis.saveDialogOptions = options;
      return { canceled: payload.canceled, filePath: payload.filePath };
    };
  }, { filePath, canceled });
}
async function openDialog(filePath, canceled = false) {
  await app.evaluate(({ dialog }, payload) => {
    dialog.showOpenDialog = async () => {
      globalThis.openDialogCalls = (globalThis.openDialogCalls || 0) + 1;
      return { canceled: payload.canceled, filePaths: payload.canceled ? [] : [payload.filePath] };
    };
  }, { filePath, canceled });
}
async function waitToast(pattern) { await page.waitForFunction(p => new RegExp(p).test(document.querySelector('#toast')?.textContent || ''), pattern); }
async function readSaved() {
  for (let i = 0; i < 100; i++) {
    try { const parsed = JSON.parse(await fs.readFile(projectPath, 'utf8')); if (parsed.format === 'transmission-lab-project') return parsed; } catch {}
    await page.waitForTimeout(30);
  }
  throw new Error('Project was not saved');
}
async function exportPNG(canceled = false) {
  const filePath = path.join(output, canceled ? 'canceled.png' : 'transmission-scene.png');
  await fs.unlink(filePath).catch(() => {});
  await app.evaluate(({ session }, payload) => {
    globalThis.downloadResult = null;
    session.defaultSession.once('will-download', (_event, item) => {
      item.once('done', (_e, state) => { globalThis.downloadResult = { state, filePath: payload.filePath }; });
      if (payload.canceled) item.cancel(); else item.setSavePath(payload.filePath);
    });
  }, { filePath, canceled });
  await page.locator('#capture').click();
  const result = await app.evaluate(() => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('Native download timeout')); }, 20000);
    const timer = setInterval(() => { if (globalThis.downloadResult) { clearInterval(timer); clearTimeout(timeout); resolve(globalThis.downloadResult); } }, 25);
  }));
  assert.equal(result.state, canceled ? 'cancelled' : 'completed');
  if (canceled) await assert.rejects(fs.access(filePath));
  else assert.deepEqual([...(await fs.readFile(filePath)).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
}
const persistentContents = ({ createdAt, ...contents }) => contents;
let saved, restartProject;
try {
  await launch();
  await check('offline bundle launches with isolated native API and separate storage', async () => {
    assert.equal(page.url(), 'app://transmission/');
    const security = await page.evaluate(() => ({
      desktop: window.transmissionDesktop.isDesktop, node: typeof window.require, process: typeof window.process,
      oldBridge: typeof window.suspensionDesktop, canvases: document.querySelectorAll('#scene canvas').length,
      keys: Object.keys(window.transmissionDesktop).sort(),
    }));
    assert.equal(security.desktop, true); assert.equal(security.node, 'undefined'); assert.equal(security.process, 'undefined');
    assert.equal(security.oldBridge, 'undefined'); assert.equal(security.canvases, 1);
    assert.deepEqual(security.keys, ['isDesktop', 'onCommand', 'onSaveResult', 'openProject', 'platform', 'saveProject', 'setBusy']);
    const nativeConfig = await app.evaluate(({ BrowserWindow, app }) => {
      const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { name: app.name, version: app.getVersion(), data: app.getPath('userData'), contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration };
    });
    assert.equal(nativeConfig.name, 'Transmission Lab'); assert.equal(nativeConfig.data, profile);
    assert.equal(nativeConfig.version, expectedVersion);
    assert.equal(nativeConfig.contextIsolation, true); assert.equal(nativeConfig.sandbox, true); assert.equal(nativeConfig.nodeIntegration, false);
    assert.deepEqual(remoteRequests, []);
    const denied = await page.evaluate(() => fetch('https://example.com/').then(() => false).catch(() => true));
    assert.equal(denied, true); errors.length = 0; remoteRequests.length = 0;
  });
  await check('five transmission types render distinct geometry with finite results', async () => {
    const counts = [];
    for (const type of ['mt', 'dct', 'cvt', 'at', 'ecvt']) {
      await page.locator(`[data-type="${type}"]`).click();
      await page.waitForFunction(t => window.transmissionLab.getState().scene?.snapshotType === t, type);
      const s = await state(); assert.equal(s.settings.type, type); assert.equal(s.scene.type, type);
      assert.ok(s.scene.meshCount > 10); assert.ok(s.scene.partIds.length >= 4); counts.push(s.scene.meshCount);
      for (const value of Object.values(s.snapshot)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.equal(await page.locator('#scene canvas').count(), 1);
    }
    assert.ok(new Set(counts).size >= 4);
  });
  await check('version 1.0 saved settings migrate to opaque cutaway with new anatomy categories enabled', async () => {
    await page.evaluate(() => { window.transmissionLab.selectType('cvt'); window.transmissionLab.setSettings({ rpm: 2750, torque: 185, cvtRatio: 0.73 }); });
    const legacy = await page.evaluate(() => {
      const p = window.transmissionLab.project(), view = { ...p.view };
      for (const key of ['bearings', 'clutches', 'lubrication', 'oilFlow', 'housingMode', 'cutaway']) delete view[key];
      view.housing = 0.12; view.explode = 0.16;
      return { settings: p.settings, view };
    });
    // Seed an actual legacy storage record before application startup, after beforeunload persistence.
    await page.addInitScript(record => {
      if (sessionStorage.getItem('qa-legacy-record-seeded')) return;
      localStorage.removeItem('transmission-lab.v2');
      localStorage.setItem('transmission-lab.v1', JSON.stringify(record));
      sessionStorage.setItem('qa-legacy-record-seeded', 'true');
    }, legacy);
    await page.reload(); await page.waitForFunction(() => window.transmissionLab?.getState().scene?.meshCount > 0);
    await page.evaluate(() => window.transmissionLab.pause());
    assert.deepEqual((await state()).settings, legacy.settings);
    assert.equal((await state()).view.housingMode, 'cutaway'); assert.equal((await state()).view.housing, 1);
    assert.equal((await state()).view.cutaway, 0.55); assert.equal((await state()).view.explode, legacy.view.explode);
    for (const key of anatomyKeys) { assert.equal((await state()).view[key], true); assert.equal(await page.locator(`[data-view="${key}"]`).isChecked(), true); }
  });
  await check('version 1.1 projects preserve anatomy preferences and migrate hidden housing', async () => {
    const legacy = await page.evaluate(() => window.transmissionLab.project());
    legacy.view = { explode: 0.22, housing: 0.18, labels: false, flow: false, bearings: false, clutches: true, lubrication: false, oilFlow: true, speed: 1 / 120 };
    const filePath = path.join(output, 'legacy-v1.1.transmission.json');
    await fs.writeFile(filePath, JSON.stringify(legacy)); await openDialog(filePath);
    await menu('파일', '프로젝트 열기…'); await waitToast('프로젝트.*불러왔습니다');
    let current = await state(); assert.deepEqual(current.settings, legacy.settings);
    assert.equal(current.view.housingMode, 'cutaway'); assert.equal(current.view.housing, 1); assert.equal(current.view.cutaway, 0.55);
    for (const key of ['explode', 'labels', 'flow', 'speed', ...anatomyKeys]) assert.equal(current.view[key], legacy.view[key]);
    legacy.view.housing = 0;
    await fs.writeFile(filePath, JSON.stringify(legacy));
    await menu('파일', '프로젝트 열기…'); await waitToast('프로젝트.*불러왔습니다');
    await page.waitForFunction(() => window.transmissionLab.getState().view.housingMode === 'hidden');
    current = await state(); assert.deepEqual(current.settings, legacy.settings);
    for (const key of ['explode', 'labels', 'flow', 'speed', ...anatomyKeys]) assert.equal(current.view[key], legacy.view[key]);
    assert.equal(await page.locator('.view-controls [data-housing-mode="hidden"]').getAttribute('aria-pressed'), 'true');
  });
  await check('cutaway closed and hidden modes keep settings and expose appropriate controls', async () => {
    const before = (await state()).settings;
    for (const mode of ['cutaway', 'closed', 'hidden']) {
      await page.locator(`.view-controls [data-housing-mode="${mode}"]`).click(); assert.equal((await state()).view.housingMode, mode);
      assert.equal(await page.locator(`.view-controls [data-housing-mode="${mode}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#cutaway').isDisabled(), mode !== 'cutaway');
      assert.equal(await page.locator('#housing').isDisabled(), mode === 'hidden');
      if (mode === 'cutaway') { await page.locator('#cutaway').fill('0.74'); await page.locator('#housing').fill('0.81'); }
      assert.equal((await state()).view.cutaway, 0.74); assert.equal((await state()).view.housing, 0.81);
    }
    assert.deepEqual((await state()).settings, before);
    await page.locator('.view-controls [data-housing-mode="cutaway"]').click();
  });
  await check('anatomy visibility and oil flow controls do not change transmission settings', async () => {
    const before = (await state()).settings;
    for (const key of anatomyKeys) {
      await page.locator(`[data-view="${key}"]`).uncheck(); assert.equal((await state()).view[key], false);
      await page.locator(`[data-view="${key}"]`).check(); assert.equal((await state()).view[key], true);
    }
    assert.deepEqual((await state()).settings, before);
  });
  await check('real menus, Space and Ctrl+Shift+P each perform one pause action', async () => {
    // Freeze RAF timestamps during asynchronous native input. This tests the
    // actual menu/accelerator handlers without a software-renderer stall
    // independently changing their toggle direction.
    const clockTime=new Date('2026-10-01T08:00:00Z');
    await page.clock.install({time:clockTime});
    await page.clock.pauseAt(new Date(clockTime.getTime()+1000));
    const waitPaused=async expected=>{
      const deadline=Date.now()+15000;
      while(Date.now()<deadline){if((await state()).paused===expected)return;await delay(30);}
      assert.equal((await state()).paused,expected);
    };
    try {
    await page.evaluate(() => { window.transmissionLab.play(); document.activeElement?.blur(); });
    await menu('실험', '재생 / 일시정지'); await waitPaused(true);
    await page.keyboard.press('Space'); await waitPaused(false);
    await nativeShortcut('P', true); await waitPaused(true);
    await page.locator('#rpm').focus(); await page.keyboard.press('Space'); assert.equal((await state()).paused, true);
    } finally { await page.clock.resume(); }
    for (const [label, preset] of [['입체 보기', 'isometric'], ['정면 보기', 'front'], ['위에서 보기', 'top']]) {
      await menu('보기', label); assert.equal(await page.locator(`[data-camera="${preset}"]`).evaluate(e => e.classList.contains('active')), true);
    }
    await menu('도움말', '사용 안내'); await page.waitForFunction(() => document.querySelector('#modal').open);
    await page.locator('#close-modal').click();
  });
  await check('native project save replaces existing file atomically and preserves settings', async () => {
    await page.evaluate(() => { window.transmissionLab.selectType('cvt'); window.transmissionLab.setSettings({ rpm: 2750, torque: 185, cvtRatio: 0.73 }); });
    await page.locator('#explode').fill('0.51'); await page.locator('#housing').fill('0.33');
    await page.locator('#cutaway').fill('0.65'); await page.locator('.view-controls [data-housing-mode="closed"]').click();
    await page.locator('#labels').uncheck(); await page.locator('#flow').uncheck();
    await page.locator('[data-speed="0.0333333333"]').click();
    await page.locator('[data-view="bearings"]').uncheck(); await page.locator('[data-view="clutches"]').uncheck();
    await page.locator('[data-view="lubrication"]').check(); await page.locator('[data-view="oilFlow"]').uncheck();
    await saveDialog(projectPath); await fs.writeFile(projectPath, 'previous file');
    await menu('파일', '프로젝트 저장…'); await waitToast('프로젝트를 저장했습니다'); saved = await readSaved();
    assert.equal(saved.settings.type, 'cvt'); assert.equal(saved.settings.cvtRatio, 0.73); assert.equal(saved.settings.rpm, 2750);
    assert.equal(saved.view.explode, 0.51); assert.equal(saved.view.housing, 0.33);
    assert.equal(saved.view.housingMode, 'closed'); assert.equal(saved.view.cutaway, 0.65);
    assert.equal(saved.view.labels, false); assert.equal(saved.view.flow, false);
    assert.ok(Math.abs(saved.view.speed - 1 / 30) < 1e-8);
    assert.equal(saved.view.bearings, false); assert.equal(saved.view.clutches, false);
    assert.equal(saved.view.lubrication, true); assert.equal(saved.view.oilFlow, false);
    assert.deepEqual((await fs.readdir(output)).filter(n => n.endsWith('.tmp')), []);
  });
  await check('save/open cancellation leaves settings and files intact', async () => {
    const before = (await state()).settings, canceledPath = path.join(output, 'canceled-project.json');
    await fs.unlink(canceledPath).catch(() => {});
    await saveDialog(canceledPath, true); await page.locator('#save-project').click(); await page.waitForTimeout(120);
    await assert.rejects(fs.access(canceledPath)); assert.deepEqual((await state()).settings, before);
    await openDialog(projectPath, true); await page.locator('#open-project').click(); await page.waitForTimeout(120);
    assert.deepEqual((await state()).settings, before);
  });
  await check('Ctrl+S and Ctrl+O show one native dialog and restore saved project', async () => {
    await saveDialog(projectPath); await openDialog(projectPath);
    await app.evaluate(() => { globalThis.saveDialogCalls = 0; globalThis.openDialogCalls = 0; });
    await page.evaluate(() => document.activeElement?.blur()); await nativeShortcut('S');
    await page.waitForTimeout(200); assert.equal(await app.evaluate(() => globalThis.saveDialogCalls), 1);
    await page.evaluate(() => window.transmissionLab.selectType('mt'));
    await page.locator('.view-controls [data-housing-mode="cutaway"]').click(); await page.locator('#cutaway').fill('0.22');
    await page.locator('#housing').fill('0.77'); await page.locator('.view-controls [data-housing-mode="hidden"]').click();
    // Oil flow is disabled when the lubrication layer is hidden, so change it first.
    for (const key of ['bearings', 'clutches', 'oilFlow', 'lubrication']) await page.locator(`[data-view="${key}"]`).setChecked(!saved.view[key]);
    await nativeShortcut('O'); await waitToast('프로젝트.*불러왔습니다');
    assert.equal(await app.evaluate(() => globalThis.openDialogCalls), 1); assert.deepEqual((await state()).settings, saved.settings);
    for (const key of ['housingMode', 'cutaway', 'housing']) assert.equal((await state()).view[key], saved.view[key]);
    for (const key of anatomyKeys) assert.equal((await state()).view[key], saved.view[key]);
  });
  await check('native project files preserve a captured DCT handover instead of recalculating it', async () => {
    const instant = await page.evaluate(() => {
      const app=window.transmissionLab;app.selectType('dct');app.pause();app.setSettings({gear:'2'});app.advance(.32);
      app.recordComparison();document.querySelector('#modal').close();return app.project().comparisons.at(-1);
    });
    const capturedPath=path.join(output,'순간 비교.transmission.json');await saveDialog(capturedPath);
    await page.locator('#save-project').click();await waitToast('프로젝트를 저장했습니다');
    const file=JSON.parse(await fs.readFile(capturedPath,'utf8'));assert.equal(file.version,2);assert.deepEqual(file.comparisons.at(-1),instant);assert.deepEqual(file.settings,instant.settings);
    await page.evaluate(()=>window.transmissionLab.setSettings({gear:'6'}));await openDialog(capturedPath);
    await page.locator('#open-project').click();await waitToast('프로젝트.*불러왔습니다');
    const loaded=await page.evaluate(()=>window.transmissionLab.project());
    assert.deepEqual(persistentContents(loaded),persistentContents(file));
    restartProject=file;
    assert.notEqual((await state()).snapshot.outputRpm,instant.snapshot.outputRpm);
  });
  await check('native open rejects invalid projects without changing current project', async () => {
    const badPath = path.join(output, 'invalid-project.json');
    await fs.writeFile(badPath, JSON.stringify({ format: 'other-app', version: 1, settings: { type: 'mt' } }));
    const before = await page.evaluate(() => window.transmissionLab.project());
    await openDialog(badPath); await menu('파일', '프로젝트 열기…'); await waitToast('파일을 열 수 없습니다');
    const after = await page.evaluate(() => window.transmissionLab.project());
    assert.deepEqual(after.settings, before.settings); assert.deepEqual(after.view, before.view); assert.deepEqual(after.comparisons, before.comparisons);
    const result = await page.evaluate(() => window.transmissionDesktop.saveProject({ contents: 42 }).then(() => false).catch(() => true));
    assert.equal(result, true);
  });
  await check('native PNG export reports completion and cancellation accurately', async () => {
    await exportPNG(); await waitToast('파일을 저장했습니다');
    await exportPNG(true); await waitToast('취소');
  });
  await check('reload and app restart retain the current project and captured comparisons', async () => {
    // The DCT handover project is the latest native-open fixture; the earlier CVT save is no longer current.
    assert.ok(restartProject);assert.equal(restartProject.settings.type,'dct');assert.equal(restartProject.settings.gear,'2');
    assert.deepEqual(persistentContents(await page.evaluate(()=>window.transmissionLab.project())),persistentContents(restartProject));
    await page.reload(); await page.waitForFunction(() => window.transmissionLab?.getState().scene?.meshCount > 0);
    await page.evaluate(()=>window.transmissionLab.pause());
    assert.deepEqual(persistentContents(await page.evaluate(()=>window.transmissionLab.project())),persistentContents(restartProject));
    assert.equal(await page.locator('[data-speed="0.0333333333"]').evaluate(e => e.classList.contains('active')), true);
    await page.screenshot({ path: path.join(output, 'native-app.png') });
    await app.close(); app = null; await launch();
    assert.deepEqual(persistentContents(await page.evaluate(()=>window.transmissionLab.project())),persistentContents(restartProject));
    await page.screenshot({ path: path.join(output, 'native-app-restarted.png') });
  });
  await check('native new project and reset menu perform expected actions without remote requests', async () => {
    await menu('파일', '새 프로젝트'); await page.waitForFunction(() => window.transmissionLab.getState().settings.type === 'dct');
    await page.evaluate(() => window.transmissionLab.pause()); await menu('실험', '실험 초기화');
    assert.equal((await state()).snapshot.time, 0);
    assert.equal((await state()).view.housingMode, 'cutaway'); assert.equal((await state()).view.housing, 1); assert.equal((await state()).view.cutaway, 0.55);
    await page.screenshot({ path: path.join(output, 'native-cutaway.png') });
    assert.deepEqual(remoteRequests, []); assert.deepEqual(errors, []);
  });
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ version: expectedVersion, executablePath, profile, checks, errors, remoteRequests, state: await state() }, null, 2));
  console.log(`Desktop validation: ${checks.length} checks passed.`);
} catch (error) {
  const diagnostic = page ? await page.evaluate(() => ({ toast: document.querySelector('#toast')?.textContent, state: window.transmissionLab?.getState() })).catch(() => null) : null;
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, checks, errors, remoteRequests, diagnostic }, null, 2));
  throw error;
} finally { if (app) await app.close(); }
