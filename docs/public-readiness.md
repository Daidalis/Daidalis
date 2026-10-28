# Public-source readiness review

The historical source review below was performed on 27 October 2026.
The subsequent Linux Docker edition and interactive trial are documented in
[Docker deployment](docker.md); its build and runtime scope differ from the original VM setup.

Reviewed on 27 October 2026. This report separates the sanitized source snapshot from the pre-release private repository and from full engineering-tool provisioning.

## Linux rootless follow-up, 28 October 2026

Local Linux amd64 checks on the Docker adaptation branch (uncommitted):

| Check | Observed result |
| --- | --- |
| Full Node regression in an offline non-root container | 724 tests: 710 passed, 0 failed, 14 skipped |
| Broker request policy | 4 Python tests passed, including the NOS3 default deadline |
| Rootless task boundaries | Project/credential/network boundaries, memory/PID limits, Auto policy, cancellation and detached-child cleanup passed |
| Native Codex and Claude | Actual model-backed clamp repository repair passed; source-only changes and unchanged tests verified independently |
| API-mode Agent | Same model-backed clamp repair passed through isolated commands |
| Native session persistence and lifecycle | Five concurrent native sessions each resumed in a new disposable task container; cancellation prevented the executing child from writing its delayed marker |
| ngspice / OpenSCAD / OpenModelica | Actual isolated solver runs passed |
| GIS / NASA 42 / orbit-to-ground | Native outputs, real supplied Census boundary controls and evidence integrity passed |
| NOS3 | 324 component cases, native build, and integration checks (baseline, fixed, negative-sign, invalid, sensor-bias, runtime-restored) passed |

The 14 Node skips are three macOS-only sandbox checks, two legacy NOS3 source/compiler
paths, and nine STF/reference-asset checks. Independent rootless acceptance covers
the Linux task boundary and native NOS3 path; it does not make those skipped tests
pass. STF remains deferred. CPU quota was explicitly disabled because this server
lacks CPU-controller delegation; memory and PID limits were checked. Browser/desktop,
external connectors and the local numerical service remain disabled in broker mode.
Windows/macOS/ARM64 validation and a packaged desktop shell remain deferred.

Docker CI now includes a rootless job and an opt-in model-backed acceptance job.
The workflow has been validated locally for syntax, but has not run on GitHub.
This follow-up does not rerun or extend the historical source-disclosure audit below.

## Isolated service follow-up, 28 October 2026

The later broker service update adds project-specific Chromium/virtual-desktop
and stdio MCP containers, the fixed SciPy numerical adapter, and restores the
bounded-data evaluator. HTTP MCP retains its explicit endpoint and credential
policy in the trusted application. This supersedes the disabled-service list in
the earlier rootless follow-up above.

The service update passed a full 728-test Node regression: 714 passed, 14 original
skips, zero failures. The final MCP cancellation and noVNC relay changes additionally
passed all 17 targeted session/desktop/MCP regressions. Four new session tests cover cancellation during startup, malformed
worker output, closed-session use and external/symlinked workspace rejection.
The four Python broker policy tests also passed.

Actual rootless checks passed for SciPy parameter scans and output hashes, the
explicit-scope evaluator route, real MCP SDK catalog/tool calls with unrelated
project/model-credential/socket access denied and a non-cooperative cancelled server
prevented from writing a delayed marker, Chromium screenshots with protected
API denial and Manual approvals, and two project desktops opening OpenSCAD and
writing separate files. noVNC HTTP and the real WebSocket/RFB handshake were
exercised, including 24 successive HTTP connections and closing the previous tunnel
on project switch. The mixed
load test kept two desktop sessions open while five native Codex/Claude sessions
ran and resumed; cancellation also passed. It exposed the old broker PID limit,
which was corrected by bounding Docker CLI parallelism and assigning 512 PIDs to
the control service. Repetition recorded zero PID-limit hits. These tests used
synthetic local data and no paid model requests.

Browser and desktop session state is temporary and subject to the documented
lifetime/output limits; saved project files persist. Stdio MCP remains offline;
network-dependent integrations need an explicitly configured HTTP MCP server.
STF, legacy VM management, other-platform validation and native desktop packaging
remain deferred. The updated Docker CI has not been run on GitHub.

## Source disclosure

The source snapshot removes personal reference screenshots, internal planning/research records, author-specific workstation paths, and the owner's live hosting manifest. Maintainer engineering records remain outside the source distribution. Public goals are retained in [the roadmap](ROADMAP.md); removing private notes does not close any engineering requirement.

No real API keys, private keys, GitHub/AWS/Slack tokens, JWTs or private conversation links were identified in the inspected source and pre-release reachable history. Known test credentials are synthetic. The scanner expands compressed packages and reports locations rather than credential values. Its tests cover redaction, deleted historical credentials and compressed content. This is a heuristic review, not a guarantee that arbitrary secrets or image content can always be detected.

**The owner subsequently authorized replacing the existing repository history with the sanitized snapshot.** The advertised main branch was replaced using an exact force-with-lease, and the maintenance checkout was aligned with that clean root to prevent accidental reintroduction of the old commits. A complete old-history backup is kept outside the source distribution. The maintainer checkout can still retain unreachable old objects and reflogs; these are not transferred by a fresh clone of the advertised main branch. Do not publish a zip of the whole working folder or its `.git` directory. Repository visibility was not changed.

Replacing advertised Git history does not prove that GitHub has purged cached views or every internal reference. Follow [GitHub’s sensitive-data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) before treating the old server-side data as irretrievable. Fresh clones of the advertised main branch receive the sanitized history.

## Executed validation

Environment: macOS ARM64, Node.js 24.22.1. Application dependencies were installed from the public registry with a fresh HOME/cache on the maintainer's separate development volume, without a global package or runtime installation. Test state used an automatically cleaned local temporary directory because the network filesystem does not preserve the permission and timing semantics required by the tests.

| Check | Observed result |
| --- | --- |
| Fresh `npm ci` | Passed; 119 applicable platform packages installed |
| Full default test set | 685 tests: 673 passed, 0 failed, 12 explicitly skipped |
| Credential-free application smoke | Passed: health, HTML, JS, shared module, empty bootstrap, Origin and Host guards |
| `npm run doctor` with Codex deliberately unavailable | Passed required dependencies; native Agent/browser/runner setup reported as optional or unverified |
| Dependency advisory audit | 0 known vulnerabilities in the audited lockfile |
| Source disclosure scan | Passed current source, including nested compressed contents; old private history remains a separate disclosure gate |
| Static website and recorded evidence | Passed references, original CSV/model hashes and data/check consistency |
| macOS desktop source | Objective-C syntax check passed; this is not a signed/notarized distribution test |

The 12 skipped tests require an explicit external SciPy/NOS3/compiler, frozen evaluation boundary or STF reference bundle. Skips do not establish tool or mission acceptance. No paid model turn or new professional simulation was performed. Native Agent protocol tests and supported SysML semantic checks were exercised, while users still need to configure and test their actual Agent credentials and compatible endpoints.

A Linux/macOS Node matrix and a Windows browser-service smoke job are provided in CI. This local report does not assert that those remote CI jobs or the full Windows application/toolchain have passed.

## Portability repairs

- Resolve Codex through explicit configuration, PATH and bounded standard app locations; missing executables produce setup instructions.
- Remove the author's bundled Python, Node, browser-module and engineering-workspace fallbacks.
- Load only checkout-local `.env` data, with inherited variables taking precedence. Shell, desktop and Node entry points use the same `data/` default; configured launch paths support spaces and non-ASCII text.
- Reference repository-owned VM workers from their actual `vm/` locations. External inputs require explicit configuration; tests no longer probe the maintainer's private workspace.
- Preserve pinned toolchain and recorded evidence bytes across platform line-ending conversion.

The minimum Node version is 22.13.0 because the SysML wrapper uses the stable permission flag introduced in [Node 22.13](https://nodejs.org/en/blog/release/v22.13.0). The dependency override uses body-parser 2.4.0, the patched release identified by [the upstream security advisory](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828).

## Remaining release decisions and limits

1. The advertised history replacement is complete. Any cached old GitHub views or undiscovered third-party clones require separate handling; the external private backup must not be published.
2. The owner selected Apache 2.0 for Manta-owned code and original documentation on 27 October 2026. See the root LICENSE, NOTICE and THIRD_PARTY_NOTICES.md; upstream terms remain in place.
3. Basic installation does not provision every professional solver. The exact managed NOS3/cFS/42 environment still needs the frozen archives, packages and manifests named in `vm/worker/native-inputs.json`; a verified public installer that recreates that entire bundle is not included. See [installation](installation.md) and [runner contract](nos3-runner.md).
4. Manta is a local workspace, not an authenticated multi-user hosted service. The public marketing site is independent of the local application. See [security scope](../SECURITY.md).

These checks do not complete STF development, physical qualification or independent mission acceptance. The case priority remains complete STF, then Apollo.


## Follow-up disclosure and runtime-record review

On 27 October 2026, the advertised source and reachable history were scanned again, including nested compressed contents. Independent text, image/metadata and archive reviews identified no new real credential or private personal content in the published source snapshot. GitHub’s repository owner identity and curated engineering job identifiers remain intentionally visible. GitHub cached history, old Actions logs/artifacts and third-party copies were not verified by this review.

A synthetic-credential reproduction identified an application logging gap: nested tool arguments, approvals and delegated task text could bypass string-only redaction. The fix separates active execution inputs from saved public metadata, redacts nested event/approval/task/chat records, and sanitizes known credentials when replaying older runtime records. Original engineering files and evidence bytes are unchanged. Seven privacy regressions and the related 144-test regression set passed, with no failures or skips. This is a targeted fix, not a full security assessment; unknown/retired credentials, old private disk records and native-runtime private session logs remain outside automatic cleanup. The running application was not redeployed by this source review.
