# Third-party components and source attribution

Manta-owned code and original documentation are licensed under Apache 2.0; see LICENSE and NOTICE. That grant does not replace third-party terms or claim ownership of upstream material. The entries below apply to the components actually accompanying a given distribution.

## Bundled components

| Component / source-repository paths | Version / source | Terms and retained notices |
| --- | --- | --- |
| Open-MBEE SysML toolkit: toolchains/sysml/sysml-wasm-0.10.10.tgz and toolchains/sysml/package/ | @sysml/wasm 0.10.10; https://github.com/Open-MBEE/sysml-toolkit/releases/tag/v0.10.10 | Apache-2.0 for the toolkit's own units; retain toolchains/sysml/package/LICENSE and THIRD-PARTY-NOTICES.md. |
| SysML / KerML standard-library source and its derived snapshots inside that package | Systems-Modeling/SysML-v2-Release, revision de1070ae8e79c21532b8004fc663d47b35d0e9fa | EPL-2.0, not relicensed under Apache 2.0; retain the embedded source, LICENSE-EPL-2.0 and all upstream copyright/attribution in toolchains/sysml/package/THIRD-PARTY-NOTICES.md. Original source: https://github.com/Systems-Modeling/SysML-v2-Release/tree/de1070ae8e79c21532b8004fc663d47b35d0e9fa . |
| Marked: public/vendor/marked/ | 15.0.12; https://github.com/markedjs/marked/tree/v15.0.12 | MIT; retain LICENSE.md (including its original attribution) and NOTICE.md in that directory. |
| NOS3 STF ConOps excerpts: tests/fixtures/engineering-state-stf.json | nasa/nos3 commit 5a3bdee6be9a2c67fdf994ae6db56d5c60395302; docs/wiki/STF_ConOps.md, L0-01 through L0-06 | NASA Open Source Agreement 1.3 for the upstream material; full pinned license retained in third_party/licenses/NOS3-NOSA-1.3.txt. The fixture adds Manta annotations, gaps and test metadata; it is not an upstream document or approved mission baseline. Original: https://github.com/nasa/nos3/blob/5a3bdee6be9a2c67fdf994ae6db56d5c60395302/docs/wiki/STF_ConOps.md . |

Component-local license/notice files and the recorded archive hashes remain authoritative. They have not been replaced with the root Apache license.

## External integration targets

Runner and verification scripts reference separately obtained NOS3, cFS, NASA 42 and component projects. Those complete projects and frozen execution environments are not included in this source distribution. Obtain and use them under their own applicable terms; Manta's Apache license does not grant rights to external software.

In particular, the pinned independent nasa-itc/generic_adcs commit 09a604fc10c8c79981ffeb2ee1792c7719674a10 has no license file identified in its Git tree. We do not infer a license from NOS3's top-level license or relicense that project. Integration scripts use short functional anchors/API identifiers to locate changes in a separately supplied checkout. The repository distributes Manta-authored change metadata instead of a static patch containing upstream source context; the isolated instrumenter generates an actual patch from the user's pinned checkout at run time. These test/instrumentation changes preserve raw sensor attitude at ingest and apply the mounting transformation once in attitude determination. They are Manta changes, not an upstream release or flight-qualified build.

Source locator: https://github.com/nasa-itc/generic_adcs/tree/09a604fc10c8c79981ffeb2ee1792c7719674a10 . Review the authorization for independently distributed components before using or redistributing their sources, binaries or generated patches.

## Installed packages and native Agent runtimes

npm dependencies are obtained by npm ci and are not bundled into this Git source distribution. Their package-local terms apply, including when distributing a runnable bundle. package-lock.json fixes the versions and records package license metadata; it is not a substitute for their license texts.

The current direct packages declare Apache-2.0 (openai, @anthropic-ai/sdk, playwright), MIT (@openai/agents, @modelcontextprotocol/sdk, zod), or their own README terms (@anthropic-ai/claude-agent-sdk: SEE LICENSE IN README.md). Claude Agent SDK's README refers to Anthropic's commercial terms. Native Codex, Claude Code, model services and external solvers remain subject to their own terms; the Manta license does not relicense or supply them.

## Website, examples and recorded numerical evidence

The static website contains Manta-authored presentation code/narrative, a curated model recipe and numerical outputs recorded by Manta from a selected integration run. It does not contain an upstream NOS3/cFS/42 program distribution or a verbatim private chat transcript. Keep the evidence origin, recorded date, scope and limitations in website/dist/assets/evidence/README.md. Public task-source references in datasets/ remain under their source terms; Manta's original curation does not transfer rights in the cited source material.

No use of third-party names, logos, interfaces or data implies endorsement by NASA or by the maintainers of the connected tools. No upstream trademark rights are granted by this notice.

## Retained NASA notice for the quoted NOS3 reference fixture

The following notice is reproduced verbatim from section 3.B of the pinned NOS3 license. It applies to the NOS3 material identified above. The fixture was assembled with Manta commentary and test metadata on 23 October 2026; Manta added explicit license/source metadata on 27 October 2026. These additions are identified as Manta-originated modifications to the reference fixture, derived from the cited Original Software/documentation; the six quoted objectives themselves are unchanged. The fixture is not an upstream NASA release.

```text
/* Copyright (C) 2009 - 2022 National Aeronautics and Space Administration. All Foreign Rights are Reserved to the U.S. Government.

   This software is provided "as is" without any warranty of any kind, either expressed, implied, or statutory, including, but not
   limited to, any warranty that the software will conform to specifications, any implied warranties of merchantability, fitness
   for a particular purpose, and freedom from infringement, and any warranty that the documentation will conform to the program, or
   any warranty that the software will be error free.

   In no event shall NASA be liable for any damages, including, but not limited to direct, indirect, special or consequential damages,
   arising out of, resulting from, or in any way connected with the software or its documentation, whether or not based upon warranty,
   contract, tort or otherwise, and whether or not loss was sustained from, or arose out of the results of, or use of, the software,
   documentation or services provided hereunder.

   ITC Team
   NASA IV&V
   jstar-development-team@mail.nasa.gov
*/
```
