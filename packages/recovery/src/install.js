import {
  cp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  realpath,
  chmod,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { managedBackend } from './backend.js';
import { validateCredentials } from './credentials.js';
const ownSource = fileURLToPath(new URL('.', import.meta.url));
const contains = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
async function digestTree(root) {
  const hash = createHash('sha256');
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else {
        const contents = await readFile(file);
        hash.update(JSON.stringify([path.relative(root, file), contents.length]));
        hash.update('\0');
        hash.update(contents);
      }
    }
  }
  await visit(root);
  return hash.digest('hex');
}
export async function install(config, credentials) {
  validateCredentials(credentials);
  const source = await realpath(config.source);
  const project = await realpath(config.project);
  const parent = await realpath(path.dirname(config.home));
  const home = path.join(parent, path.basename(config.home));
  if (
    contains(source, home) ||
    contains(home, source) ||
    contains(project, home) ||
    contains(home, project)
  )
    throw new Error('Recovery home must be outside the managed source and project');
  // Exclusive creation refuses accidental replacement of an existing recovery base.
  await mkdir(home, { mode: 0o700 });
  let backend;
  try {
    await mkdir(path.join(home, 'runtime/lib'), { recursive: true });
    await cp(process.execPath, path.join(home, 'runtime/node'), { dereference: true });
    await chmod(path.join(home, 'runtime/node'), 0o700);
    // Retain dynamically linked runtime libraries as well as Node itself. The
    // platform's loader/kernel remain installation prerequisites, not app code.
    for (const library of process.report.getReport().sharedObjects) {
      if (path.isAbsolute(library))
        await cp(library, path.join(home, 'runtime/lib', path.basename(library)), {
          dereference: true,
        });
    }
    await mkdir(path.join(home, 'base'));
    await writeFile(path.join(home, 'base/package.json'), '{"type":"module"}');
    for (const name of [
      'cli.js',
      'install.js',
      'backend.js',
      'server.js',
      'runner.js',
      'contract.js',
      'credentials.js',
    ])
      await cp(path.join(ownSource, name), path.join(home, 'base', name));
    for (const name of ['daemon', 'protocol']) {
      const target = path.join(home, 'baseline/packages', name);
      await mkdir(target, { recursive: true });
      const metadata = JSON.parse(
        await readFile(path.join(source, 'packages', name, 'package.json'), 'utf8'),
      );
      // This slice retains the existing lean daemon. Refuse a future dependency
      // change rather than silently installing an incomplete known-good version.
      const dependencies = Object.keys(metadata.dependencies ?? {});
      if (dependencies.some((dep) => dep !== '@hypir/protocol'))
        throw new Error(
          'Unsupported baseline dependency; update the recovery installer separately',
        );
      await cp(
        path.join(source, 'packages', name, 'package.json'),
        path.join(target, 'package.json'),
      );
      await cp(path.join(source, 'packages', name, 'src'), path.join(target, 'src'), {
        recursive: true,
        dereference: true,
        filter: (file) => !file.endsWith('.test.js'),
      });
    }
    await mkdir(path.join(home, 'baseline/node_modules/@hypir'), { recursive: true });
    await cp(
      path.join(home, 'baseline/packages/protocol'),
      path.join(home, 'baseline/node_modules/@hypir/protocol'),
      { recursive: true },
    );
    const registration = {
      recoveryVersion: 1,
      project,
      backendHost: config.backendHost,
      backendPort: config.backendPort,
      host: config.host,
      port: config.port,
      baselineRevision: await digestTree(path.join(home, 'baseline')),
      runtime: { version: process.version, platform: process.platform, arch: process.arch },
    };
    backend = managedBackend(home, registration, credentials.backendToken);
    if ((await backend.action('start')).state !== 'running')
      throw new Error('Baseline failed readiness; nothing was registered');
    await backend.close();
    await writeFile(
      path.join(home, 'registration.json.tmp'),
      JSON.stringify(registration, null, 2),
      { mode: 0o600 },
    );
    await rename(path.join(home, 'registration.json.tmp'), path.join(home, 'registration.json'));
    await writeFile(
      path.join(home, 'start'),
      `#!${process.platform === 'android' ? '/system/bin/sh' : '/bin/sh'}\nexport LD_LIBRARY_PATH=${quote(path.join(home, 'runtime/lib'))}\nexec ${quote(path.join(home, 'runtime/node'))} ${quote(path.join(home, 'base/cli.js'))} serve --home ${quote(home)}\n`,
      { mode: 0o700 },
    );
  } catch (error) {
    await backend?.close().catch(() => {});
    await rm(home, { recursive: true, force: true });
    throw error;
  }
}
