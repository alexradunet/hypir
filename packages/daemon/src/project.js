import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { validateManifest } from '@hypir/protocol';

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const descriptorPath = (directory, name) => `/proc/self/fd/${directory.fd}/${name}`;

// Linux/Android descriptor-relative traversal pins each directory before opening its child.
// No screens component may be a symlink, including the final file. Unlike
// realpath-then-read this cannot be redirected by replacing a checked pathname.
// Project owners are trusted to author content; this is not a sandbox against
// privileged processes or same-user attackers creating hardlinks, relocating
// pinned directories outside the project, or mutating already-open files.
async function openChild(directory, parts, flags) {
  let current = directory;
  try {
    for (const part of parts.slice(0, -1)) {
      const next = await open(descriptorPath(current, part), directoryFlags);
      if (current !== directory) await current.close();
      current = next;
    }
    return await open(descriptorPath(current, parts.at(-1)), flags);
  } finally {
    if (current !== directory) await current.close();
  }
}

function screenParts(requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    throw new TypeError('Invalid screen path');
  }
  const parts = decoded.split('/');
  if (
    !parts.every(
      (part) => part && part !== '.' && part !== '..' && !/[\\\u0000-\u001f\u007f]/u.test(part),
    ) ||
    !parts.at(-1).endsWith('.xml')
  ) {
    throw new TypeError('Invalid screen path');
  }
  return parts;
}

export async function readScreen(project, requestPath) {
  const file = await openChild(project.directory, screenParts(requestPath), fileFlags);
  try {
    if (!(await file.stat()).isFile()) throw new TypeError('Screen must be a regular file');
    return await file.readFile('utf8');
  } finally {
    await file.close();
  }
}

export async function loadProject(projectRoot) {
  if (process.platform !== 'linux' && process.platform !== 'android')
    throw new Error('The daemon requires native Termux on Android or Linux with /proc/self/fd');
  const root = await realpath(path.resolve(projectRoot));
  const rootDirectory = await open(root, directoryFlags);
  let directory;
  try {
    try {
      const probe = await open(descriptorPath(rootDirectory, '.'), directoryFlags);
      await probe.close();
    } catch (cause) {
      throw new Error(
        'Secure project access requires accessible /proc/self/fd. Run in native Termux on Android or Linux with procfs available.',
        { cause },
      );
    }
    const manifestFile = await open(descriptorPath(rootDirectory, 'hyperview.json'), fileFlags);
    let manifest;
    try {
      if (!(await manifestFile.stat()).isFile()) throw new TypeError('Invalid project manifest');
      manifest = JSON.parse(await manifestFile.readFile('utf8'));
    } finally {
      await manifestFile.close();
    }
    if (!validateManifest(manifest)) throw new TypeError('Invalid project manifest');
    directory = await openChild(rootDirectory, manifest.screens.split('/'), directoryFlags);
    const project = { root, screens: path.join(root, manifest.screens), directory, manifest };
    await readScreen(project, manifest.entrypoint.slice(1));
    return project;
  } catch (error) {
    await directory?.close();
    throw error;
  } finally {
    await rootDirectory.close();
  }
}
