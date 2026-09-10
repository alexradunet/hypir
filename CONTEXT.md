# Hypir

Product language for Hypir's intended self-development model. These definitions describe the product direction, not a claim that every capability is implemented.

## Language

**Hypir**:
A development environment that can develop applications and itself, using a shared development engine and app model.

**Self-development**:
Development of Hypir through changes to its actual source repository, centered on its own development workspace and application capabilities.
_Avoid_: Self-customization

**Mini-app**:
An application hosted by Hypir, with its own interface, application logic, optional persistent data, and declared capabilities; its backend code is explicitly trusted before execution.
_Avoid_: Screen collection

**Shared app model**:
The common hypermedia vocabulary through which Hypir's development workspace and mini-apps express their screens and actions across supported devices.

**Platform client**:
The stable device-facing host that presents Hypir's development workspace and mini-apps using the shared app model.

**Development engine**:
The agent-driven part of Hypir that creates and changes applications and Hypir itself; ordinary application behavior does not require it.
_Avoid_: App execution engine

**Development workspace**:
The app through which a user directs development in Hypir, built from the same app model available to the applications it develops.

**Recovery base**:
The part of Hypir reserved for user-controlled approval and recovery from failed trusted development, excluded from ordinary self-development changes rather than secured against arbitrary same-user code.

**Development candidate**:
An isolated revision of an application or Hypir prepared for verification and user approval before integration into its source checkout.
_Avoid_: Live edit

**Candidate approval**:
The user's authorization of an exact verified candidate revision for integration and activation; changing the revision invalidates its approval.

**Activation**:
The transition in which an approved revision becomes the running version of an application or Hypir.
_Avoid_: Commit, push

**App data**:
The durable information owned by a mini-app or Hypir's development workspace, distinct from its source and disposable candidate data.

**Phone-independent development**:
Development performed on a phone without requiring a desktop or a user-operated remote development server; this does not imply offline model inference.
_Avoid_: Offline development
