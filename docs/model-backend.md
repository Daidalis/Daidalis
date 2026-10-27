# Real SysML v2 backend

Manta now uses the **Open-MBEE sysml-toolkit WebAssembly kernel**, release
`@sysml/wasm 0.10.10`, commit `339ef0e`, for textual SysML v2 models.
It is a separate model service. The existing Manta JSON nodes/links graph is
still a workspace visualization and is not presented as a SysML compiler.

Primary sources:

- https://github.com/Open-MBEE/sysml-toolkit/releases/tag/v0.10.10
- https://github.com/Open-MBEE/sysml-toolkit/blob/v0.10.10/crates/sysmlv2-wasm/README.md
- https://github.com/Open-MBEE/sysml-toolkit/blob/v0.10.10/README.md

## Dependency and isolation

The downloaded release is contained entirely in `toolchains/sysml/`. No npm
install, package lifecycle scripts, Java installation, user shell configuration,
Codex configuration, Claude configuration, browser extension, or system service
is needed. The kernel has no WASI imports. It does not receive a filesystem,
network, shell, or host application API.

`toolchains/sysml/manifest.json` pins the version, build commit, archive digest,
and hashes of the JavaScript glue, WASM binary, library sources, sealed library
resolution recording and prepared-library snapshot. Manta checks a pinned hash
of the manifest itself and every listed file before reporting the backend ready.
The archive SHA-256 matches the public GitHub release asset API's `digest`:

```
93d6ef0a2140fceabc3115cd95d629146bc004c3959bfa23d715cce8b06cc13c
```

The release `SHA256SUMS` file omits its WASM asset; it is not incorrectly claimed
as the source of the WASM archive checksum. The artifact API reports asset ID
`646958267`. The archive was downloaded over HTTPS from the tagged official
repository, not from a look-alike npm package. That release's npm registry is
GitHub Packages; the public npm registry name currently returns 404.

Each operation loads the pinned kernel in a bounded subprocess with Node's
permission system: read access only to the worker and the isolated runtime;
filesystem writes, child processes, native add-ons and worker creation are not
granted. On macOS the wrapper also uses `sandbox-exec` to deny network and
writes at OS level. Node's permission system alone does **not** claim network
isolation on other platforms. The WebAssembly engine itself has no network
imports on any platform. Project source text is supplied on stdin, and results
come back on stdout. A trapped instance is discarded with its process.

Resource limits: 500 KB model source, 4,000-character query, 20-second subprocess
timeout, bounded output, 512 MB JavaScript old-space limit. The latter is not a
claim of a hard total process/WASM memory limit.

Licenses and notices ship with the runtime: `package/LICENSE` (Apache 2.0),
`package/LICENSE-EPL-2.0` and `package/THIRD-PARTY-NOTICES.md` (bundled OMG
standard library). Do not omit these when distributing the runtime.

## API

```js
const models = await createModelBackendService({root, dataDir, store, emit});
await models.catalog({projectId});
await models.importModel({
  projectId,
  path: 'models/interface.sysml',
  content: 'package Demo { part def System; part system : System; }',
  // Required when replacing an existing file:
  expectedHash: previousSha256,
  sources: [{path: 'components/example.c', sha256: expectedSourceHash,
             lineStart: 10, lineEnd: 40}]
}, ctx);
await models.validate({projectId, path: 'models/interface.sysml'}, ctx);
await models.query({projectId, path: 'models/interface.sysml',
                    query: 'Demo::System'}, ctx);
await models.exportModel({projectId, path: 'models/interface.sysml',
                          format: 'compact-json'}, ctx);
await models.verify({projectId, path: 'models/interface.sysml'}, ctx);
```

`ctx` accepts the existing native Agent `signal`, `runId`, and `threadId`.
There is no second Agent loop in this backend. Both native runtimes and external
MCP wrappers call the same service.

- `catalog`: metadata and file-integrity checks; no product is launched.
- `importModel`: actual parse, bundled-library name resolution and supported
  semantic checks before an atomic project-relative write. Failed acceptance
  preserves the previous model. Optimistic hashes and a per-path mutation queue
  reject stale/concurrent replacements.
- `query`: a KerML expression evaluated by the real kernel, or the kernel's
  structured model/diagram graph when no expression is supplied. It is not
  JavaScript or shell evaluation.
- `validate`: returns findings with source spans, supported validation scope,
  exact input hash, runtime provenance and saved evidence.
- `exportModel`: `sysml`, `compact-json`, `full-json`, or `plantuml`. PlantUML is
  emitted text only: no Java/PlantUML installation or rendering is performed.
- `verify`: static constraint evaluation and interval propagation in the kernel.
  Verdicts include satisfied, violated and undecided. It does not execute SysML
  behavior, simulate a spacecraft, invoke Z3, or imply hardware compliance.

Successful imports, checks and verification reports are saved under the selected
project's `.manta/model-evidence/` and appear as normal project artifacts. Source
references include project-relative paths and SHA-256 hashes. The service does
not write default runtime data into the application `.local` directory.

Currently each operation receives one textual `.sysml` compilation unit. Put
related packages into that file; arbitrary project-wide multi-file discovery,
server-based collaborative transactions, graphical editing and SysON/Capella
interchange are not claimed.

## Validation boundaries

The standard library is actually loaded, including its pinned prepared snapshot.
The tests demonstrate normative ID resolution of `ScalarValues::Real`, a parser
failure, an unresolved type and a real usage-kind typing error. Manta additionally
rejects unresolved-reference findings even when the upstream kernel labels them
warnings, rather than counting an incomplete model as accepted.

The upstream implementation explicitly documents a growing rule inventory, not
complete OMG conformance. Semantic acceptance means this kernel found no error
or unresolved reference in its implemented rules. It is not evidence that the
requirements are complete, the physics correct, or a product safe.

The upstream strict full-form exporter can reject otherwise valid models because
some derived properties remain unavailable. `full-json` therefore uses the
upstream recovery-enabled representation and labels this scope explicitly.
Do not describe it as lossless complete interoperability with every SysML tool.
Prefer `compact-json` for source/model interchange and retain the textual source.

## NOS3 component workflow

1. `generateNos3Model({projectId})` writes
   `models/nos3-attitude-interface.sysml`, a real semantically checked model.
   If the expected NOS3 source files exist, it records their hashes. This is a
   **Manta reconstruction from source**, not a NASA-issued architecture model.
2. The model separates sensor measurement, mounting rotation, flight-software
   estimator and reference dynamics truth. It records `R-ROTATION`, `R-SIGN` and
   `R-SENSOR-SEPARATION`, plus a pending flight-software input-path verification.
3. Submit the NOS3 component runner with that `modelFile` and
   `expectedModelHash`. Its evidence snapshots the exact model it exercised.
4. `bindNos3Results({projectId, path, resultPath, expectedHash, expectedResultHash})` accepts an
   explicitly component-scoped measured result bound to that exact model hash,
   including failed requirement checks that produced valid measurements.
   The application supplies the protected job receipt as `expectedResultHash`,
   which the backend checks again when it reads the result; edits between the
   outer integrity check and model binding are refused.
   It records source result hashes, appends measured residuals and assertion
   constraints to the SysML file, reruns semantic acceptance, and returns real
   static constraint verdicts. Failed measured limits remain **violated**.
5. `R-SENSOR-SEPARATION` must remain not-tested after this component harness.
   The source-ingest path, live telemetry and full NOS3/cFS/42 simulation are
   separate integration work. The generic unit-quaternion constraint retains
   undecided parameters; they are not silently counted as passed.

Binding records declared result values; it does not independently rerun the
component executable. Keep the runner's result, logs, source snapshots, compiler
metadata and manifest together with the model evidence for review. Rebinding
requires regenerating/editing the model first, rather than silently overwriting
previous measurements.

## Tests

```
node --test tests/model-backend.test.mjs
```

On macOS run this from a context where Manta can create its own sandbox.
Codex's outer command sandbox may reject nested `sandbox-exec` with
`sandbox_apply: Operation not permitted`; run the test command with the tool's
normal reviewed escalation. The service never responds by dropping its internal
sandbox.
