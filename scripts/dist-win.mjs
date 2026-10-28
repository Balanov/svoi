import { resolve } from 'node:path';
import { Arch, Platform, build } from 'electron-builder';

delete process.env.ELECTRON_RUN_AS_NODE;
await build({
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  config: { directories: { output: resolve(process.env.SVOI_WINDOWS_OUTPUT || 'release') }, electronDist: process.env.SVOI_ELECTRON_DIST ? resolve(process.env.SVOI_ELECTRON_DIST) : undefined },
});
console.log('Windows build completed');
