// This launcher belongs to the separately installed recovery base. It launches
// the retained actual daemon and cannot select paths from HTTP request data.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { requireToken } from './credentials.js';
let daemon;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await daemon?.close();
  if (process.connected) process.disconnect();
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
process.on('disconnect', () => {
  void stop();
});
try {
  const backendToken = requireToken(process.env.HYPIR_TOKEN, 'HYPIR_TOKEN');
  const { createDaemon } = await import(
    pathToFileURL(path.join(process.argv[2], 'packages/daemon/src/server.js'))
  );
  daemon = await createDaemon({
    projectRoot: process.argv[3],
    host: process.argv[4],
    port: Number(process.argv[5]),
    token: backendToken,
    onError: () => {
      process.exitCode = 1;
      void stop();
    },
  });
  if (stopping) await daemon.close();
  else {
    await daemon.listen();
    if (!stopping) process.send?.({ ready: true });
  }
} catch {
  process.exitCode = 1;
  await stop();
}
