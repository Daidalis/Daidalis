# NOS3 execution connector

本机隔离 Linux 路线现已接通，详见 [本地 Linux 虚拟机](local-linux-vm.md)。下述远程 HTTPS Worker 路线继续可用。


Manta keeps the Codex/Claude native runtimes. This connector is an asynchronous engineering tool behind the common tool service, not a replacement agent loop. It does not install software, modify shell profiles, or read global Codex/Claude/SSH configuration.

## What is actually executable

- `component`: a fixed harness compiles the **actual committed NOS3 generic_adcs C utility source** using an already installed C compiler, in the job evidence directory. Local execution permits only the reviewed SHA-256 source bytes listed in `server/nos3/core.mjs`; arbitrary changed code cannot be executed by choosing this mode.
- The 324 deterministic scenarios cover identity, single-axis and noncommuting composed rotations, quaternion sign equivalence, and inverse vector rotation. The oracle independently constructs passive Rodrigues rotation matrices. The fixed tolerance is `1e-12` maximum vector-component error.
- `build` and `integration`: require an explicitly configured HTTPS remote worker and operator-approved recipes on a dedicated disposable Linux deployment. Without it, the job becomes **blocked**, with a result and evidence manifest; it does not silently fall back to SciPy or pretend a full NOS3 simulation ran.
- Component results explicitly carry `fullNos3Simulation:false`, `modelBehaviorExecuted:false`, `hardwareValidation:false` and `R-SENSOR-SEPARATION:not-tested`. This does not solve/validate the complete star-tracker frame issue. A result bound back into SysML verifies declared residual limits, not execution of SysML behavior.

## Service API

```js
const nos3 = await createNos3Service({root, dataDir, store, emit});
await nos3.inspect({projectId});
// A user-settings operation: never let an agent choose a new credential destination.
await nos3.configure({projectId, worker:{
  type:'remote-https', endpoint:'https://engineering-worker.example/nos3',
  tokenEnv:'MANTA_NOS3_TOKEN'
}});
const job = await nos3.submit({
  projectId, scope:'component', revision:sourceCommit,
  modelFile:'models/nos3.sysml', expectedModelHash:validatedModelHash,
  modelEvidence:[{path:'models/interface-contract.json',sha256:contractHash}],
  timeoutMs:120000
}, {threadId,runId,signal});
await nos3.wait({projectId,jobId:job.id},{signal,timeoutMs:1800000});
await nos3.result({projectId,jobId:job.id});
await nos3.cancel({projectId,jobId:job.id});
```

`submit` returns immediately. `wait` listens for a terminal state without asking the model to repeatedly inspect progress. Aborting a wait leaves the job intact; aborting the submitting run cancels its job. The connector serializes jobs; timeout/cancel terminates the process group or requests cancellation from the remote worker. Statuses: `queued`, `running`, `completed`, `failed`, `blocked`, `cancelled`, `interrupted`.

`list({projectId})`, `status({projectId,jobId})`, `readOutput({projectId,jobId,file})` and `close()` are also available. Job and output access is project-scoped. A service restart marks incomplete jobs interrupted instead of replaying them. A remote worker also has its own bounded job timeout and restart recovery.

Each submission pins the root Git commit, gitlink commits (recursively for populated submodules), inspected source hashes, exact model bytes/hash and input fingerprint. Dirty/untracked source is not substituted for committed code. The source checkout is read-only for execution; compilation occurs in `engineering/nos3/<job-id>/source`. Output includes copied sources/harness, input, build/run logs, checks and a SHA-256 manifest. Protected service records retain `resultSha256` and `resultPath`; result-to-model binding must compare this trusted hash with the actual result file before accepting it.

## Remote worker deployment

The runnable entrypoint is `runners/nos3/worker.mjs`. Importing it has no side effects. It uses Node built-ins and existing git/tar/compiler only. No Docker/VM/image is installed or started by Manta.

Deploy this **on a dedicated isolated host**, not the user's Mac:

```sh
MANTA_NOS3_SOURCE=/srv/mirrors/nos3 \
MANTA_NOS3_DATA=/srv/manta-nos3-jobs \
MANTA_NOS3_TOKEN='<random token of at least 24 characters>' \
MANTA_NOS3_RECIPES=/opt/manta/runners/nos3/recipes.example.json \
node /opt/manta/runners/nos3/worker.mjs
```

Put an authenticated TLS reverse proxy in front of the loopback listener; Manta accepts only HTTPS endpoints, never URL credentials or redirects. A private enterprise HTTPS address can be explicitly configured. Keep tokens in environment variables prefixed `MANTA_NOS3_`; Manta does not inspect unrelated host credentials. Do not put secrets in prompts or checked-in files.

The optional `Containerfile` takes a mandatory digest-pinned `BASE_IMAGE` already containing Node >=22, git, tar and clang. It performs no package-manager install. Run unprivileged, read-only source mount, isolated writable jobs volume, without Docker socket/host network. This simple container is suitable for the component worker. A full NOS3 deployment that launches its own containers needs a **dedicated disposable Linux machine**, not a Docker socket mounted into Manta.

Full build/integration require a complete mirror with all gitlinks checked out at their recorded commits, a compatible prepared NOS3 deployment, configured mission and dependencies/42 runtime. The worker makes a new committed-source snapshot, never builds in the mirror. `recipes.example.json` is an operator template, not an assertion that an unprepared Linux system can build NOS3. The supplied scripts are runnable and fail closed when deployment assets are absent:

- `verify-build.py` checks actual cFS and simulator binary artifacts after `make all`.
- `run-and-verify-integration.py` launches upstream NOS3/42/cFS/COSMOS, checks real process/container states, executes the upstream SAMPLE command/telemetry test without interactive Docker flags, and collects observed counters and logs. It requires an explicitly dedicated/empty Docker daemon and `/opt/manta-nos3-site/images.lock.json` mapping the two upstream image names to preloaded immutable `sha256:` image IDs. No image is pulled by this script. Upstream launch scripts can modify their disposable containers; use a prepared deployment and controlled package mirrors as appropriate. It never runs on the Mac automatically.
- These integration checks are an operational smoke, **not** star-tracker frame verification. `R-SENSOR-SEPARATION` remains untested. Do not report mission-wide validation from this report.

Recipes live only on the worker, are supplied by its operator, use explicit argv arrays, and cannot be supplied through an Agent job request. Commands run with a job-local HOME/TMPDIR. A result must provide `manta-nos3-verification-v1`, correct scope, nonempty explicit checks, consistent pass/fail, and, for integration, real nonempty telemetry files. An exit code alone is never acceptance. Input/model fingerprints are echoed and checked; transferred evidence is size-limited and hashed.

## Wire protocol

Bearer-authenticated routes: `GET /health`, `POST /jobs`, `GET /jobs/:id`, `GET /jobs/:id/result`, `POST /jobs/:id/cancel`. Submit is idempotent by job ID plus input hash. Cancellation also records an authenticated tombstone for a job ID not yet accepted, so an aborted POST cannot later start an orphan job. The client records confirmed/unconfirmed remote cancellation. Jobs include a pinned baseline, scope, input hash and bounded base64 model snapshots; filesystem paths alone are insufficient. Results must echo `inputHash`, `baselineHash`, scope and include bounded base64 evidence with SHA-256. The client never follows a result-supplied URL. Build/integration acceptance also requires command receipts, nonempty execution logs and a matching native verification report; integration additionally requires the referenced nonempty telemetry evidence. A worker publishes its terminal state only after persisting the result.

## Verified scope

Focused tests execute the real upstream C source in temporary Git fixtures and exercise a real loopback standalone worker, including model transfer and returned logs. Negative tests cover unsupported source, missing workers, wrong revisions/hashes, cross-project reads, remote-result mismatch, cancellation, persistence and no false full-simulation success. No engineering product, container runtime or global package was installed to perform these checks.
