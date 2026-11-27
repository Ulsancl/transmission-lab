import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import projectFiles from '../desktop/project-files.cjs';
import windowsSave from '../desktop/windows-save.cjs';
import { maxProjectBytes } from '../src/project.js';

const { readProjectFile, saveProjectFile } = projectFiles;
const isWindows = process.platform === 'win32';

async function fixture(t) {
  const parent = path.resolve(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(parent, 'transmission-project-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), parent);
    assert.match(path.basename(resolved), /^transmission-project-/);
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return directory;
}

test('native open and save enforce the UTF-8 budget at its boundary', async t => {
  const root = await fixture(t);
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
  const root = await fixture(t);
  const target = path.join(root, 'project.json');
  const existingName = isWindows ? '.transmission-save-existing' : '.transmission-existing.tmp';
  const existing = path.join(root, existingName);
  if (isWindows) await fs.mkdir(existing);
  const existingFile = isWindows ? path.join(existing, 'retained.txt') : existing;
  await fs.writeFile(existingFile, 'retained fixture');
  await assert.rejects(saveProjectFile(target, '{}', 'existing'), isWindows ? /권한/ : { code: 'EEXIST' });
  assert.equal(await fs.readFile(existingFile, 'utf8'), 'retained fixture');
  await fs.mkdir(target);
  await assert.rejects(saveProjectFile(target, '{}', 'owned'));
  assert.deepEqual((await fs.readdir(root)).sort(), [existingName, 'project.json']);
});

test('Windows saves create a private file and preserve an existing explicit DACL', { skip: !isWindows }, async t => {
  const root = await fixture(t);
  const existing = path.join(root, 'existing.json');
  const fresh = path.join(root, '새 프로젝트.json');
  const contents = '{"name":"새 프로젝트"}';
  await fs.writeFile(existing, '{"name":"previous"}');
  const runPowerShell = script => {
    const command = Buffer.from("$ErrorActionPreference = 'Stop'\n" + script, 'utf16le').toString('base64');
    const result = spawnSync(windowsSave.windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
      encoding: 'utf8',
      windowsHide: true,
      env: windowsSave.windowsPowerShellEnv({ TRANSMISSION_EXISTING_FIXTURE: existing, TRANSMISSION_FRESH_FIXTURE: fresh }),
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout.trim();
  };
  const before = runPowerShell(`
    $file = $env:TRANSMISSION_EXISTING_FIXTURE
    $acl = [IO.File]::GetAccessControl($file)
    $acl.SetAccessRuleProtection($true, $false)
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $acl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user, 'FullControl', 'Allow'))
    if ($user -ne $system) {
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($system, 'Read', 'Allow'))
    }
    [IO.File]::SetAccessControl($file, $acl)
    [IO.File]::GetAccessControl($file).GetSecurityDescriptorSddlForm('Access')
  `);
  assert.match(before, /^D:P/);
  await saveProjectFile(existing, contents);
  await saveProjectFile(fresh, contents);
  assert.equal(await fs.readFile(existing, 'utf8'), contents);
  assert.equal(await fs.readFile(fresh, 'utf8'), contents);
  assert.deepEqual((await fs.readdir(root)).sort(), ['existing.json', '새 프로젝트.json']);
  const after = runPowerShell("[IO.File]::GetAccessControl($env:TRANSMISSION_EXISTING_FIXTURE).GetSecurityDescriptorSddlForm('Access')");
  assert.equal(after, before);
  const isPrivate = runPowerShell(`
    $acl = [IO.File]::GetAccessControl($env:TRANSMISSION_FRESH_FIXTURE)
    $rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $rules.Count -eq 1 -and $rules[0].IdentityReference -eq $user -and $rules[0].FileSystemRights -eq 'FullControl'
  `);
  assert.equal(isPrivate, 'True');
});
