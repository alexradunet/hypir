import { packager } from '@electron/packager';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const { version: electronVersion } = require('electron/package.json');
const { version } = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
const stage = await mkdtemp(path.join(tmpdir(), 'hypir-desktop-'));
try {
  // Stage an explicit runtime allowlist: no workspace source or node_modules.
  for (const filename of ['main.cjs', 'preload.cjs', 'proxy.cjs', 'build']) {
    await cp(path.join(directory, filename), path.join(stage, filename), { recursive: true });
  }
  await writeFile(
    path.join(stage, 'package.json'),
    JSON.stringify({
      name: 'hypir',
      productName: 'hypir',
      version,
      main: 'main.cjs',
      description: 'Standalone Hyperview desktop preview',
    }),
  );
  const artifacts = await packager({
    dir: stage,
    out: path.join(directory, 'dist'),
    name: 'hypir',
    executableName: 'hypir',
    platform: 'linux',
    arch: process.arch,
    electronVersion,
    asar: true,
    prune: false,
    overwrite: true,
  });
  for (const artifact of artifacts) console.log(`Linux application: ${artifact}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
