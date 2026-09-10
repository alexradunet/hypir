# Hypir

An Android-first development environment for native Hyperview apps. The current implementation includes a runnable React Native Android host, a Node.js project daemon, live HXML preview refresh, connection controls, and request inspection. Pi agent/session integration is planned, not implemented. The presentation includes a clearly labeled product concept rather than an interactive demo.

## Architecture

```text
Android device
├── Hypir Android app
│   └── React Native / Hermes + native Hyperview renderer
└── Android Linux Terminal
    └── Debian virtual machine
        ├── Project files and HXML screens
        └── Node.js daemon: HTTP preview + server-sent events

Android app <-- verified Terminal port forwarding --> Debian daemon
```

The app renders actual native Hyperview components, not a WebView. The Node runtime and project filesystem live inside **Android Linux Terminal's Debian VM**, outside Hermes. Android and Debian have separate network environments: `127.0.0.1` does not cross that boundary without forwarding. Availability of Linux Terminal and its virtualization support depends on the physical device and Android build.

| Directory                  | Purpose                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| `apps/android`             | React Native app, Android Gradle host, native preview and connection UI |
| `packages/daemon`          | Linux project server, file watcher, authenticated HTTP/SSE endpoints    |
| `packages/protocol`        | Shared version-1 runtime validators and TypeScript declarations         |
| `examples/hello-hyperview` | Runnable HXML project                                                   |
| `docs`                     | The only presentation site implementation; deployed to GitHub Pages     |

## Install and check

Use Linux with Node.js **20 or newer** and npm. Node 24 LTS is recommended; CI exercises Node 20 and 24. The daemon requires Linux `/proc/self/fd` for secure filesystem access, including when developing on a desktop. Android SDK tools are only required for building/running the native app, not the JavaScript checks.

From the repository root:

```bash
npm install
npm test
npm run check
npm run typecheck
```

This is an npm workspace repository: install at the root, not separately in each package. CI and reproducible clean installs use `npm ci` with the committed lockfile. `npm test` runs protocol/daemon regression tests; `npm run check` checks JavaScript syntax; `npm run typecheck` checks the Android TypeScript application against its real dependencies.

`npm run format` and `npm run format:check` apply the shared Prettier rules to project code and the presentation, excluding native/generated files and local agent configuration. `npm run bundle` checks Metro's production Android bundle without requiring an Android SDK; outputs go to the ignored `apps/android/build/` directory.

## Run the daemon in Debian

Inside Android Linux Terminal's Debian VM, install a supported Node.js version and npm, clone this repository, and run the install command above. Check `node --version`; a distribution's default Node package may be older than required. Keep the daemon running in Terminal:

```bash
npm run dev
```

The default project is `examples/hello-hyperview`, listening at `127.0.0.1:4747` **inside Debian**. In another Debian shell:

```bash
curl --fail http://127.0.0.1:4747/api/status
curl --fail http://127.0.0.1:4747/preview/index.xml
curl --no-buffer http://127.0.0.1:4747/api/events
```

Status reports `{protocolVersion: 1, project: {...}, connectedClients: ...}`. SSE starts with `daemon.connected` containing the current manifest; edits emit `preview.invalidate`. The app refreshes from the current manifest on every connection and invalidates its preview on reconnect and file changes, including after a daemon restart. Edit `examples/hello-hyperview/screens/index.xml` to exercise the live native preview without rebuilding the APK.

For another project or port:

```bash
node packages/daemon/src/cli.js --project /absolute/path/to/project --port 4747
```

### Connect the Android app to the VM

1. Verify the status endpoint **inside Debian** first using the command above.
2. Use the port-forwarding facility available in your installed Terminal version to forward guest TCP port `4747` to Android. Terminal versions differ; do not assume it is enabled or that a specific settings menu exists.
3. In Hypir, enter the forwarded daemon URL (normally `http://127.0.0.1:4747` when Android-side port 4747 is forwarded) and connect. Verify the app reports a connection and displays **Hello Hyperview**. A successful VM-local `curl` alone does not prove Android can reach it.
4. Edit the example HXML in Debian and confirm the native preview refreshes. If status works but updates do not, check that the forwarding path supports a long-lived SSE connection and that Terminal/the daemon remain running.

If the forwarding mechanism requires a non-loopback guest listener, configure an authentication token **before** using `--host 0.0.0.0` (see below). `0.0.0.0` is a bind address, never the app's destination URL. Use only the address and port actually reachable from Android; do not guess a VM IP or assume shared localhost. When connection fails, check guest listener, enabled forwarding, Android-side destination, and token independently.

AOSP's [Terminal/custom VM guide](https://android.googlesource.com/platform/packages/modules/Virtualization/+/refs/heads/android15-qpr2-s2-release/docs/custom_vm.md) distinguishes VM addresses from localhost with forwarding enabled. The [Terminal forwarding implementation](https://android.googlesource.com/platform/packages/modules/Virtualization/+/HEAD/android/TerminalApp/java/com/android/virtualization/terminal/DebianServiceImpl.kt) tracks active guest ports and explicitly enabled forwarding. These describe the architecture, not a promise that every shipping device exposes identical controls.

### Authentication and network exposure

Loopback binding permits an omitted token. **Non-loopback binding requires `HYPIR_TOKEN`; the daemon refuses to start without it.** A token is also recommended on loopback because other local apps/processes may reach forwarded ports.

In a Bash session, read a token without putting its value into command history:

```bash
read -rsp 'Daemon token: ' HYPIR_TOKEN; printf '\n'
export HYPIR_TOKEN
npm run dev -- --host 0.0.0.0
```

Use a long, randomly generated secret. Set the same optional token in the Android connection UI; the app keeps it in memory, not persistent settings. Requests to the daemon's API, SSE stream, and preview use `Authorization: Bearer <token>`. Do not place secrets in URLs, project files, screenshots, or source control. To check an authenticated endpoint from a shell with the variable set:

```bash
curl --fail -H "Authorization: Bearer $HYPIR_TOKEN" http://127.0.0.1:4747/api/status
```

The daemon rejects requests carrying a browser `Origin` header and does not enable wildcard CORS. This is a native client service, not an API intended for arbitrary web pages. Origin filtering does not replace authentication against native clients or other local processes.

The daemon serves plain HTTP. Bearer authentication does **not** encrypt traffic: keep it on loopback through a trusted forwarding path, or use a trusted HTTPS reverse proxy/tunnel for remote transport. Do not expose port 4747 on an untrusted network. Debug APKs permit HTTP for development; release configuration permits cleartext only for `localhost`/`127.0.0.1`. Remote release endpoints must use HTTPS. Tokens are scoped to daemon requests, not arbitrary Hyperview destinations; redirects are disabled in the native client to avoid forwarding credentials to a different destination.

The compatible Hyperview/React Native dependency stack still has upstream npm advisories. Run `npm audit` before distributing builds. In particular, `image-size` has [unpatched image-parser denial-of-service advisories](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr); `decode-uri-component` and `fast-xml-parser` also require dependency migrations beyond the pinned compatible stack. A Lodash security override and compatible Babel/CLI updates are applied; the audit is **not clean**, and incompatible forced upgrades are not a safe fix. Keep Metro on loopback (the default start command does this), build only trusted native source/assets, and do not treat this development build as production-hardened.

## Build and run the Android host

Build on a development machine with:

- Node/npm and root workspace dependencies installed.
- **JDK 17**.
- Android SDK **Platform 35**, **Build-Tools 35.0.0**, platform-tools (`adb`), and the SDK/NDK components requested by Gradle. Accept the SDK licenses.
- `ANDROID_HOME` pointing to the SDK and its `platform-tools` on `PATH` (or configure `sdk.dir` in the ignored `apps/android/android/local.properties`).
- An Android device with USB debugging authorized, or an Android emulator. The app's minimum Android API level is **24**; that does not imply Linux Terminal is available on API 24 devices.

The checked-in Gradle wrapper and native application host require no external starter project. From the repository root:

```bash
npm run build
```

This builds the debug APK using the Android workspace's Gradle host. Its output is `apps/android/android/app/build/outputs/apk/debug/app-debug.apk`. A debug build expects Metro; it is not a standalone release bundle. Start Metro in a separate terminal:

```bash
npm start
```

With a device/emulator visible in `adb devices`, install and launch the development app:

```bash
adb reverse tcp:8081 tcp:8081
npm run android
```

The workspace equivalents are `npm run start --workspace @hypir/android` and `npm run android --workspace @hypir/android`. Direct Gradle builds are available with `./gradlew assembleDebug` from `apps/android/android`. Build/install the APK on the development machine, then use it with the daemon in the device's Debian VM; compiling Android inside the VM is not required.

Release artifacts are not signed with the public debug key. Supply a private Android release-signing configuration before distribution. The date-field formatter uses date-fns Unicode patterns, such as `yyyy-MM-dd` or `MMMM d, yyyy`, for HXML `label-format`.

### Emulator or USB-device development against a desktop daemon

This is a **different network path** from Android Terminal forwarding. Run `npm run dev` on a Linux development host, then forward Android's port 4747 back to that host:

```bash
adb reverse tcp:4747 tcp:4747
adb reverse --list
```

Use `http://127.0.0.1:4747` in Hypir. For multiple devices, supply `adb -s <serial>` consistently. The separate `8081` reverse rule above serves Metro; `4747` serves the daemon. Remove a daemon reverse rule with `adb reverse --remove tcp:4747` before switching the same device to its own Terminal VM, so it does not mask the VM forwarding path.

An emulator can exercise the native client, HTTP/SSE, and live preview against a **host daemon**. This does not verify Android Linux Terminal, AVF availability, nested virtualization, or actual device-to-VM forwarding. Validate the full on-device architecture on a supported physical device.

## Project manifest

Every project has a `hyperview.json`:

```json
{
  "name": "Hello Hyperview",
  "entrypoint": "/index.xml",
  "screens": "screens"
}
```

`entrypoint` is an absolute **URL path within the screens directory**, not a host filesystem path. `/flows/start.xml` maps to `screens/flows/start.xml` and is served at `/preview/flows/start.xml`. It must identify an existing regular `.xml` file when the daemon starts. `screens` is a relative directory inside the project root. Traversal, symlinked screens directories/path components, and symlinked preview files are rejected; keep real files in the project instead. The Linux descriptor-based checks protect preview access from symlink swaps, but the project owner is trusted to edit the project: this is not a sandbox against privileged processes or hardlinks planted by a local same-user attacker.

## Presentation site and CI

`docs/` is the only presentation implementation. The root `index.html` redirects there and preserves the query string and fragment when JavaScript is enabled. To preview the canonical site (Python 3 required):

```bash
npm run docs
```

Open `http://localhost:4173`. The standard Python server has its own missing-page response; visit `/404.html` directly to inspect the custom recovery page locally.

`.github/workflows/pages.yml` uploads **only `docs/`** when those files change on `main`, or on manual dispatch. Select **GitHub Actions** as the repository's Pages source. The workflow stamps the deployment's configured base path into the 404 home link, so nested missing URLs return to the correct project Pages or domain-root home without guessing a repository name; local root deployment defaults to `/`. A manually hosted subdirectory should set that same `docs/404.html` home link to its deployment base.

`.github/workflows/ci.yml` installs with `npm ci` and runs tests, JavaScript syntax checks, and Android TypeScript checks on Node 20 and 24. Node 24 additionally checks formatting and produces a native JavaScript bundle to catch Metro/package-resolution failures. These checks do not build an APK or establish physical-device/VM compatibility; native builds and end-to-end device verification remain separate.

## Verified development scenarios

The Android API 35 x86_64 emulator was exercised against a Linux host daemon through `adb reverse`. The debug APK was built for both ARM64 and x86_64 with JDK 17. Verified scenarios include the shipped example, a nested manifest entrypoint, live HXML edits, populated native date-field interaction, starting the daemon after the app, daemon restart with a changed manifest, background/foreground resynchronization, token rejection/recovery, incompatible protocol rejection, and preventing an authenticated redirect from reaching another origin.

The daemon/protocol regression suite passes on Node 20, 24, and 26. Actual Android Linux Terminal forwarding and Debian VM lifecycle still need verification on a supported physical device; the emulator checks do not establish those capabilities.
