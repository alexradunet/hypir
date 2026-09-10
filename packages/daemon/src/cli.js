#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { createDaemon } from './server.js';

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => { const index = args.indexOf(flag); return index === -1 ? fallback : args[index + 1]; };
const projectRoot = path.resolve(valueAfter('--project', '.'));
const port = Number(valueAfter('--port', process.env.HYPIR_PORT ?? '4747'));
const host = valueAfter('--host', process.env.HYPIR_HOST ?? '127.0.0.1');

const daemon = await createDaemon({ projectRoot, host, port });
await daemon.listen();
console.log(`Hypir daemon: http://${host}:${port}`);
console.log(`Project: ${daemon.project.manifest.name} (${projectRoot})`);

const shutdown = async () => { await daemon.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
