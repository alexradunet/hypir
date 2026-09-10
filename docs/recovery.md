# Independent backend recovery

Recovery runs as a separate process on port 4748. The normal daemon remains on
4747 with protocol version 2 and the `/workspace` and `/apps/...` routes. Both scopes require distinct tokens even on loopback;
no action is routed through the normal workspace or Pi. This slice starts the
retained existing daemon only. Candidate replacement and activation are separate
work and are not exposed as arbitrary command/path/revision parameters.

## Install a retained baseline

Stop any existing daemon using the intended backend port. On Linux or in native
Termux, in Bash from a trusted Hypir checkout with the existing daemon dependencies:

```sh
read -rsp 'Recovery token: ' HYPIR_RECOVERY_TOKEN; printf '\n'
read -rsp 'Backend token: ' HYPIR_TOKEN; printf '\n'
export HYPIR_RECOVERY_TOKEN HYPIR_TOKEN
node packages/recovery/src/cli.js install \
  --source "$PWD" \
  --project "$PWD/examples/hello-hyperview" \
  --home "$HOME/.hypir-recovery"
"$HOME/.hypir-recovery/start"
```

Choose two different long random tokens: `HYPIR_RECOVERY_TOKEN` authorizes only
the recovery control plane, and `HYPIR_TOKEN` authorizes only the normal backend.
Installation and serving reject missing, equal, or invalid tokens (each must be
1–4096 printable ASCII characters without spaces). The managed backend receives
only `HYPIR_TOKEN`; its readiness probe uses that backend credential. Recovery
credentials never enter the managed backend environment, public status or logs.
Neither token is written into registration, retained source, or the startup script.
The hidden-input prompts above keep values out of command history; do not use
literal token assignments or enable shell tracing when entering/exporting secrets.

In a fresh shell, including after restarting Termux, enter and export both values
before running the standalone installed launcher. It inherits them from this shell
and does not need the source checkout or a saved credentials file:

```sh
read -rsp 'Recovery token: ' HYPIR_RECOVERY_TOKEN; printf '\n'
read -rsp 'Backend token: ' HYPIR_TOKEN; printf '\n'
export HYPIR_RECOVERY_TOKEN HYPIR_TOKEN
"$HOME/.hypir-recovery/start"
```

Keep the recovery process running independently of the backend. The installation
directory must not already exist, and its parent must exist. Use `--port`,
`--backend-port`, `--host`, and `--backend-host` during installation if defaults are unsuitable. Only local operator installation accepts
these configuration options; HTTP clients cannot change them.

Installation copies the actual daemon and protocol code, their current complete
runtime dependency material, the Node executable, and the loaded shared libraries
into a private directory outside both the managed source and project. It launches
that retained daemon, waits for the child to bind and answer HTTP, and shuts it
down before registering the baseline. Failure leaves no registered installation.
The revision shown by the controls identifies the retained backend files; later
edits or loss of the original backend checkout cannot change those files. A future
daemon dependency beyond the current protocol package makes installation fail
explicitly until the separately maintained installer supports retaining it.

The Node binary and libraries are for the same platform/architecture as the
installation. The operating system kernel, executable loader and system services
remain prerequisites; this is not a portable container or an OS backup. The
startup script and managed child select the retained library directory. Provider
credentials and source-loader environment options are not inherited by the
managed child. No dependency installation or model request is part of recovery.

The registered project remains at its original location: repositories, private
sessions, runtime files and app-data directories are never reset, cleaned, copied
back or restored during start/stop/recover. If the project itself was removed or
its manifest is invalid, the current static daemon cannot load it; recovery will
honestly report failed startup. Repair that project separately without overwriting
its data. Backend code recovery is not project/data rollback.

## Use the platform client

Open **Backend recovery** beneath the normal connection controls on Android or
Linux. Enter the independent recovery URL (normally `http://127.0.0.1:4748`) and
`HYPIR_RECOVERY_TOKEN` value, then select **Connect recovery**. The panel displays
the backend state, retained revision, and last sanitized failure. **Inspect** reads authoritative
status; **Start backend**, **Stop backend**, and **Recover baseline** are explicit
lifecycle actions. The panel stays available while the normal workspace cannot
load. Connect the normal client to port 4747 using the `HYPIR_TOKEN` value to view
the backend after readiness. Each endpoint rejects the other scope’s credential.
Recovery and normal connections can be reconfigured independently.

The panel polls status and reloads it on foreground resume. It never polls or
replays lifecycle writes. If an action response is lost, it reports an unknown
outcome and obtains status instead of claiming success. Unsupported recovery
versions disable lifecycle controls until a compatible status is obtained. Linux
keeps recovery credentials in its isolated main process and uses a separate
virtual origin; Android scopes them to the exact configured recovery origin and
routes. Existing redirect and browser-origin protections remain in force.

## Public controls

The separate origin exposes `GET /recovery/v1/status` and empty-body authenticated
`POST /recovery/v1/start`, `/stop`, and `/recover`. Supply
`Authorization: Bearer <recovery-token>`. Requests with browser Origin are rejected.
Remote connections still require the documented secure tunnel or HTTPS transport; bearer
authentication does not encrypt plain HTTP. Do not expose either port to an
untrusted network without that protection.

The versioned JSON status uses `recoveryVersion: 1`, a `baselineRevision`, `state`
(`stopped`, `starting`, `running`, `stopping`, or `failed`), the managed `pid` (or
null), and a sanitized `failure` code (or null). It does not redefine the daemon's
`PROTOCOL_VERSION` or status envelope. A PID alone never means healthy: the child
must bind successfully and pass an authenticated HTTP readiness probe. The retained
runner signals readiness only after its own listener binds; the controller also
requires that child to remain alive and `/api/status` to return HTTP 200 using
`HYPIR_TOKEN`. Readiness deliberately does not parse the normal status envelope,
so recovery version 1 remains independent of daemon protocol version 2. Failed
startup returns HTTP 503 with the status. Conflicting lifecycle actions return
409; failure diagnostics survive a graceful base restart without replaying actions.
Repeated starts/recoveries share one transition or return the already healthy
baseline. Recovery never silently queues a later replacement behind another action.

`recover` stops an unhealthy managed child, if necessary, and starts the registered
retained baseline. If that baseline is already healthy, it is a no-op. `stop`
waits for exit, escalating from SIGTERM to SIGKILL after a bounded interval. An
unexpected child exit becomes failure. Restarting the recovery base itself never
automatically replays a lifecycle action.

## Operational boundary

The installed recovery directory (including `base`, `runtime`, `baseline`,
registration, diagnostics and `start`) is reserved for the user-controlled recovery
update path. It is outside ordinary managed source and project roots and must be
excluded from all future candidate editing/integration/activation target lists.
The installed base runs its own copy of the launcher and controller; ordinary
backend edits cannot replace that running mechanism. Changes to
`packages/recovery` are a separately reviewed recovery-base release and do not
update existing installations. The active development session cannot approve or
reinstall its own recovery base. An operator must stop and separately provision a
new recovery installation when intentionally updating it.

This is an operational guardrail for failed **trusted** code. Same-user hostile
code can access the filesystem and processes; separate directories, processes and
private modes are not tamper-proof isolation or a sandbox.

If Android kills Termux itself, both backend and recovery can disappear. Reopen
Termux, re-enter/export both tokens, and run the installed `start` launcher; then
inspect and start/recover from the client. A killed runtime cannot resurrect
itself. Wake locks and battery settings do not guarantee survival.

## Verified recovery scenarios

- The combined suite passes 32 regressions on Node 20.20.2, including five real
  recovery lifecycle cases. These cover retained source loss, failed startup and
  preserved diagnostics, occupied-listener readiness rejection, independent
  desktop transport, distinct credentials across restart, and invalid credentials.
- The actual Linux Electron 44.3.0 client connected to an independently installed
  recovery base while the normal backend was stopped, started its retained
  protocol-v2 backend, opened the application, stopped it, and recovered it through
  the stable controls. The local recovery runtime was Node 26.7.0.
- Native Android validation used the API 35 x86_64 emulator, official GitHub
  Termux 0.118.3, and Node 24.18.0. Installation copied and successfully launched
  the native Node runtime and its loaded libraries. Recovery remained usable
  after the original source was made unavailable and after the managed backend
  was killed; a private project-data marker remained unchanged.
- The bundled Android client, with no Metro server or daemon reverse forwarding,
  exercised independent recovery connection, start, application use, stop,
  recovery, and foreground resynchronization. An actual managed-process failure
  was visible in the native controls and recovered from that same UI. Recovery
  and backend endpoints rejected each other's credentials.

No Pi or model access participated in these recovery scenarios. Physical ARM64
devices, Android 7, vendor battery/process policies, Linux ARM64, and other
distributions remain unverified. Recovery still requires the user's intervention
if Android terminates Termux itself; code recovery never implies data rollback.
