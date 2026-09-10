import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export async function loadProject(projectRoot) {
  const root = path.resolve(projectRoot);
  const manifest = JSON.parse(await readFile(path.join(root, 'hyperview.json'), 'utf8'));
  if (!manifest.name || !manifest.entrypoint) {
    throw new Error('hyperview.json requires name and entrypoint');
  }
  const screens = path.resolve(root, manifest.screens ?? 'screens');
  if (!(await stat(screens)).isDirectory()) throw new Error('screens must be a directory');
  return { root, screens, manifest };
}

export function resolveScreen(project, requestPath) {
  const relative = decodeURIComponent(requestPath).replace(/^\/+/, '');
  const candidate = path.resolve(project.screens, relative);
  const prefix = `${project.screens}${path.sep}`;
  if (!candidate.startsWith(prefix) || path.extname(candidate) !== '.xml') {
    throw new Error('Invalid screen path');
  }
  return candidate;
}
