const { randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { maxProjectBytes, projectSizeError } = require('../src/project-limits.json');
const { windowsSaveProject } = require('./windows-save.cjs');

async function readProjectFile(target) {
  const file = await fs.open(target, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxProjectBytes) throw new Error(projectSizeError);
    const chunks = [];
    let size = 0;
    while (size <= maxProjectBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxProjectBytes + 1 - size));
      const { bytesRead } = await file.read(buffer);
      if (!bytesRead) break;
      size += bytesRead;
      chunks.push(buffer.subarray(0, bytesRead));
    }
    if (size > maxProjectBytes) throw new Error(projectSizeError);
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
  } finally {
    await file.close();
  }
}

async function saveProjectFile(target, contents, temporaryName = randomUUID()) {
  if (typeof contents !== 'string' || contents.length > maxProjectBytes || Buffer.byteLength(contents) > maxProjectBytes) {
    throw new Error(projectSizeError);
  }
  if (process.platform === 'win32') return windowsSaveProject(target, contents, temporaryName);
  const temporary = path.join(path.dirname(target), '.transmission-' + temporaryName + '.tmp');
  const file = await fs.open(temporary, 'wx', 0o600);
  let installed = false;
  try {
    try {
      await file.writeFile(contents, 'utf8');
      await file.sync();
    }
    finally { await file.close(); }
    await fs.rename(temporary, target);
    installed = true;
  } finally {
    if (!installed) await fs.unlink(temporary).catch(() => {});
  }
}

module.exports = { readProjectFile, saveProjectFile };
