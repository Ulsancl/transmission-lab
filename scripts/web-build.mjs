import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkedPath, checkTree, copyInput, publishDirectory, secureDirectory, stagingDirectory } from './safe-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export async function buildWeb(destination = path.join(root, 'dist'), { testHooks = false } = {}) {
  const stage = stagingDirectory(root);
  try {
    const inputRoot = secureDirectory(root, path.join(stage, 'source'));
    for (const input of ['index.html', 'vite.config.js', 'package.json', 'src', 'public', 'node_modules/three']) {
      copyInput(root, path.join(root, input), path.join(inputRoot, input));
    }
    const viteRoot = path.dirname(checkedPath(root, require.resolve('vite/package.json')));
    checkTree(root, viteRoot);
    const vite = checkedPath(root, path.join(viteRoot, 'dist/node/index.js'));
    const { build } = await import(pathToFileURL(vite));
    const outDir = secureDirectory(root, path.join(stage, 'bundle'));
    await build({
      root: inputRoot,
      configFile: path.join(inputRoot, 'vite.config.js'),
      envFile: false,
      define: { __TRANSMISSION_TEST_HOOKS__: testHooks },
      build: { outDir, emptyOutDir: false },
    });
    checkTree(root, outDir);
    publishDirectory(root, outDir, destination);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildWeb();
