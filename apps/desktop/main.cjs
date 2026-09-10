const { app, BrowserWindow, ipcMain, session } = require('electron');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { APP_ORIGIN, APP_URL, createDaemonProxy, isAppSender } = require('./proxy.cjs');

app.enableSandbox();
app.setName('Hypir');

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' http://*.hypir.local",
  "img-src 'self' http://*.hypir.local data: blob:",
  "media-src 'self' http://*.hypir.local blob:",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
const ASSETS = new Map([
  [`${APP_ORIGIN}/index.html`, ['index.html', 'text/html; charset=utf-8']],
  [`${APP_ORIGIN}/renderer.js`, ['renderer.js', 'text/javascript; charset=utf-8']],
  [`${APP_ORIGIN}/renderer.css`, ['renderer.css', 'text/css; charset=utf-8']],
]);
const proxy = createDaemonProxy();
const recoveryProxy = createDaemonProxy({ scope: 'recovery' });
const closeTransports = () => {
  proxy.close();
  recoveryProxy.close();
};
let window;
let desktopSession;

function deny() {
  return new Response('Request is not allowed', {
    status: 403,
    headers: { 'content-type': 'text/plain' },
  });
}

async function start() {
  // This partition is deliberately not prefixed with persist:. Authentication and
  // browser state belong only to this window's lifetime, never the default session.
  desktopSession = session.fromPartition('hypir-desktop', { cache: false });
  desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  desktopSession.setPermissionCheckHandler(() => false);
  desktopSession.setDevicePermissionHandler(() => false);
  desktopSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  desktopSession.on('will-download', (event) => event.preventDefault());

  const assets = new Map();
  for (const [url, [filename, contentType]] of ASSETS) {
    try {
      assets.set(url, {
        body: await readFile(path.join(__dirname, 'build', filename)),
        contentType,
      });
    } catch (error) {
      if (filename === 'renderer.css' && error.code === 'ENOENT') continue;
      throw new Error('Desktop bundle is missing; run npm run desktop from the repository');
    }
  }
  desktopSession.webRequest.onBeforeRequest((details, callback) => {
    const isAsset =
      assets.has(details.url) && (details.method === 'GET' || details.method === 'HEAD');
    const isDaemon =
      (proxy.accepts(details.url) || recoveryProxy.accepts(details.url)) &&
      !['mainFrame', 'subFrame', 'script', 'stylesheet', 'font', 'object', 'cspReport'].includes(
        details.resourceType,
      );
    callback({ cancel: !isAsset && !isDaemon });
  });
  await desktopSession.protocol.handle('http', async (request) => {
    const asset = assets.get(request.url);
    if (asset && (request.method === 'GET' || request.method === 'HEAD')) {
      return new Response(request.method === 'HEAD' ? null : asset.body, {
        headers: {
          'content-type': asset.contentType,
          'content-security-policy': CSP,
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'cross-origin-resource-policy': 'same-origin',
          'referrer-policy': 'no-referrer',
          'cache-control': 'no-store',
        },
      });
    }
    if (recoveryProxy.accepts(request.url)) return recoveryProxy.handle(request);
    return proxy.accepts(request.url) ? proxy.handle(request) : deny();
  });

  window = new BrowserWindow({
    title: 'Hypir',
    width: 1200,
    height: 850,
    minWidth: 720,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      session: desktopSession,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: false,
      navigateOnDragDrop: false,
      spellcheck: false,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('page-title-updated', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', () => {
    closeTransports();
    app.quit();
  });
  ipcMain.handle('hypir:connect', (event, value) => {
    if (!isAppSender(event, window?.webContents))
      throw new Error('Connection sender is not allowed');
    return proxy.connect(value);
  });
  ipcMain.handle('hypir:connect-recovery', (event, value) => {
    if (!isAppSender(event, window?.webContents))
      throw new Error('Connection sender is not allowed');
    return recoveryProxy.connect(value);
  });
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => {
    closeTransports();
    window = undefined;
    ipcMain.removeHandler('hypir:connect');
    ipcMain.removeHandler('hypir:connect-recovery');
    app.quit();
  });
  await window.loadURL(APP_URL);
}

app.on('before-quit', closeTransports);
app.on('window-all-closed', () => app.quit());
app
  .whenReady()
  .then(start)
  .catch(() => {
    // Do not log exception objects: networking/IPC exceptions can include secrets.
    console.error('Hypir could not start. Ensure the desktop bundle has been built.');
    closeTransports();
    app.exit(1);
  });
