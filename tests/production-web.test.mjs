import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
try {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('http://127.0.0.1:' + server.httpServer.address().port);
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    assert.match(policy, /script-src 'self'/);
    assert.match(policy, /form-action 'none'/);
    assert.equal(await page.locator('#scene canvas').count(), 1);
    await page.locator('[data-type=mt]').click();
    assert.equal(await page.locator('[data-type=mt]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-type=dct]').click();
    await page.waitForFunction(() => document.querySelector('#clutch-indicator i')?.style.getPropertyValue('--level'));
    assert.deepEqual(await page.evaluate(() => [typeof window.transmissionLab, typeof window.advanceTime, typeof window.render_game_to_text]), ['undefined', 'undefined', 'undefined']);
    assert.deepEqual(errors, []);
    console.log('PASS production web CSP, DCT controls, and absence of test hooks');
  } finally { await browser.close(); }
} finally { await server.close(); }
