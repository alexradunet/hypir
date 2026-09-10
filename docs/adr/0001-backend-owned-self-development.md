---
status: accepted
---

# Backend-owned self-development through shared hypermedia clients

Hypir will use one backend implementation to develop and serve both its own development workspace and Hypir-hosted mini-apps, with Android and Linux clients consuming the same HXML and hypermedia capability vocabulary. Ordinary self-development changes actual backend and application source in the repository rather than introducing personal interface overrides or requiring native client rebuilds. This keeps application behavior and development logic shared while accepting that new host capabilities still require separately built and updated platform clients.

## Consequences

- One backend implementation does not mean one mandatory central server or one required process. Installations can run independently on a phone or Linux, and multiple clients may connect to the same instance; automatic synchronization between independent instances is not implied.
- Termux is an explicit supported dependency for the phone backend. A desktop or user-operated remote development machine is not required for the core development loop. Cloud model inference is allowed; phone independence does not mean offline generation.
- Pi is the development engine, not a mandatory execution engine for ordinary application behavior. Applications may explicitly offer AI features without making every interaction depend on inference.
- The development workspace and mini-apps use the same app model. Their interfaces and actions must fit the shared client capabilities; identical HXML does not guarantee identical platform rendering or introduce unsupported native capabilities.
- Mini-apps are hosted by Hypir rather than implicitly exported as independent APKs or desktop executables. Sharing source and the app definition does not automatically share installation data.
- This is a trusted-code development environment. Imported backend code requires explicit trust before execution. Capability declarations describe requirements; they are not a claim of sandbox isolation for arbitrary third-party code.
- Development is user-directed, with autonomous editing and verification in an isolated candidate. Approved changes are integrated into the actual source checkout while preserving unrelated uncommitted work. Integration, activation, committing, and pushing are separate operations; activation approval does not authorize a commit or push.
- App-owned SQLite databases live outside source control, with separate durable state for Hypir itself. Candidates use disposable databases or explicitly approved snapshots, not live database writes. Activation includes explicit migrations; code rollback must not silently rewind data, and incompatible data recovery requires a separate decision.
- Candidate acceptance requires relevant checks, a runnable preview, and an exercised acceptance scenario. Approval presents the source diff, migration implications, verification results, and unverified behavior. Candidate execution requires explicit authorization for external writes, sends, or other consequential actions; a disposable database alone does not isolate those effects.
- Only one development writer may be active per repository; other clients can observe. Activation is serialized for the shared backend. Approval belongs to an exact candidate revision and is invalidated by subsequent edits.
- Approved backend updates may cause a controlled restart. Development-session state must survive, clients must reconnect, and recovery must remain available outside the replaceable backend process. Arbitrary in-process hot replacement is not required.
- A stopped backend means ordinary application operations are unavailable. Clients show an explicit disconnected state, preserve recoverable input where practical, and neither report unperformed actions as successful nor silently queue writes. Reconnection reloads authoritative state.
- The recovery base has a separate update path, is excluded from ordinary development edits and activation, and cannot approve its own replacement through the active development session. Retain a known-good backend version and a recovery path that requires neither the broken backend nor Pi/model access.
- Recovery protects against failed trusted development, not deliberately hostile same-user code. Separate processes or directories alone do not establish tamper-proof isolation; this operational protection does not change the separate prohibition against silently rewinding app data during code rollback.

## Scope

This records the agreed product direction, not a claim that every capability has shipped. At decision time, the clients, static preview daemon, and protocol did not implement the shared backend app model or Pi development loop; implementation progress is tracked by the specification and its tickets. This decision supersedes the initial interview assumption that ordinary self-development must include building and installing a new Android client on the phone.
