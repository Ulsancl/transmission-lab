import { checkedPath, readInput, copyInput, stagingDirectory, publishDirectory, writeArtifact, checkTree } from './safe-files.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildWeb } from './web-build.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (!['start', 'package', 'release', 'prepare-test', 'package-test'].includes(mode)) throw new Error('Invalid desktop build mode');
if (mode === 'prepare-test' && process.env.TRANSMISSION_DESKTOP_EXE) process.exit(0);
const testHooks = mode === 'prepare-test' || mode === 'package-test';
const signing = mode === 'release';
if (signing && (process.platform !== 'win32' || !/^[a-f0-9]{64}$/i.test(process.env.TRANSMISSION_SIGNER_SHA256 ?? ''))) {
  throw new Error('Release packaging requires Windows and TRANSMISSION_SIGNER_SHA256 (the SHA-256 fingerprint of the publisher certificate)');
}
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Process exited with code ${code}`)));
  });
}
const stage = stagingDirectory(root);
try {
  const app = path.join(stage, 'app');
  const output = path.join(stage, 'windows');
  const configuration = JSON.parse(readInput(root, path.join(root, 'electron-builder.json')));
  const packageInfo = JSON.parse(readInput(root, path.join(root, 'package.json')));
  const inputs = [...new Set(['desktop', 'src/project-limits.json', ...configuration.extraResources.map(item => item.from)])];
  for (const input of inputs.filter(file => !inputs.some(parent => file !== parent && file.startsWith(parent + '/')))) {
    copyInput(root, path.join(root, input), path.join(app, input));
  }
  delete packageInfo.transmissionTestBuild;
  if (testHooks) packageInfo.transmissionTestBuild = true;
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify(packageInfo), { flag: 'wx', mode: 0o600 });
  await buildWeb(path.join(app, 'dist'), { testHooks });

  // Electron's only explicit install hook prepares the lockfile-selected runtime.
  const electronPackage = path.dirname(checkedPath(root, require.resolve('electron/package.json')));
  checkTree(root, electronPackage);
  await run(process.execPath, [path.join(electronPackage, 'install.js')]);
  if (mode === 'start') {
    await run(require('electron'), [app]);
  } else if (mode === 'prepare-test') {
    publishDirectory(root, app, path.join(root, 'release', 'desktop-test-source'));
  } else {
    for (const dependency of Object.keys(packageInfo.dependencies || {})) {
      const input = path.join('node_modules', dependency);
      copyInput(root, path.join(root, input), path.join(app, input));
    }
    const electronDist = checkedPath(root, path.join(root, 'node_modules', 'electron', 'dist'));
    checkTree(root, electronDist);
    configuration.electronDist = electronDist;
    configuration.directories.output = output;
    configuration.npmRebuild = false;
    if (signing) configuration.forceCodeSigning = true;
    // Playwright uses the main-process inspector to drive native dialogs and menus.
    if (testHooks) configuration.electronFuses.enableNodeCliInspectArguments = true;
    const config = path.join(stage, 'electron-builder.json');
    fs.writeFileSync(config, JSON.stringify(configuration), { flag: 'wx', mode: 0o600 });
    const builder = checkedPath(root, path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js'));
    await run(process.execPath, [builder, '--win', testHooks ? 'dir' : 'nsis', '--x64', '--config', config, '--projectDir', app, '--publish', 'never']);
    const destination = path.join(root, 'release', testHooks ? 'desktop-test-package' : 'windows');
    if (!testHooks) {
      const file = path.join(output, `Transmission-Lab-Setup-${packageInfo.version}.exe`);
      if (signing) {
        const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const verifier = checkedPath(root, path.join(root, 'scripts', 'verify-authenticode.ps1'));
        await run(powershell, ['-NoProfile', '-NonInteractive', '-File', verifier, '-Installer', file, '-Application', path.join(output, 'win-unpacked', 'Transmission Lab.exe')]);
      }
      writeArtifact(root, file + '.sha256', `${createHash('sha256').update(readInput(root, file)).digest('hex')}  ${path.basename(file)}\n`);
      console.log(`Installer: ${path.join(destination, path.basename(file))}`);
    }
    publishDirectory(root, output, destination);
  }
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
