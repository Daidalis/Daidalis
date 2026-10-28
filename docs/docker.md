# Docker deployment — first edition

The default shared-container deployment uses your existing Docker Engine or Docker Desktop (Linux containers), with
Docker Compose 2.20+. No host Python/Node toolchain, dedicated Linux account,
rootless setup or Docker socket mount is required.

## Install

From this checkout on Linux amd64 (the currently tested platform):

```sh
sh install.sh                    # all first-edition tools, with virtual desktop
sh install.sh --preset=minimal   # app, SysML and container-local commands
sh install.sh --tools=scipy,ngspice
```

Windows, macOS and ARM64 host validation are deferred; this edition provides a Linux shell installer.

The installer builds the application image and selected tool images. The virtual
desktop uses the application image. The `nos3` group adds a fixed flight container
for NOS3/cFS/STF; it has no network, application credentials or project mounts.
The containers communicate through a private Unix socket, without a Docker socket
or broker.
`--no-start` builds without starting. There is no published prebuilt
image yet. Build downloads and cache consume Docker storage; choosing a smaller
preset does not automatically delete previously built images.

Open **http://127.0.0.1:4317**, select **设置 → 模型与 API → 添加模型 API**,
and configure an API, native Codex or native Claude Code Agent. Leave the
new-project folder field empty to use a managed persistent project directory.
The host does not need the engineering toolchains installed. Codex CLI 0.164.0 and
Claude Agent SDK 0.3.307 are included in every preset.

To use an existing API environment file:

```sh
MANTA_ENV_FILE=/absolute/path/to/.env sh install.sh
```

The installer otherwise uses the checkout's `.env`, falling back to `.env.example`.
Credentials are loaded at runtime into the application only, not the image or
desktop or flight container. Configure the provider endpoint, model and `keyEnv` (for
example `OPENAI_API_KEY`) in Manta; API compatibility must be tested for each
runtime. Codex uses Responses; Claude requires Anthropic Messages compatibility.
For custom Claude gateways, deferred tool search is disabled as described in the
[Claude gateway documentation](https://code.claude.com/docs/en/mcp#tool-search-through-an-llm-gateway),
so native tools remain discoverable. Permission approval remains enabled.

If the default ports are occupied, set them on the first installation:

```sh
MANTA_PORT=4319 MANTA_DESKTOP_PORT=6082 sh install.sh
```

The selections, ports and desktop profile are saved in `deploy/local/install.env`.
For a server, use SSH forwarding from your own computer, for example:

```sh
ssh -N -L 4319:127.0.0.1:4319 -L 6082:127.0.0.1:6082 USER@SERVER
```

Then visit localhost in your own browser. Keep the API on loopback; it is not a
multi-user authenticated service. Ports 8080 and 8081 are reserved internally.

## Opt-in rootless task isolation

Broker mode is a separate, narrower deployment. It starts a fresh container for
`run_command` and each ngspice/OpenSCAD/OpenModelica job. Commands mount only one
managed project at `/work`; professional jobs receive source snapshots and return
bounded artifacts. Tasks have no network, Docker socket, application state or
application credentials. Git state, executable permissions and project-local
relative symlinks survive command execution. The command working directory is
`/work`; absolute paths referring to the application filesystem are not remapped. Partial project writes persist on failure.

This mode requires an **existing rootless Docker daemon (Engine 26+)**, Compose **2.24.4+**,
and cgroup v2 with memory/PID delegation. The installer does not install a daemon,
change system services, alter socket permissions or change your Docker context.
An ordinary non-root container on a rootful daemon does not meet this requirement.
See the [Docker rootless prerequisites](https://docs.docker.com/engine/security/rootless/).

```sh
# Select your existing rootless daemon explicitly; adjust this path if needed.
export DOCKER_HOST="unix://${XDG_RUNTIME_DIR}/docker.sock"
sh deploy/docker/install-broker.sh
# Optional: MANTA_ENV_FILE=/absolute/path/to/.env
# Optional tool selection: MANTA_TOOLS=ngspice MANTA_MODELICA=0 MANTA_ORBIT42=0
# Optional isolated NOS3 component/build/integration: MANTA_BROKER_FLIGHT=1
# --no-start builds and saves configuration without starting the application.
```

Open `http://127.0.0.1:4320` and configure an **API, Codex or Claude Agent**. Default project
name is `manta-isolated`; existing shared-deployment volumes are not migrated.
The app, broker and task processes all run as UID 1000. Only the broker receives
the rootless daemon socket; the installer detects its namespace GID and grants
that supplementary group to the broker without making the socket world-writable.
The broker resolves the locally built task image to its immutable image ID on
startup. After rebuilding the app image, recreate the broker to select that image.

Command, solver and native Agent tasks have 2 GiB memory, 256 PIDs, an execution
deadline, bounded output and a read-only root filesystem. NOS3 tasks have 8 GiB
and 512 PIDs, with a disposable writable layer for native build/runtime files.
Up to four engineering/command tasks and eight native Agent tasks run concurrently. Default CPU
quota is two cores per task. If the user has no delegated CPU controller, startup
fails with an explanation. **Explicitly set `MANTA_TASK_CPUS=0` to opt out of CPU
quota** while retaining the other limits; status then reports `cpuQuota: null`.
This does not enforce an aggregate CPU limit or a project-volume disk quota.

Broker mode supports API-mode editing, SysML, native Codex/Claude, isolated
commands, the three solvers, GIS, orbit and orbit-to-ground workflows. Set
`MANTA_BROKER_FLIGHT=1` before installation to build the optional NOS3 task image.
The built-in SciPy thermal model, explicit-scope evaluator, project MCP connectors,
Chromium and virtual desktop are also available. STF and the legacy VM management
entry point remain disabled.

Native Agents run inside task containers and retain session state in a separate
per-project volume. They receive only a short-lived proxy token; the upstream
API key stays in application memory. The model gateway accepts the configured
model and runtime endpoints only. These tasks remain offline except for that
model proxy. Codex Auto uses the outer rootless container as its sandbox; Manual
retains native approvals and may request approval when nested sandboxing is
unavailable. A compatible API-key endpoint is required; host CLI login is not
imported. Delete project session volumes only when their conversation state is
no longer needed (`manta.native-state` labels identify the owning deployment).

Browser/desktop and stdio MCP each use a project-specific session container, with
only that project's files mounted. Eight service sessions can run concurrently,
separately from the eight native Agent turns. The broker control service has a
512 PID limit and bounds Docker CLI parallelism; task PID limits remain unchanged.
Sessions have a one-hour lifetime
and bounded total output; cancellation or disconnection removes their containers.
Save GUI work before closing/restarting the deployment. Browser profiles and
unsaved GUI state are temporary; saved project files persist.

Chromium HTTP requests pass through the application's existing host and project
allowlist, with bounded responses. This relay currently supports GET/POST and
does not forward browser cookies or authentication headers; sites requiring
login, other HTTP methods or arbitrary WebSockets are outside this adapter.
Application settings/approval APIs, file URLs,
and arbitrary direct network access remain inaccessible. Manual actions and
remote-page actions retain approvals. Desktop enablement still requires explicit
user consent. In the Computer panel, select the project and enable its virtual
desktop; its noVNC password is displayed there. Open
`http://127.0.0.1:6084/vnc.html` (the broker installer's default desktop port).
Switching projects closes the old noVNC connection; reconnect to the selected
project. Neither desktop nor browser can control the host's desktop.

MCP configuration remains user initiated. Stdio executables must already exist in
the task image; use `/work` or relative paths for project files. Stdio servers are
offline and receive only explicitly configured `MANTA_MCP_*` credential mappings,
not the application's model keys. Servers needing external network access should
use an explicitly configured HTTP MCP endpoint. HTTP MCP uses the existing
same-origin, no-redirect transport in the trusted application process; it does
not execute server code there. Tool effects and approval policies are unchanged.

The SciPy adapter accepts declarative parameters and scans, runs the fixed solver
in a fresh offline container, and checks returned artifact hashes before recording
results. The evaluator performs bounded reads and fixed checks in the application;
it never executes candidate code. Its completeness/contract scores do not claim
independent mission or hardware acceptance.

With the same `DOCKER_HOST` selected, maintain the isolated deployment separately:

```sh
docker compose --env-file deploy/local/broker.env ps
docker compose --env-file deploy/local/broker.env logs --tail 100
docker compose --env-file deploy/local/broker.env exec -T manta node deploy/docker/broker-acceptance.mjs
docker compose --env-file deploy/local/broker.env exec -T manta node deploy/docker/acceptance.mjs
docker compose --env-file deploy/local/broker.env exec -T manta node deploy/docker/broker-services-acceptance.mjs
docker compose --env-file deploy/local/broker.env exec -T manta node deploy/docker/desktop-acceptance.mjs
docker compose --env-file deploy/local/broker.env up -d --force-recreate --wait
docker compose --env-file deploy/local/broker.env down
```

The acceptance script creates and removes its own temporary projects. The general
application acceptance script retains a `Docker acceptance` project with recorded
solver results. Neither requires model credentials. Tested locally on Linux amd64:
project/credential/network boundaries, actual memory and PID limits, Git/large-file
preservation, timeout/cancellation/detached-child cleanup, broker SIGKILL/restart
cleanup, and all three solvers through the application job queue. The broker also
rejected the existing rootful daemon before creating any task.
The test server lacks CPU delegation, so CPU quota was explicitly disabled; CPU
quota enforcement is not claimed as tested. Native Codex/Claude repository repair
and GIS/orbit-to-ground workflows have also passed in rootless task containers.
Run `node deploy/docker/broker-native-acceptance.mjs` inside the app for a local
model fixture using the real native binaries (no paid model requests), including
session resumption and cancellation. Set `MANTA_NATIVE_PARALLEL=1` for five
concurrent sessions. The deployment accepts at most eight native turns at once;
additional turns fail explicitly instead of escaping the isolation boundary. For NOS3,
run `MANTA_ACCEPT_NOS3=1 MANTA_ACCEPT_STF=0 node deploy/docker/flight-acceptance.mjs`
inside the app after enabling the flight image. The optional CI live-model job
requires explicit workflow dispatch and configured model secrets.

Broker failures never fall back to shared execution. Disconnecting a task request
cancels its container. Normal completion removes the container; after an abnormal
broker exit, the next broker startup removes containers bearing this deployment's
label. The broker is a trusted management service with the authority of its
rootless daemon; this is not a multi-user authorization boundary. Credentials
placed inside the selected project remain readable by that project's task.

## Maintain and remove

```sh
sh deploy/docker/compose.sh ps
sh deploy/docker/compose.sh logs --tail 100
sh deploy/docker/compose.sh stop
sh deploy/docker/compose.sh up -d --wait
sh deploy/docker/compose.sh down
```

The wrapper only loads the saved Compose selections. Plain `docker compose up
--build -d` also works with the default image/tool selections; add `--profile
desktop` if you want the optional desktop.

Named volumes retain projects, app settings and desktop data across container
replacement. `down` retains these volumes. **`down -v` deletes the deployment's
project data and settings.** Back up volumes while stopped before upgrades.
The installer does not migrate data from older deployments or remove unrelated
images, containers or volumes.

## Tool selections

`full` means all tools supported in the first-edition default bundle:

| Group | Contents |
| --- | --- |
| Always | Node, Git, Python, Codex CLI, Claude Agent SDK, SysML kernel |
| `scipy` | NumPy, SciPy, Matplotlib |
| `ngspice` | Circuit solver |
| `openscad` | Geometry generation and offscreen dependencies |
| `browser` | Chromium for Playwright |
| `desktop` | Linux virtual desktop, terminal, VNC/noVNC and GUI controls |
| `gis` | GDAL/PROJ Shapefile control-point checks |
| `orbit42` | Headless NASA 42 and verified reference assets |
| `modelica` | OpenModelica 1.27.1 and preloaded standard libraries |
| `nos3` | Dedicated native NOS3/cFS/42 and STF LC/SC/EPS flight container |

These nine optional groups are selected by default. `minimal` omits all nine;
custom selection installs only requested groups, reducing actual image contents.
Numerical tools share the application image. `nos3` builds the separate flight
image; its compilers and runtime sources are not installed on the host.

`gis` and `orbit42` are independently selectable. Selecting both also enables
the bounded orbit-to-ground cross-check using verified native orbit snapshots.

Example custom build: `sh install.sh --tools=scipy,modelica --no-start`.
OpenModelica downloads use parallel transfers and signed-repository SHA-256
verification, with a reusable build cache. Standard libraries are preloaded so
simulation jobs can run without internet access.
Modelica uses the [official signed repository](https://openmodelica.org/download/download-linux/).
The base image is digest-pinned, npm uses the lockfile, and installed Debian
package versions are recorded in `/opt/runner/packages.txt`. Future builds from
moving Debian repositories are not bit-for-bit reproducible.

## Execution boundary

Manta and tools run as UID 1000 with a read-only root filesystem, dropped
capabilities, no-new-privileges, and container CPU/memory/PID limits. No Docker
socket, privileged container or host directory is mounted by the supplied Compose.
Broker/rootless experiments and host initialization scripts are excluded from this edition.
A non-root container process does not imply that the host Docker daemon is rootless.

**Commands and solvers share Manta's container, UID and network. They can access
application data and credentials available to that user.** This edition is for
trusted personal projects; temporary work directories are not a security sandbox.
The UI and execution receipts identify this mode as `shared-container`, not
per-task isolation. Model API access needs the application's network connection.

Commands execute directly in the project directory, preserving Git metadata,
file permissions, symlinks and dependency trees. They do not copy the entire
repository or impose the former 12 MiB command snapshot limit. Failed or cancelled
commands can leave partial changes, just as local shell commands do. Commands are
serialized within each project; native Agent tools and GUI edits still require
coordination when touching the same files. Professional solvers retain bounded
source snapshots and hashed execution evidence.

OpenModelica compilation uses one compiler worker; numerical library thread counts
are limited to avoid oversubscribing the container's process budget. The Docker
Agent budget defaults to 32 model turns, configurable with `MANTA_MAX_TOOL_TURNS`
(2–200) in the runtime environment file. Budget exhaustion preserves the session,
reports the most recent tool failure, and allows a later user message to continue.

Cancellation and timeouts terminate normal worker process groups. There is no
claim of containment against deliberately escaping or hostile programs. Numerical
results retain source hashes, native outputs and receipts; successful execution
alone does not establish engineering correctness.

## Optional virtual desktop

Open **http://127.0.0.1:6080/vnc.html** (or your configured desktop port).
Retrieve the generated password:

```sh
sh deploy/docker/compose.sh exec desktop cat /desktop-data/vnc-password.txt
```

In Manta's Computer panel, explicitly enable the engineering virtual desktop.
Launch an installed application, take a screenshot, then click/type/send keys.
Agent actions still require approvals. The desktop is an independent Linux
container with `network_mode: none`; its noVNC connection uses a Unix-socket relay.
It does not control your host desktop.

Enabling a project selects its own virtual display and application home. Up to
three sessions remain open concurrently, with up to four launched applications
per project; reopening the same application/file focuses its existing window.
Mesa software rendering uses two worker threads. Switching does not close unsaved windows.
Save work before restarting the desktop service to release sessions. noVNC follows
the selected project; reload/reconnect its browser tab after switching.
The desktop shares the managed `/projects` volume so GUI applications can open and
save actual project files. `desktop.open_app` accepts a project-relative `.scad`
path for OpenSCAD; terminals start in that project. This is a trusted personal
workspace: separate displays are not filesystem security isolation between projects.
The desktop still has no application credentials or external network.

## Acceptance and remaining scope

Linux amd64 is the tested host. Windows/macOS Docker Desktop and ARM64 require
separate platform tests; a PowerShell installer is not included in this edition.
Licensed tools, hardware integration and unprovided private reference assets
remain outside this deployment. Real model-provider inference requires user keys. The configured gateway was
also tested with API, native Codex and native Claude file-operation workflows.

Live checks can be repeated inside the running application container:

```sh
sh deploy/docker/compose.sh exec -e MANTA_ACCEPT_BROWSER=1 -e MANTA_ACCEPT_DESKTOP=1 manta node deploy/docker/acceptance.mjs
```

Omit the browser/desktop environment flags when those groups were not installed.
The script creates a persistent test project and native model artifacts.

On 2026-10-27 the first-edition Linux amd64 checks passed for managed projects,
SysML, real commands, concurrent output separation, timeout/cancellation,
ngspice and OpenSCAD execution through the app job API with persisted artifacts,
Chromium screenshots and desktop launch/input/keys. OpenModelica additionally
passed an offline numerical decay test against the analytic value exp(-1).

Multi-project GUI acceptance (creates two visible test projects):

```sh
sh deploy/docker/compose.sh exec manta node deploy/docker/desktop-acceptance.mjs
```

Full mission coverage and arbitrary device configurations are not claimed.
Commercial desktop applications and a packaged native desktop shell remain
outside this deployment. Native repository repair has also been tested with independent test execution;
this does not establish every multi-agent development workflow.

A real Agent-to-solver acceptance is available separately (uses model tokens):

```sh
sh deploy/docker/compose.sh exec -T manta node deploy/docker/live-engineering-acceptance.mjs
```

It requires the runtime API environment and checks model creation, simulation,
explicit numeric criteria and persisted source through the actual Agent loop.


### GIS and NASA 42 in Docker

The Linux amd64 container acceptance checks run real GDAL point classification
(inside, boundary and outside) and a 60-second NASA 42 orbit, then verify persisted
results through the application API. Neither requires a model-provider key:

```sh
sh deploy/docker/compose.sh exec -T manta node deploy/docker/gis-orbit-acceptance.mjs
```

42 is compiled headlessly from public `nasa-itc/42` tag `dev_20260403`.
The archive SHA-256 is pinned in `deploy/docker/build-orbit42.py`; all 21 input
templates and 220 model/world assets retain the reference worker's exact hashes.
`/opt/orbit42/build.json` records the native binary hash, architecture and compiler.
Container receipts use this build hash instead of claiming the legacy ARM64 binary
hash. Both workers run as UID 1000 in the application container with bounded
execution and cancellation. They do not provide per-job filesystem isolation.

Direct minimal builds must set both `WITH_MODELICA=0` and `WITH_ORBIT42=0`, as well
as an empty `TOOLCHAINS`; the installers set these flags automatically.

### Native flight workflows

`sh install.sh --tools=nos3` builds the SDK, native source and flight service
Dockerfiles in `deploy/docker/`. `full` includes this group. The additional source
archives are pinned by SHA-256 in `nos3-sources.json`; the Linux amd64 SDK is
checksum-pinned separately. No host compiler, privileged container or daemon
socket is needed. Each flight image gets a separate runtime volume so an upgrade
cannot silently reuse incompatible compiled files. Old runtime volumes remain
available for evidence review and are not automatically deleted.

The flight container serializes native work. It shares runtime files across jobs,
so it is not per-job security isolation. Its outer Docker boundary excludes the
application's provider keys and project files. Only explicitly submitted C tables,
source baseline metadata and execution evidence cross the Unix socket.

For a project containing the pinned NOS3 Git checkout, the existing NOS3 build
and integration APIs use the flight service. Component checks additionally need
`components/generic_adcs` checked out at its pinned revision. The selected
star-tracker integration exercises actual NOS Engine UART, cFS SB/ADCS and 42,
with baseline-defect, corrected, negative-quaternion, invalid-observation and
sensor-bias cases. These are selected software checks, not all-device or flight
qualification. New NOS3 result reads recheck persisted evidence hashes; older
results without a pinned evidence manifest are reported as unverified.

STF `.stf.json` models with explicit C table dependencies use the professional
job API. The original low-power scenario is an intentional negative control:
actual execution succeeds while critical shutdown and rearming checks fail.
A failed engineering criterion remains failed in the UI. Reproducing a historical
modified template requires its actual source tables; the recorded website
manifest alone does not contain those sources.

Repeat app-level flight acceptance (downloads the public NOS3 checkout into a
new managed project; the two scenarios take several minutes):

```sh
sh deploy/docker/compose.sh exec -T -e MANTA_ACCEPT_NOS3=1 manta node deploy/docker/flight-acceptance.mjs
```

Repeat native Codex/Claude repository repair (uses configured provider tokens):

```sh
sh deploy/docker/compose.sh exec -T manta node deploy/docker/live-repository-acceptance.mjs
```

This reads `OPENAI_BASE_URL`, `OPENAI_API_KEY` and `OPENAI_MODEL` at runtime.
The default tests both native runtimes and requires an endpoint compatible with
both Responses and Anthropic Messages. Set `MANTA_TEST_TYPES=codex-app-server`
or `MANTA_TEST_TYPES=claude-agent` for a single compatible connection.
It starts with failing tests, requires source-only edits, and independently
reruns the unchanged test suite after the Agent finishes.

### Orbit-to-ground acceptance

Run `gis-orbit-acceptance.mjs` first, then supply a real complete NAD83 state
Shapefile ZIP as `MANTA_STATE_ZIP` inside the application container:

```sh
sh deploy/docker/compose.sh exec -T -e MANTA_STATE_ZIP=/tmp/states.zip manta node deploy/docker/orbit-ground-acceptance.mjs
```

The accepted public mirror was
[Missouri Spatial Data Information Service's TIGER 2024 archive](https://msdis-archive.missouri.edu/archive/missouri_vector_data/TIGER_Data/TIGER2024/tl_2024_us_state.zip),
SHA-256 `e30bad8922b177b5991bf8606d3d95de8f5f0b4bab25848648de53b25f72c17f`.
It differs from the historical receipt's Census ZIP, so the worker retains the
supplied-source designation rather than claiming an exact historical match.
Positive DC/Alaska/Hawaii controls and the negative ocean control passed.
The output is a bounded sub-satellite-point classification, not sensor footprint,
revisit or mission coverage verification.

### Current Linux acceptance scope

| Workflow | Evidence |
| --- | --- |
| SysML, shell jobs, Modelica, ngspice, OpenSCAD, browser and virtual desktop | Application acceptance scripts |
| GIS and NASA 42 | Native calculations and persisted receipts |
| Orbit → state boundary classification | Real state ZIP, native trajectory snapshots and independent coordinate/control checks |
| NOS3 quaternion component | 324 cases, rotation/sign/inverse checks |
| NOS3 build and star-tracker integration | Native build, five live scenarios and runtime restoration |
| STF original low-power case | Live EPS/MGR telemetry; two original protection failures retained |
| Native Codex and Claude repository work | Source repair, unchanged tests, independent rerun and Git diff |
| Historical modified STF reference project | Missing source assets; recorded manifest/CSV do not reproduce it |
| Every multi-agent development workflow | Regression coverage only; no comprehensive live acceptance claim |

Native desktop packaging and other host/CPU platform acceptance are deferred.
The Docker CI configuration includes an optional-flight job; local acceptance is
not a claim that the remote CI run has already completed.

### Interactive trial and remaining usability limits

A real browser trial on Linux amd64 covered project creation, model editing,
ngspice execution, CSV download, invalid-model diagnostics and reopening saved
results. A Claude task reviewed existing simulation evidence and wrote a report;
its source hash and numerical results were independently checked. Container CJK
fonts and long-result previews were corrected during this trial.

A separate natural-language modelling task timed out before its first API model
reply. A native Codex retry required command approvals when its nested sandbox
could not create namespaces, then failed with upstream HTTP 429. Thus the trial
does not establish reliable unattended modelling with every provider. Permission
policies remain enabled; Auto is not a promise that no approval will be requested.
