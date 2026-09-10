import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));

async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'build', 'dist'].includes(entry.name) || entry.name.startsWith('.'))
      continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await checkDirectory(filename);
    } else if (/\.[cm]?js$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', filename], { stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exitCode = 1;
    }
  }
}

for (const directory of ['apps', 'packages', 'scripts']) {
  await checkDirectory(path.join(root, directory));
}
