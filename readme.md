# Hypir

An Android-first development environment for native Hyperview apps. The current implementation includes a runnable React Native Android host, a Node.js project daemon, live HXML preview refresh, connection controls, and request inspection. Pi agent/session integration is planned, not implemented. The presentation includes a clearly labeled product concept rather than an interactive demo.

The next feature milestone—reversible Pi editing, HXML diagnostics, and last-good native previews—is specified in [implementation plan #4](https://github.com/alexradunet/hypir/issues/4). That plan is not a claim that agent features have already shipped.

## Architecture

```text
Android device
├── Hypir Android app
│   └── React Native + native Hyperview renderer
└── Termux
    ├── Project files and HXML screens in private $HOME
    └── Native Node.js daemon: HTTP preview + server-sent events

Android app <-- http://127.0.0.1:4747 --> Termux daemon
```

The app renders actual native Hyperview components, not a WebView. The Node runtime and project filesystem live in **Termux**, outside the app's JavaScript runtime. Termux runs natively on Android: the app and daemon share Android loopback, so same-device connections need no port forwarding, Debian, proot, or virtual machine.

| Directory                  | Purpose                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| `apps/android`             | React Native app, Android Gradle host, native preview and connection UI |
| `packages/daemon`          | Linux project server, file watcher, authenticated HTTP/SSE endpoints    |
| `packages/protocol`        | Shared version-1 runtime validators and TypeScript declarations         |
| `examples/hello-hyperview` | Runnable HXML project                                                   |
| `docs`                     | The only presentation site implementation; deployed to GitHub Pages     |

## Install and run in Termux

Install Termux from [F-Droid](https://f-droid.org/en/packages/com.termux/) or the official [Termux GitHub releases](https://github.com/termux/termux-app/releases). Follow the [official installation guidance](https://github.com/termux/termux-app#installation): full app and package support starts at **Android 7**, matching Hypir's minimum API level 24. This is a baseline, not a guarantee for every device or Android build. For GitHub releases, choose the Android 7+ release matching your device architecture, or the universal APK; do not use a legacy Android 5/6 build. Download only from the official repository. Keep Termux and any optional plugins from the same source; their signatures differ between F-Droid and GitHub.

In Termux, install Node.js and Git, then clone into Termux's private home directory:

```bash
pkg update
pkg upgrade
pkg install nodejs-lts git
cd "$HOME"
git clone https://github.com/alexradunet/hypir.git
cd hypir
node --version
npm run install:daemon
read -rsp 'Daemon token: ' HYPIR_TOKEN; printf '\n'
export HYPIR_TOKEN
npm run dev
```

Use Node.js **20 or newer** and npm; Node 24 LTS is recommended, and CI exercises Node 20 and 24. Enter a long, randomly generated token at the prompt and use the same token in Hypir. Keep this Termux session running. The daemon uses secure descriptor-based filesystem access on Linux and native Android; no guest distribution is needed.

`npm run install:daemon` performs a locked daemon-only workspace install with development dependencies omitted. The current daemon needs only Node.js and the shared protocol package; it does not need ripgrep, Pi, Android build tools, or the React Native dependency tree. Pi integration is still planned. Run all npm commands from the repository root, not separately inside packages.

Keep repositories and projects under Termux's private `$HOME`, not `/sdcard`, `/storage/emulated/0`, or `~/storage/shared`. Shared storage lacks the filesystem semantics needed for reliable Node.js projects and broadens access to project data. No shared-storage permission or `termux-setup-storage` step is needed for this setup.

The default project is `examples/hello-hyperview`, listening at `http://127.0.0.1:4747`. For optional endpoint checks, install `curl` with `pkg install curl`. In a second Termux session, enter the same token:

```bash
read -rsp 'Daemon token: ' HYPIR_TOKEN; printf '\n'
export HYPIR_TOKEN
curl --fail -H "Authorization: Bearer $HYPIR_TOKEN" http://127.0.0.1:4747/api/status
curl --fail -H "Authorization: Bearer $HYPIR_TOKEN" http://127.0.0.1:4747/preview/index.xml
curl --no-buffer -H "Authorization: Bearer $HYPIR_TOKEN" http://127.0.0.1:4747/api/events
```

Status reports `{protocolVersion: 1, project: {...}, connectedClients: ...}`. SSE starts with `daemon.connected` containing the current manifest; edits emit `preview.invalidate`. The app refreshes from the current manifest on every connection and invalidates its preview on reconnect and file changes, including after a daemon restart. Edit `examples/hello-hyperview/screens/index.xml` to exercise the live native preview without rebuilding the APK.

For another project or port:

```bash
node packages/daemon/src/cli.js --project /absolute/path/to/project --port 4747
```

### Connect the Android app to Termux

1. Start the daemon in Termux and verify the status endpoint above.
2. If this device previously used a desktop daemon, run `adb reverse --remove tcp:4747` on the connected development host before testing Termux. Otherwise the old rule can route the app to the host instead.
3. In Hypir, enter `http://127.0.0.1:4747` and the daemon token, then connect. No port forwarding is needed on the same device. Verify the connection and the **Hello Hyperview** preview.
4. Edit the example HXML in Termux and confirm the native preview refreshes. If the connection fails, check the daemon session, URL, token, and any stale `adb reverse` rule. If updates stop, check that Android has not suspended or killed the Termux process.

### Session lifetime and battery

Termux must remain running while you use the preview. For an active development session, you can optionally run `termux-wake-lock` in Termux to help keep the CPU awake when the screen turns off. Release it with `termux-wake-unlock` when finished; stop the daemon with Ctrl+C. A wake lock increases battery use and does **not** prevent every Android or manufacturer-specific background restriction, memory-pressure kill, or Android 12+ phantom-process limit. After a kill, reopen Termux and restart the daemon; the app resynchronizes on reconnect.

If interruptions persist, review Termux's per-app battery/background settings manually and weigh the battery cost. Hypir setup does not change global Android settings, disable process limits, or promise an always-on background service. See the [Termux background-process warning](https://github.com/termux/termux-app#termux-application) for platform limitations.

### Authentication and network exposure

Loopback binding permits an omitted token. **Non-loopback binding requires `HYPIR_TOKEN`; the daemon refuses to start without it.** A token is also recommended on loopback because other local apps/processes may reach Android's loopback ports. The Termux quick start above reads the token without putting its value in command history.

Keep the default loopback listener for same-device use. Only if a separate, trusted network path requires non-loopback access, set a token before starting it:

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

The daemon serves plain HTTP. Bearer authentication does **not** encrypt traffic: keep it on same-device loopback, or use a trusted HTTPS reverse proxy/tunnel for remote transport. Do not expose port 4747 on an untrusted network. `0.0.0.0` is a bind address, never the app's destination URL. Debug APKs permit HTTP for development; release configuration permits cleartext only for `localhost`/`127.0.0.1`. Remote release endpoints must use HTTPS. Tokens are scoped to daemon requests, not arbitrary Hyperview destinations; redirects are disabled in the native client to avoid forwarding credentials to a different destination.

The compatible Hyperview/React Native dependency stack still has upstream npm advisories. Run `npm audit` before distributing builds. In particular, `image-size` has [unpatched image-parser denial-of-service advisories](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr); `decode-uri-component` and `fast-xml-parser` also require dependency migrations beyond the pinned compatible stack. A Lodash security override and compatible Babel/CLI updates are applied; the audit is **not clean**, and incompatible forced upgrades are not a safe fix. Keep Metro on loopback (the default start command does this), build only trusted native source/assets, and do not treat this development build as production-hardened.

## Desktop development and checks

Use a Linux development machine with Node.js **20 or newer** and npm. Desktop daemon access uses Linux `/proc/self/fd` for secure filesystem access. Unlike the lean Termux runtime install, development checks and native builds need the full root workspace dependencies, including development dependencies:

```bash
npm ci
npm test
npm run check
npm run typecheck
```

CI and reproducible clean installs use the committed lockfile. `npm test` runs protocol/daemon regression tests; `npm run check` checks JavaScript syntax; `npm run typecheck` checks the Android TypeScript application against its real dependencies. Android SDK tools are only required for building/running the native app, not these JavaScript checks.

`npm run format` and `npm run format:check` apply the shared Prettier rules to project code and the presentation, excluding native/generated files and local agent configuration. `npm run bundle` checks Metro's production Android bundle without requiring an Android SDK; outputs go to the ignored `apps/android/build/` directory. Run `npm ci` before these desktop commands if this checkout previously had only the daemon-only install.

## Build and run the Android host

Build on a development machine with:

- Node/npm and root workspace dependencies installed.
- **JDK 17**.
- Android SDK **Platform 35**, **Build-Tools 35.0.0**, platform-tools (`adb`), and the SDK/NDK components requested by Gradle. Accept the SDK licenses.
- `ANDROID_HOME` pointing to the SDK and its `platform-tools` on `PATH` (or configure `sdk.dir` in the ignored `apps/android/android/local.properties`).
- An Android device with USB debugging authorized, or an Android emulator. The app's minimum Android API level is **24** (Android 7); device-specific Termux background restrictions still apply.

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

The workspace equivalents are `npm run start --workspace @hypir/android` and `npm run android --workspace @hypir/android`. Direct Gradle builds are available with `./gradlew assembleDebug` from `apps/android/android`. Build/install the APK on the development machine, then use it with the daemon in the device's Termux session; compiling Android in Termux is not required. The debug app still needs the separate Metro connection described above.

Release artifacts are not signed with the public debug key. Supply a private Android release-signing configuration before distribution. The date-field formatter uses date-fns Unicode patterns, such as `yyyy-MM-dd` or `MMMM d, yyyy`, for HXML `label-format`.

### Emulator or USB-device development against a desktop daemon

This is a **different network path** from same-device Termux. Run `npm run dev` on a Linux development host, then forward Android's port 4747 back to that host:

```bash
adb reverse tcp:4747 tcp:4747
adb reverse --list
```

Use `http://127.0.0.1:4747` in Hypir. For multiple devices, supply `adb -s <serial>` consistently. The separate `8081` reverse rule above serves Metro; `4747` serves the daemon. Before switching to a daemon inside Termux on the same device, remove only the daemon rule:

```bash
adb reverse --remove tcp:4747
adb reverse --list
```

An emulator can exercise the native client, HTTP/SSE, and live preview against a **host daemon**. Those checks do not verify a daemon running in Termux or Android background lifecycle behavior. Test the Termux session directly on the intended Android device or emulator without a daemon reverse rule.

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

`.github/workflows/ci.yml` installs with `npm ci` and runs tests, JavaScript syntax checks, and Android TypeScript checks on Node 20 and 24. Node 24 additionally checks formatting, produces a native JavaScript bundle to catch Metro/package-resolution failures, and verifies that the regression suite works after a daemon-only install. These checks do not build an APK or establish on-device Termux compatibility; native builds and end-to-end device verification remain separate.

## Verified development scenarios

The Android API 35 x86_64 emulator was exercised against a Linux host daemon through `adb reverse`. The debug APK was built for both ARM64 and x86_64 with JDK 17. Verified scenarios include the shipped example, a nested manifest entrypoint, live HXML edits, populated native date-field interaction, starting the daemon after the app, daemon restart with a changed manifest, background/foreground resynchronization, token rejection/recovery, incompatible protocol rejection, and preventing an authenticated redirect from reaching another origin.

The daemon/protocol regression suite also passes from an actual Termux terminal on the Android API 35 x86_64 emulator: Termux v0.118.3 (official GitHub debug build), updated Termux packages, and native Android Node.js v24.18.0. The daemon-only install adds two workspace packages without React Native or development dependencies. Verified native app-to-Termux behavior includes token rejection/recovery, live HXML edits, daemon stop/restart, and foreground resynchronization. Port 4747 has **no `adb reverse` rule** in this test; only Metro's port 8081 is forwarded. Physical ARM64 devices, Android 7, and vendor-specific battery/process-killing policies still need representative device testing.
