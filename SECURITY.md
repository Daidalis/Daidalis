# Security

## Intended deployment

Manta is intended to run as a local engineering workspace. The application binds to loopback and validates Host and Origin headers, with cross-site requests blocked. Engineering execution and native Agent permissions have additional project and runtime boundaries.

Loopback and browser-origin checks do not provide user authentication for a network deployment. The application does not claim to be an authenticated multi-user hosted service. Exposing its API through a public listener, tunnel or reverse proxy requires a separately reviewed authentication and deployment design.

The static product website and recorded demo do not connect to the local application or run an Agent or solver. Access settings for a hosted website are separate from application security.

## Linux Docker boundaries

The default shared Docker edition runs services as UID 1000 with dropped capabilities, a
read-only root filesystem and no Docker socket mount. This is a non-root process
configuration, not a claim that the host Docker daemon is rootless.

Commands and solvers in the application container share its user, filesystem and
network. Clean child-process environments do not prevent same-user access to
application credentials or other projects. This edition is intended for trusted
local use and does not provide per-project OS isolation. The optional desktop and
flight services are fixed containers with no network; the flight service does
not mount application credentials or project directories. They share their own
runtime state across jobs rather than starting a fresh container for each task.

Native Codex/Claude approval rules remain enabled. Nested sandbox restrictions
can require explicit approvals even in Auto mode; a denied action does not grant
permission to bypass those rules. See [Docker deployment](docs/docker.md).

## Opt-in broker boundary

The rootless broker deployment isolates native Codex/Claude, `run_command`,
ngspice/OpenSCAD/OpenModelica, GIS, orbit and optional NOS3 jobs in disposable
offline containers. Only the broker has a rootless Docker
socket. It rejects a rootful daemon and client-selected images, arbitrary mounts,
network access, environment overrides and privilege flags. Image identity and
project volume are operator configuration, not task parameters. The application
is trusted to select the project; tasks receive only that project's volume subpath.
There is no automatic fallback to shared execution.

The broker is trusted and has authority over its rootless daemon. Compromising it
could expose resources accessible to the daemon's host user; rootless does not
make a Docker socket harmless. Keep this daemon dedicated to Manta. A project can
modify/delete its own files, including partial writes on failure. Project storage
has no disk quota. Memory/PID/deadline limits are enforced; CPU quota requires
explicit controller support and can be explicitly disabled with status reporting.
Tasks share the host kernel, not a VM boundary.

Native Agents receive a short-lived model proxy token, not the upstream API key.
The application forwards only the configured model and runtime endpoints; tasks
have no general network access. Per-project volumes retain native session state.
Codex Auto uses the outer task container as its sandbox; Manual retains native
approval rules. NOS3 tasks use a disposable writable container layer for their
native build/runtime files, with no application or project volume mounted.

Browser/desktop and stdio MCP processes run in separate project session containers.
Browser HTTP is mediated by the application allowlist. Stdio MCP may receive only
explicitly configured connector credentials; it cannot inherit model credentials
or access arbitrary network destinations. Stdio tasks remain networkless, with an
opt-in per-connector HTTPS CONNECT relay to exact public DNS names on port 443.
The trusted application pins checked DNS addresses, rejects private/reserved
answers, and bounds active connections, buffered frames, traffic and lifetime.
The relay does not terminate TLS or add model credentials. Proxy-aware clients
may communicate with their own container's loopback services; that namespace
cannot access host loopback. Cancellation/configuration changes close the relay.
HTTP MCP keeps the existing explicit
endpoint, same-origin and no-redirect checks in the application. The fixed SciPy
solver runs in a disposable container with validated output hashes. The evaluator
uses bounded data reads and fixed checks; it never executes candidate programs.
STF and legacy VM management remain disabled in broker mode.
This does not establish complete parity with the original macOS sandbox or all
Manta features. See [setup and tested scope](docs/docker.md#opt-in-rootless-task-isolation).

## Credentials and local state

Configure model and tool credentials through the documented application or service environment. Keys entered in the model settings UI remain in service-process memory and must be re-entered after restart; configured environment variables are resolved by the local service. Do not place credentials in frontend assets, project prompts, command arguments, committed environment files or example data.

Public event, approval and task/chat records apply the provider’s known-key redaction policy before storage and delivery to the UI (configured key values of at least six characters). This is not a general secret scanner: unknown or previously removed credentials, encoded secrets and credentials deliberately written into project files still require review. Original engineering files and evidence downloads retain their bytes rather than being silently rewritten.

An Agent can read project files within its granted permissions and send their contents to the chosen model endpoint. The document viewer’s credential-filename filter is not a universal Agent access policy: project read tools and native runtimes need separate credential-access review. Keep unrelated credentials outside Agent-readable projects.

Runtime state, conversations, VM/runner credentials and engineering project files belong outside the public source distribution. Review files and Git history before publishing or sharing a repository. If a real credential is exposed, revoke or rotate it with its issuer; deleting a file or rewriting a commit does not revoke the credential.

## Report a vulnerability privately

Use the repository's **Security → Report a vulnerability** flow through [GitHub private vulnerability reporting](https://github.com/MingxiYe/Manta/security/advisories/new). Include the affected version, expected boundary, reproduction steps and impact, with credentials and private engineering data removed.

If private reporting is unavailable, request a private reporting channel without publishing exploit details or sensitive data in a public issue. Please do not include real keys, private models, runtime chats or unredacted logs in a public report.

Security fixes and supported scope will be documented in the repository. A successful test of one adapter or configured runner does not establish the security of every external tool or deployment.
