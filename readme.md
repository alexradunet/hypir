# Hypir

An Android-first agentic development environment for Hyperview applications.

This repository now contains the first runnable slice of the proposed architecture rather than a presentation site:

```text
apps/android                 React Native ADE shell and native Hyperview preview
packages/daemon              Termux-friendly project server and file watcher
packages/protocol            Shared, versioned wire-message definitions
examples/hello-hyperview     A runnable HXML project
```

## Run the local development loop

Node.js 20 or newer is the only requirement for the daemon.

```bash
npm run dev
```

Then open:

- `http://127.0.0.1:4747/api/status` for daemon/project state.
- `http://127.0.0.1:4747/preview/index.xml` for the example HXML.
- `http://127.0.0.1:4747/api/events` for the server-sent event stream.

Editing `examples/hello-hyperview/screens/index.xml` emits a `preview.invalidate` event. The Android app subscribes to that stream and changes the Hyperview entrypoint URL's revision parameter, causing the native renderer to refetch without an APK rebuild.

## Android app

`apps/android` contains the React Native application source. It intentionally keeps the Node-oriented agent runtime across the localhost boundary. Install its dependencies in a React Native Android host, run the daemon in Termux, and set `DAEMON_URL` in `src/config.ts` if the host is not `127.0.0.1`.

The first slice includes connection status, native Hyperview rendering, automatic preview invalidation, and a small captured-request inspector. Pi SDK/session integration is the next daemon capability; it belongs there rather than in Hermes.

## Presentation site

The product presentation is retained in `docs/` and deployed to GitHub Pages by `.github/workflows/pages.yml` whenever it changes on `main`. Repository maintainers need to select **GitHub Actions** as the Pages source once in the repository settings.

Preview it locally with:

```bash
npm run docs
```

## Project manifest

Each project is described by `hyperview.json`:

```json
{
  "name": "Hello Hyperview",
  "entrypoint": "/index.xml",
  "screens": "screens"
}
```

Paths are resolved inside the project root and traversal attempts are rejected.
