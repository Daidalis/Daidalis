# Install and run Manta

## Linux Docker deployment

For narrower per-task isolation, see the separate [rootless broker deployment](docker.md#opt-in-rootless-task-isolation). It requires an existing rootless daemon and supports API-mode and native Codex/Claude Agents, commands, three solvers, GIS/orbit and optional NOS3 tasks. Project-isolated browser/desktop and stdio MCP, HTTP MCP, the SciPy service and the fixed evaluator are also supported. STF and legacy VM management remain disabled in that mode.

For the tested Linux amd64 path, use an existing Docker Engine and Compose 2.20+:

```sh
sh install.sh
# Smaller alternatives:
# sh install.sh --preset=minimal
# sh install.sh --tools=ngspice,modelica
```

The installer builds the app and selected fixed services. Node, Python, Git and
native Agent runtimes live inside the image. Leave the new-project folder field
empty for a persistent managed project. Configure a compatible model connection;
credentials are not shipped. See [Docker deployment](docker.md) for full setup,
SSH forwarding, tool groups, storage, isolation limits and verification scope.
No prebuilt image is published. Other host platforms and native desktop packaging
are not validated by this Linux edition.

## Basic application from source

Install Node.js 22.13.0 or newer with npm using your preferred Node installer. The SysML worker uses the stable Node permission interface, so earlier Node 22 releases do not meet this minimum. No Codex desktop app, NAS folder, globally installed Python package, VM, or private development directory is needed to start the web application.

```sh
git clone https://github.com/MingxiYe/Manta.git
cd Manta
npm ci
npm run doctor
npm start
```

Open http://127.0.0.1:4317 . The application listens on loopback and enforces Host/Origin checks. It has no multi-user server authentication: do not expose it through a public proxy, tunnel, or LAN bind. The separate static product site does not contain the backend.

Copy `.env.example` to `.env` to customize the port or add server environment variables. Manta loads only this checkout-local file as data, without shell evaluation. Existing process environment variables take precedence. `.env` is ignored by Git. Settings in the UI can configure an endpoint, model ID and API key; UI keys remain in memory and must be supplied again after a restart.

The browser launcher, desktop launcher, and `npm start` use the same default `data/` directory under the checkout. `MBSE_DATA_DIR` selects another location. Existing users who previously ran direct `npm start` may have state in `.local/`; explicitly set `MBSE_DATA_DIR` to that old directory to continue using it. Manta does not move or merge existing state automatically.

`npm run smoke` starts a temporary, credential-free instance on an ephemeral loopback port, checks static/API routes and cross-origin guards, then removes its own temporary state. It does not call an external model or solver.

## Choose an Agent

- **Codex:** for a source installation, install the Codex CLI separately, make its native executable available on `PATH`, or set `MBSE_CODEX_PATH`. An explicit override is authoritative: an invalid path produces a configuration error. Supported macOS app bundles are fallback locations; there is no dependency on one developer's desktop installation. Test authentication or a custom Responses endpoint in Manta Settings.
- **Claude Code:** the Docker image includes the SDK; for a source installation, the pinned Claude Agent SDK is a project dependency installed by `npm ci`. Configure the API key, model and endpoint in Settings. Manta does not borrow an unrelated claude.ai login or another application's keys.
- Custom provider compatibility is determined by an actual connection/Agent test, not by accepting a configuration form. A successful catalog request is not proof that a model can execute tools.

## Platform scope

| Platform | Application | Additional limits |
| --- | --- | --- |
| macOS | Node browser application; native desktop shell with Apple command-line build tools | Managed VM requires Apple Silicon |
| Linux amd64 | Docker browser application, selected native tools and container virtual desktop verified locally | Shared-container execution is not per-project isolation; complete mission acceptance remains open |
| Other Linux architectures | Source application and tool compatibility require separate verification | The packaged NOS3 SDK is amd64-only |
| Windows | Browser-service entry point is designed for Node; Windows smoke is configured in CI but has not been verified by this local audit | POSIX shell helpers, macOS desktop and managed VM are not native Windows features. For Codex use a native `.exe` or run the complete stack in WSL; `.cmd`/`.bat` shims are not executed through a shell |

The original source audit used macOS ARM64. Subsequent Linux amd64 Docker validation is recorded in [Docker deployment](docker.md). Neither local review establishes that remote CI or Windows/macOS Docker workflows have passed.

## Optional capabilities

### SysML

The pinned semantic WASM package is included with upstream notices. No separately installed MBSE desktop product is required for source inspection and supported semantic checks. This is not a SysML dynamic behavior simulator.

### Browser and native desktop

The Docker `browser` group includes Chromium and CJK fonts; `desktop` provides a separate Linux virtual desktop. It does not control the host desktop. For a source installation, Playwright is optional. Install its browser into this checkout rather than a global browser cache when needed:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/playwright" npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/playwright" npm start
```

On macOS, Manta normally uses an existing Chrome channel. Set `MBSE_CHROME_PATH` to an explicit browser executable to select another installation. Native desktop operations require explicit session consent and OS screen-recording/accessibility permissions.

### Numerical and professional execution

`npm ci` installs the application, not OpenModelica, ngspice, OpenSCAD, NOS3, GDAL or a VM disk. Source installations require an explicitly configured runner. The Docker installer provisions the selected supported tool groups and connects their container backends. `npm run doctor` reports missing optional configuration without claiming that tools are ready.

The managed Apple Silicon VM source is in `vm/`. Set `MANTA_NOS3_VM_ROOT` only to a dedicated VM directory with its reviewed `host/`, `worker/` and required frozen input bundle. Historical setup documentation describes an already staged environment: **a fresh clone does not include the frozen `handoff/` archives, NASA binary packages, 42 assets, or generated source integrity manifests pinned by `vm/worker/native-inputs.json`.** There is currently no complete verified public installer that recreates that exact bundle. Do not use another user's VM state or disable hash checks to bypass it. That historical VM workflow is unavailable until its bundle is supplied and verified. The Docker NOS3/cFS/42 path instead rebuilds selected workflows from checksum-pinned public inputs; it does not restore missing historical STF reference assets. Public source-fetch helpers accept explicit paths; fetching upstream sources alone does not recreate the pinned bundle.

Remote NOS3 workers can be configured over authenticated HTTPS; see [the worker contract](nos3-runner.md). Solver/runner setup and licensing must be verified independently for each integration. Existing closed-loop evidence does not provision another machine.

The legacy SciPy thermal example is optional and separate from the isolated professional runners. To use it, choose a private local Python environment and `MBSE_PYTHON`/`MBSE_ENGINEERING_DEPS`; `scripts/install-engineering.sh` installs pinned wheels into an explicit project target. It does not install a global interpreter. Native extensions on a network volume are deliberately blocked. See its interpreter/version checks before running it.

### Optional reference cases

Evaluator candidate STF designs are not distributed or discovered by probing neighboring folders. A maintainer can explicitly configure `MANTA_STF_ASSETS_ROOT` for approved reference assets. Fresh projects start from the user's requirements. Optional integration tests use `STF_TEST_ASSETS`, `MANTA_NOS3_TEST_SOURCE`, and explicit boundary-fixture paths; missing external assets are reported as skipped, not as verified engineering.

For the maintainer-only frozen evaluation submission helper, `MANTA_STF_PROMPT_FILE` must explicitly name a reviewed requirements-only text file. It no longer reads a private planning directory outside the checkout. The normal Manta chat flow does not require this helper.
