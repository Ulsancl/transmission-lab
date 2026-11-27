import assert from 'node:assert/strict';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';

const executable = process.argv[2];
const fuses = await getCurrentFuseWire(executable);
for (const [key, expected] of Object.entries({
  RunAsNode: '0',
  EnableNodeOptionsEnvironmentVariable: '0',
  EnableNodeCliInspectArguments: '0',
  EnableEmbeddedAsarIntegrityValidation: '1',
  OnlyLoadAppFromAsar: '1',
  GrantFileProtocolExtraPrivileges: '0',
})) {
  assert.equal(String.fromCharCode(fuses[FuseV1Options[key]]), expected, key);
}
console.log('PASS production Electron fuse wire');
