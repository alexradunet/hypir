import { build } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const directory = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const output = path.join(directory, 'build');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const result = await build({
  absWorkingDir: directory,
  entryPoints: ['src/index.tsx'],
  outfile: 'build/renderer.js',
  bundle: true,
  metafile: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome148',
  // esbuild 0.28.2 syntax minification drops React Navigation's hydratedState binding.
  // Keep its onStateChange callback intact while compressing names and whitespace.
  minifyWhitespace: true,
  minifyIdentifiers: true,
  legalComments: 'inline',
  mainFields: ['browser', 'module', 'main'],
  resolveExtensions: [
    '.web.tsx',
    '.web.ts',
    '.web.jsx',
    '.web.js',
    '.tsx',
    '.ts',
    '.jsx',
    '.js',
    '.json',
  ],
  alias: { 'react-native': 'react-native-web' },
  define: { __DEV__: 'false', 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  loader: {
    '.js': 'jsx',
    '.png': 'dataurl',
    '.jpg': 'dataurl',
    '.jpeg': 'dataurl',
    '.gif': 'dataurl',
    '.svg': 'dataurl',
    '.webp': 'dataurl',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.ttf': 'dataurl',
  },
});
await copyFile(path.join(directory, 'index.html'), path.join(output, 'index.html'));

// The bundle replaces node_modules at runtime, so retain its packages' licenses.
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  // Browser-field exclusions are virtual empty modules, not files on disk.
  if (input.startsWith('(disabled):')) continue;
  const parts = path.resolve(directory, input).split(path.sep);
  const index = parts.lastIndexOf('node_modules');
  if (index < 0) continue;
  const count = parts[index + 1].startsWith('@') ? 3 : 2;
  packages.add(parts.slice(0, index + count).join(path.sep));
}
const notices = [];
for (const packageDirectory of [...packages].sort()) {
  const metadata = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
  let licenseDirectory = packageDirectory;
  if (
    /^(git\+)?https:\/\/github\.com\/facebook\/react-native\.git$/.test(metadata.repository?.url)
  ) {
    // RN's workspace packages use the monorepo license shipped with react-native.
    licenseDirectory = path.dirname(require.resolve('react-native/package.json'));
  }
  const licenses = (await readdir(licenseDirectory)).filter((name) =>
    /^(licen[sc]e|copying)([.-]|$)/i.test(name),
  );
  if (!licenses.length) throw new Error(`Missing bundled license for ${metadata.name}`);
  notices.push(`${metadata.name}@${metadata.version}`);
  for (const license of licenses.sort()) {
    notices.push(await readFile(path.join(licenseDirectory, license), 'utf8'));
  }
}
await writeFile(path.join(output, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n'));
