import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import projectFiles from '../desktop/project-files.cjs';
import { maxProjectBytes } from '../src/project.js';

const { readProjectFile, saveProjectFile } = projectFiles;

test('native open and save enforce the UTF-8 budget at its boundary', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'transmission-project-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'project.json');
  const contents = '가'.repeat(Math.floor(maxProjectBytes / 3)) + 'aa';
  assert.equal(Buffer.byteLength(contents), maxProjectBytes);
  await saveProjectFile(target, contents);
  assert.equal(await readProjectFile(target), contents);
  await assert.rejects(saveProjectFile(target, contents + 'a'), /2 MiB/);
  assert.equal((await fs.stat(target)).size, maxProjectBytes);
  await fs.appendFile(target, 'a');
  await assert.rejects(readProjectFile(target), /2 MiB/);
});

test('native save cleans only its own temporary file', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'transmission-save-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'project.json');
  const existing = path.join(root, '.transmission-existing.tmp');
  await fs.writeFile(existing, 'retained fixture');
  await assert.rejects(saveProjectFile(target, '{}', 'existing'), { code: 'EEXIST' });
  assert.equal(await fs.readFile(existing, 'utf8'), 'retained fixture');
  await fs.mkdir(target);
  await assert.rejects(saveProjectFile(target, '{}', 'owned'));
  assert.deepEqual((await fs.readdir(root)).sort(), ['.transmission-existing.tmp', 'project.json']);
});
