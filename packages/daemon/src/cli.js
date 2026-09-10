#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { createDaemon, validateOptions } from './server.js';

function options(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--project', '--port', '--host'].includes(flag))
      throw new TypeError('Expected --project, --port, or --host');
    const value = args[index + 1];
    if (values.has(flag) || !value || value.startsWith('--'))
      throw new TypeError('Each option requires exactly one value and may appear only once');
    values.set(flag, value);
  }
  const portValue = values.get('--port') ?? process.env.HYPIR_PORT ?? '4747';
  if (!/^\d+$/u.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535)
    throw new TypeError('Port must be an integer between 1 and 65535');
  const config = {
    projectRoot: path.resolve(values.get('--project') ?? '.'),
    host: values.get('--host') ?? process.env.HYPIR_HOST ?? '127.0.0.1',
    port: Number(portValue),
    token: process.env.HYPIR_TOKEN,
  };
  validateOptions(config);
  return config;
}

let daemon;
let stopping;
const report = (error) => {
  console.error(`Hypir daemon: ${error.message}`);
  process.exitCode = 1;
};
const shutdown = () => {
  if (!stopping) stopping = daemon.close().catch(report);
  return stopping;
};

try {
  const config = options(process.argv.slice(2));
  daemon = await createDaemon({ ...config, onError: report });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  const address = await daemon.listen();
  if (!stopping) {
    const hostname = address.family === 'IPv6' ? `[${address.address}]` : address.address;
    console.log(`Hypir daemon: http://${hostname}:${address.port}`);
    console.log(`Project: ${daemon.project.manifest.name}`);
  }
} catch (error) {
  if (!stopping) report(error);
  if (daemon) await shutdown();
}
