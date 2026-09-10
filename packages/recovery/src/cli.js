#!/usr/bin/env node
import path from 'node:path';
import { isIP } from 'node:net';
import { install } from './install.js';
import { serve } from './server.js';
import { validateCredentials } from './credentials.js';

try {
  const [command, ...args] = process.argv.slice(2);
  if (!['install', 'serve'].includes(command)) throw new Error('Use install or serve');
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (
      !(
        command === 'serve'
          ? ['--home']
          : [
              '--home',
              '--source',
              '--project',
              '--host',
              '--port',
              '--backend-host',
              '--backend-port',
            ]
      ).includes(key) ||
      options[key] !== undefined ||
      !args[index + 1] ||
      args[index + 1].startsWith('--')
    )
      throw new Error('Invalid recovery options');
    options[key] = args[index + 1];
  }
  const credentials = {
    recoveryToken: process.env.HYPIR_RECOVERY_TOKEN,
    backendToken: process.env.HYPIR_TOKEN,
  };
  validateCredentials(credentials);
  if (!options['--home']) throw new Error('--home is required');
  const home = path.resolve(options['--home']);
  if (command === 'install') {
    if (!options['--source'] || !options['--project'])
      throw new Error('--source and --project are required');
    const config = {
      home,
      source: path.resolve(options['--source']),
      project: path.resolve(options['--project']),
      host: options['--host'] ?? '127.0.0.1',
      backendHost: options['--backend-host'] ?? '127.0.0.1',
      port: Number(options['--port'] ?? 4748),
      backendPort: Number(options['--backend-port'] ?? 4747),
    };
    for (const value of [config.port, config.backendPort])
      if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Invalid port');
    for (const value of [config.host, config.backendHost])
      if (!isIP(value) && value !== 'localhost') throw new Error('Invalid bind host');
    if (config.port === config.backendPort)
      throw new Error('Recovery and backend require separate ports');
    await install(config, credentials);
    console.log(
      'Retained baseline verified. Start the independently installed recovery home/start launcher.',
    );
  } else {
    const base = await serve(home, credentials);
    const shutdown = () => {
      void base.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    console.log('Recovery controls are listening. The backend remains stopped until requested.');
  }
} catch (error) {
  console.error(`Hypir recovery: ${error.message}`);
  process.exitCode = 1;
}
