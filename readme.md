# Hypir

An Android and Linux development environment for Hyperview apps. The current implementation includes a React Native Android host, a standalone Electron Linux client, a Node.js project daemon, a backend-provided HXML development workspace, live HXML refresh, connection controls, independent backend recovery, and request inspection. Android uses native widgets; Linux uses Hyperview's web implementations through React Native Web. Pi agent/session integration is planned, not implemented. The presentation includes a clearly labeled product concept rather than an interactive demo.

The shared backend direction is specified in [spec #5](https://github.com/alexradunet/hypir/issues/5). The workspace and recovery slices add project inspection, navigation and a retained backend recovery base; Pi, persistent app logic, candidate editing and activation remain later work.

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

On Linux, both processes run directly on the desktop:

```text
Linux desktop
├── Hypir desktop window (Electron + React Native Web + Hyperview)
└── Node.js daemon + local project files

Desktop window <-- isolated main-process transport --> http://127.0.0.1:4747
```

The Linux client shares its connection state machine, HXML renderer integration, and request inspector with Android. It does not require Termux, an Android emulator, Metro, or an Android SDK. Desktop controls are browser-backed, not Android widgets; use the Android app when verifying exact mobile appearance and behavior.

| Directory                  | Purpose                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `apps/android`             | React Native app, Android Gradle host, native preview and connection UI  |
| `apps/desktop`             | Standalone Linux window, isolated daemon transport and packaging         |
| `packages/client`          | Shared Android/desktop connection, live preview and inspection UI        |
| `packages/daemon`          | Linux project server, file watcher, authenticated HTTP/SSE endpoints     |
| `packages/recovery`        | Independent recovery installer, controller and retained-backend launcher |
| `packages/protocol`        | Shared version-2 runtime validators and TypeScript declarations          |
| `examples/hello-hyperview` | Runnable HXML project                                                    |
| `docs`                     | The only presentation site implementation; deployed to GitHub Pages      |

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
curl --fail -H "Authorization: Bearer $HYPIR_TOKEN" http://127.0.0.1:4747/workspace
curl --no-buffer -H "Authorization: Bearer $HYPIR_TOKEN" http://127.0.0.1:4747/api/events
```

Status reports `{protocolVersion: 2, project: {...}, app: {...}, workspace: {...}, connectedClients: ...}`. SSE starts with `daemon.connected` containing the authoritative project/app/workspace snapshot; selection emits `workspace.changed` and edits emit `preview.invalidate`. The client reloads the workspace on reconnect and file changes, including after a daemon restart. Select the registered project and follow its application link; `app.entrypoint` in status provides the current `/apps/<registered-id>/screens/...` URL. Edit `examples/hello-hyperview/screens/index.xml` to exercise the live native preview without rebuilding the APK.

For another project or port:

```bash
node packages/daemon/src/cli.js --project /absolute/path/to/project --port 4747
```

### Connect the Android app to Termux

1. Start the daemon in Termux and verify the status endpoint above.
2. If this device previously used a desktop daemon, run `adb reverse --remove tcp:4747` on the connected development host before testing Termux. Otherwise the old rule can route the app to the host instead.
3. In Hypir, enter `http://127.0.0.1:4747` and the daemon token, then connect. No port forwarding is needed on the same device. Inspect the project identity and entrypoint in the workspace, select **Hello Hyperview**, open its application, and use the host Back control to return.
4. Edit the example HXML in Termux and confirm the native preview refreshes. If the connection fails, check the daemon session, URL, token, and any stale `adb reverse` rule. If updates stop, check that Android has not suspended or killed the Termux process.

### Session lifetime and battery

Termux must remain running while you use the preview. For an active development session, you can optionally run `termux-wake-lock` in Termux to help keep the CPU awake when the screen turns off. Release it with `termux-wake-unlock` when finished; stop the daemon with Ctrl+C. A wake lock increases battery use and does **not** prevent every Android or manufacturer-specific background restriction, memory-pressure kill, or Android 12+ phantom-process limit. After a kill, reopen Termux and restart the daemon; the app resynchronizes on reconnect.

If interruptions persist, review Termux's per-app battery/background settings manually and weigh the battery cost. Hypir setup does not change global Android settings, disable process limits, or promise an always-on background service. See the [Termux background-process warning](https://github.com/termux/termux-app#termux-application) for platform limitations.

### Authentication and network exposure

Loopback binding permits an omitted token for inspection only. Workspace mutation requires a configured token even on loopback. **Non-loopback binding requires `HYPIR_TOKEN`; the daemon refuses to start without it.** A token is also recommended on loopback because other local apps/processes may reach Android's loopback ports. The Termux quick start above reads the token without putting its value in command history.

Keep the default loopback listener for same-device use. Only if a separate, trusted network path requires non-loopback access, set a token before starting it:

```bash
read -rsp 'Daemon token: ' HYPIR_TOKEN; printf '\n'
export HYPIR_TOKEN
npm run dev -- --host 0.0.0.0
```

Use a long, randomly generated secret. Set the same optional token in the Android connection UI; the app keeps it in memory, not persistent settings. Requests to the daemon's API, SSE stream, workspace, and application requests use `Authorization: Bearer <token>`. Do not place secrets in URLs, project files, screenshots, or source control. To check an authenticated endpoint from a shell with the variable set:

```bash
curl --fail -H "Authorization: Bearer $HYPIR_TOKEN" http://127.0.0.1:4747/api/status
```

The daemon rejects requests carrying a browser `Origin` header and does not enable wildcard CORS. This is a native client service, not an API intended for arbitrary web pages. Origin filtering does not replace authentication against native clients or other local processes.

The daemon serves plain HTTP. Bearer authentication does **not** encrypt traffic: keep it on same-device loopback, or use a trusted HTTPS reverse proxy/tunnel for remote transport. Do not expose port 4747 on an untrusted network. `0.0.0.0` is a bind address, never the app's destination URL. Debug APKs permit HTTP for development; release configuration permits cleartext only for `localhost`/`127.0.0.1`. Remote release endpoints must use HTTPS. Tokens are scoped to daemon requests, not arbitrary Hyperview destinations; redirects are disabled in the native client to avoid forwarding credentials to a different destination.

The compatible Hyperview/React Native dependency stack still has upstream npm advisories. Run `npm audit` before distributing builds. In particular, `image-size` has [unpatched image-parser denial-of-service advisories](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr); `decode-uri-component` and `fast-xml-parser` also require dependency migrations beyond the pinned compatible stack. A Lodash security override and compatible Babel/CLI updates are applied; the audit is **not clean**, and incompatible forced upgrades are not a safe fix. Keep Metro on loopback (the default start command does this), build only trusted native source/assets, and do not treat this development build as production-hardened.

## Run the standalone Linux app

Install Node.js **22.12 or newer** (Node 24 LTS recommended), npm, and Git on a Linux desktop, then:

```bash
git clone https://github.com/alexradunet/hypir.git
cd hypir
npm ci
read -rsp 'Daemon token: ' HYPIR_TOKEN; printf '\n'
export HYPIR_TOKEN
npm run dev
```

In a second terminal at the repository root:

```bash
npm run desktop
```

Enter `http://127.0.0.1:4747` and the same token in the desktop window, then connect. Inspect the project identity and entrypoint in the workspace, select the registered project, open its application, and use the host Back control to return. Edit `examples/hello-hyperview/screens/index.xml` with your Linux editor; the preview refreshes without rebuilding the desktop application. The daemon remains a separate process: leave its terminal running and stop it with Ctrl+C when finished.

To build a redistributable Linux application directory:

```bash
npm run build:desktop
```

On x86_64 Linux, run `apps/desktop/dist/hypir-linux-x64/hypir`. Packaging targets the host architecture; outputs are under `apps/desktop/dist/`. Distribute the **whole application directory**, not just its executable. The packaged client includes its JavaScript bundle, third-party license notices, and Electron runtime; it does not need Node/npm, Metro, or an Android SDK to launch. The separate daemon still needs Node.js and its project dependencies. Packaging does not install a launcher, change your desktop configuration, or publish a release.

Run Electron as your normal desktop user with Chromium sandbox support enabled. Do not run it as root or add `--no-sandbox`. Distribution-specific Electron system libraries and sandbox policy still apply.

### Desktop rendering and security

- HXML uses the same Hyperview library as Android, selecting upstream web implementations and React Native Web controls. This is a working preview, not a screenshot or an embedded Android emulator.
- Browser layout, fonts, date pickers, keyboard handling, scrolling, and platform-specific behavior differ from Android. Android-only integrations are not made desktop-compatible by packaging.
- The desktop window is restricted to its own bundled UI and the selected daemon's `/api/`, `/workspace`, `/workspace/`, and `/apps/` resources. Arbitrary external pages, embedded websites, and direct remote assets are blocked; external navigation is not a general-purpose browser feature.
- Credentials are kept in the Electron main process for the current connection, not saved in preferences. The renderer receives a synthetic endpoint rather than the token. Reconnecting invalidates the old endpoint and cancels its requests.
- The daemon's browser-origin rejection remains enabled. The isolated main-process transport sends authenticated requests without exposing a general browser API, disables redirects, and does not forward browser cookies. The Electron renderer retains sandboxing, context isolation, and web security.
- Prefer local loopback. If the daemon is remote, use HTTPS: bearer tokens do not encrypt plain HTTP.

## Desktop development and checks

Use a Linux development machine with Node.js **22.12 or newer** (Node 24 LTS recommended) and npm for the full workspace. The current Electron tooling requires this newer development baseline; the lean daemon still supports Node 20, including in Termux. Desktop daemon access uses Linux `/proc/self/fd` for secure filesystem access. Unlike the lean runtime install, development checks and application builds need the full root workspace dependencies, including development dependencies:

```bash
npm ci
npm test
npm run check
npm run typecheck
```

CI and reproducible clean installs use the committed lockfile. CI checks the lean daemon on Node 20 and the full workspace on Node 24. `npm test` runs protocol, daemon, and desktop transport regression tests; `npm run check` checks JavaScript syntax; `npm run typecheck` checks the shared client and platform applications against their real dependencies. Android SDK tools are only required for building/running the Android app, not the Linux client or these JavaScript checks.

`npm run format` and `npm run format:check` apply the shared Prettier rules to project code and the presentation, excluding native/generated files and local agent configuration. `npm run bundle` checks Metro's production Android bundle without requiring an Android SDK; outputs go to the ignored `apps/android/build/` directory. Run `npm ci` before these desktop commands if this checkout previously had only the daemon-only install.

## Build and run the Android host

Build on a development machine with:

- Node 22.12+ and npm, with root workspace dependencies installed.
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

`entrypoint` is an absolute **URL path within the screens directory**, not a host filesystem path. `/flows/start.xml` maps to `screens/flows/start.xml` and is served at `/apps/<registered-id>/screens/flows/start.xml`. The former `/preview/` route is retired. It must identify an existing regular `.xml` file when the daemon starts. `screens` is a relative directory inside the project root. Traversal, symlinked screens directories/path components, and symlinked preview files are rejected; keep real files in the project instead. The Linux descriptor-based checks protect preview access from symlink swaps, but the project owner is trusted to edit the project: this is not a sandbox against privileged processes or hardlinks planted by a local same-user attacker.

## Presentation site and CI

`docs/` is the only presentation implementation. The root `index.html` redirects there and preserves the query string and fragment when JavaScript is enabled. To preview the canonical site (Python 3 required):

```bash
npm run docs
```

Open `http://localhost:4173`. The standard Python server has its own missing-page response; visit `/404.html` directly to inspect the custom recovery page locally.

`.github/workflows/pages.yml` uploads **only `docs/`** when those files change on `main`, or on manual dispatch. Select **GitHub Actions** as the repository's Pages source. The workflow stamps the deployment's configured base path into the 404 home link, so nested missing URLs return to the correct project Pages or domain-root home without guessing a repository name; local root deployment defaults to `/`. A manually hosted subdirectory should set that same `docs/404.html` home link to its deployment base.

`.github/workflows/ci.yml` tests the lean daemon runtime on Node 20 and installs the full locked workspace on Node 24. Both run regression tests and JavaScript syntax checks. Node 24 also checks shared/platform TypeScript and formatting, produces the Android JavaScript bundle and Linux application package, and repeats tests after a daemon-only install. These checks do not build an APK or establish on-device Termux compatibility; native builds and end-to-end device verification remain separate.

## Historical preview validation (before the workspace cutover)

The Android API 35 x86_64 emulator was exercised against a Linux host daemon through `adb reverse`. The debug APK was built for both ARM64 and x86_64 with JDK 17. Verified scenarios include the shipped example, a nested manifest entrypoint, live HXML edits, populated native date-field interaction, starting the daemon after the app, daemon restart with a changed manifest, background/foreground resynchronization, token rejection/recovery, incompatible protocol rejection, and preventing an authenticated redirect from reaching another origin.

The daemon/protocol regression suite also passes from an actual Termux terminal on the Android API 35 x86_64 emulator: Termux v0.118.3 (official GitHub debug build), updated Termux packages, and native Android Node.js v24.18.0. The daemon-only install adds two workspace packages without React Native or development dependencies. Verified native app-to-Termux behavior includes token rejection/recovery, live HXML edits, daemon stop/restart, and foreground resynchronization. Port 4747 has **no `adb reverse` rule** in this test; only Metro's port 8081 is forwarded. Physical ARM64 devices, Android 7, and vendor-specific battery/process-killing policies still need representative device testing.

The standalone Linux client was exercised on x86_64 Linux with Electron 44.3.0, both from source and from the packaged executable launched outside the repository working directory. Verified scenarios include authentication rejection/recovery, live HXML edits, text entry, picker selection, calendar date selection, stack navigation, daemon restart with a changed manifest entrypoint, and continued live updates from the packaged app. Renderer access to Node APIs, direct daemon networking, and local files is blocked. The shared preview now supplies the navigation container required by HXML stack navigators.

The 24 protocol/daemon/desktop transport regression tests pass on Node 20 after a lean daemon install and on Node 24 after a full locked install. Full workspace TypeScript, syntax, formatting, Android production bundle, and Linux packaging checks pass. The extracted shared client was also exercised in the Android API 35 emulator: authentication recovery, live preview refresh, and stack navigation to another HXML screen work. Linux ARM64 packages, other distributions, and Android-specific device integrations in desktop HXML remain unverified; desktop previews are not an Android rendering-fidelity guarantee.

## Bundled Android client with native Termux

For ordinary use without a desktop-hosted Metro process, build the bundled local-testing variant on the provisioning machine:

```bash
npm run build:android:standalone
adb install -r apps/android/android/app/build/outputs/apk/standalone/app-standalone.apk
```

This variant embeds the JavaScript/assets and disables developer support. It uses the checked-in public debug signing key for local testing only; distributed release APKs still require private signing. Building an APK and demonstrating its operation are separate checks. The ordinary debug variant above remains a Metro development workflow.

Start the backend in **native Termux**, with the repository under Termux's private `$HOME` (not shared `/sdcard` storage, proot, or a desktop-mounted directory), using the lean installation above and a nonempty `HYPIR_TOKEN`. Remove any `adb reverse` rules for ports 4747 and 8081 when switching from desktop testing, stop Metro, and launch the bundled Hypir app. Connect to `http://127.0.0.1:4747` with the same token. Inspect the actual project root, identity and entrypoint; select the project, open the application, then use Back to return to the workspace. No desktop service participates in this workflow after provisioning.

Stop the Termux daemon to check the disconnected state, then restart it and confirm the workspace reloads. Android may terminate Termux or the client in the background; the user may need to reopen Termux and restart the backend. This setup does not promise background execution or immunity to process killing.

## Workspace HTTP/HXML/SSE contract (version 2)

- `GET /api/status` returns `protocolVersion: 2`, the validated project manifest, registered `app`, `workspace` snapshot, and connected-client count. `GET /api/events` starts every stream with `daemon.connected` carrying the same project/app/workspace snapshot. Selection emits `workspace.changed`; file changes still emit `preview.invalidate`. Events have `version: 2`. Version-1 clients must update.
- `GET /workspace/navigation` supplies the HXML stack navigator; `GET /workspace` supplies project inspection and actions. Both clients render these documents through the existing Hyperview library. The host owns only connection controls, rendering/navigation chrome, disconnected status, and request inspection.
- The backend derives the registered app ID from the canonical project root using SHA-256. It remains stable across backend restarts at that location; moving/copying the repository creates a separate installation identity. `app.projectRoot` is the real canonical root, `app.entrypoint` is its public HXML URL, and `app.kind: app` / `app.execution: active` distinguish it from `workspace.kind: workspace` / `workspace.id: hypir.workspace`. This static slice does not execute project backend code or create persistent app data.
- The workspace supplies a targeted HXML fragment action (`verb="post"`, `action="replace"`) at `POST /workspace/select/<registered-id>`. It verifies the entrypoint still exists, selects that registered project in backend memory, and returns the updated workspace fragment with the Open application link. It requires bearer authentication and `X-Hypir-Protocol-Version: 2`; unknown IDs, query parameters and nonempty payloads are rejected. Clients cannot submit a filesystem path. Incompatible mutation versions return 409. No configured token means mutations return 401, even on loopback.
- `GET /apps/<registered-id>/screens/<path>.xml` serves the actual project screen using the existing descriptor-relative containment protections. Relative screen links stay within that app's screens URL tree; old absolute `/preview/` links need migration. HXML responses report `X-Hypir-Context: workspace` or `app:active`. The old static preview route is not an alternate execution path.
- A new stream always supplies authoritative state, with no replay of actions. Selection is intentionally in-memory in this slice: reconnecting to the same backend retains it, while restarting resets it. The hosts retire the renderer and cancel pending requests on disconnection, backgrounding, connection replacement, or a fresh render generation; old responses cannot update the replacement renderer. Recoverable host connection input remains, but application form input is not retained across these reloads. An interrupted action has an unknown outcome until fresh state arrives and is never automatically retried.
- Bearer scoping, native redirect rejection, desktop isolated credential ownership, request cancellation, browser-origin rejection, and app filesystem containment remain required. HTTP is not encrypted; use loopback or a trusted HTTPS transport as described above.

A manifest may optionally declare `capabilities`, for example `"capabilities": ["text", "view", "date-field", "push", "back"]`. Names reuse the installed Hyperview vocabulary. The conservative shared baseline is exported as `SHARED_HXML_CAPABILITIES` in the protocol package: view, text, image, list, section-list, text-field, date-field, picker-field, option, select-single, select-multiple, switch, spinner, form, behavior, navigator, push, back, replace, replace-inner, reload, append and prepend. Unknown or platform-only declarations (for example camera or web-view) are listed in `app.unsupportedCapabilities` and the workspace; selection and app loading return 422. Undeclared capabilities are not inferred from arbitrary XML: declare requirements explicitly and verify the actual client. This is descriptive compatibility information, not a sandbox, complete schema validator, or a promise of identical fonts, layouts, keyboard behavior, remote-asset access or native integrations.

## Workspace validation status

The combined protocol, daemon, recovery, and desktop-transport suite passes **32 regression tests on Node 20.20.2**. Both platform TypeScript checks, the desktop renderer build, and the standalone Android APK build pass. Gradle tracks the hoisted shared-client inputs: changing them rebundles the APK, while an unchanged build remains up to date.

The version-2 workspace was exercised in the actual Linux client with Electron 44.3.0 and in the standalone Android client on the API 35 x86_64 emulator, using official GitHub Termux 0.118.3 and native Android Node 24.18.0. The APK was built with JDK 17.0.20.1. Android-to-Termux operation used **no Metro server or `adb reverse` rules**. Both clients completed project inspection, selection, application rendering, Back navigation, and backend stop/reconnect. Android also exercised rejected credentials and successful reconnection, unsupported-capability blocking, and foreground resynchronization without replaying selection.

The standalone variant uses a public testing key, not a production signing identity. Physical ARM64 phones, Android 7, vendor-specific process policies, Linux ARM64, and other desktop distributions remain unverified. Historical date-field and packaging results above are not a claim that every scenario was repeated for this cutover.

## Independent backend recovery

Use the separately installed [recovery base](docs/recovery.md) to inspect, start,
stop or recover a retained backend when the normal workspace cannot load. Both
clients expose **Backend recovery** outside the normal renderer, with a separate
URL and mandatory recovery token (`HYPIR_RECOVERY_TOKEN`), distinct from the
managed backend’s mandatory `HYPIR_TOKEN`. The recovery guide covers installation, retained runtime
material, operational boundaries and the required user restart if Android kills
Termux itself. The guide records the verified recovery scenarios and remaining
platform limitations.
