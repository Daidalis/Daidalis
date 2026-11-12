# Engineering state and configuration evidence

Manta keeps engineering state separate from chat, agent execution, and tool permissions. A completed agent turn does not approve a requirement or verify a spacecraft. This M1 increment records explicit engineering records and dependencies, observed configurations, explicit user approval, proposed changes, and the applicability of recorded evidence.

## Working from existing engineering

Choose the existing engineering folder when creating a project. SysML and other model source files remain the model authority. Create engineering records explicitly when needed for decisions, changes, and evidence; the application does not automatically copy model elements into a second project graph. New records remain candidates. An observation snapshot records the selected project files and current engineering objects; it is not an approved engineering baseline.

Review the observation and its unresolved issues before approving it. Approval requires an explicit user action and a reason. An agent may prepare objects, observations, proposed changes, or evidence, but cannot turn its own suggestion into a user-approved baseline. Auto mode controls operational permissions and does not grant engineering approval. The current local user confirmation entry is separate from the agent tools; it is not an authenticated engineering signature or an independent review system.

Record each piece of evidence with its actual result, limited scope, relevant objects, selected configuration, and project files. If a snapshot is selected, the relevant object dependency versions and selected file fingerprints must match that observation; Manta rejects a mixture of an earlier snapshot and changed current inputs. For example, successful parsing of six imported requirement rows is evidence of an input-format check. It says nothing about the feasibility or verification of the six requirements.

When a requirement, dependent object, model, or evidence file changes, Manta re-evaluates whether the recorded evidence applies. The original result remains a historical fact. `current` describes a configuration match, not a successful result or engineering acceptance. Evidence entered through these APIs is a declaration; its origin has not been authenticated against a native execution receipt, so even a declared `passed` result remains `unknown` when versions match. A related change takes priority as `needs_review`, and missing or unsafe material becomes `invalid`. Unrelated edits do not add an impact without a tracked dependency.

## HTTP interface

Source strings are provenance metadata, not instructions and not files that the service automatically reads. An imported dependency may remain unresolved and appear as an explicit issue; this is preferable to inventing or dropping it. Evidence and change targets must exist.

All paths below are scoped to `/api/projects/:projectId/engineering-state`. File paths are relative to that project's selected folder; absolute paths, traversal, and symlinks escaping the workspace are rejected.

| Request | Purpose |
|---|---|
| `GET /` | Read objects, relations, snapshots, changes, evidence, issues, and current revision. |
| `POST /objects` | Create or revise a stable object with `id`, `kind`, `title`, `description`, `sources`, and `dependsOn`. Updating an existing object requires its own current `expectedRevision` to detect concurrent edits; this is distinct from the ledger revision. |
| `POST /snapshots` | Observe the engineering configuration and explicitly selected `paths`; `name` describes its intended use. |
| `POST /snapshots/:id/approve` | Record the user's explicit approval with a nonempty `reason`. This is not an agent tool. |
| `POST /changes` | Record `title`, `reason`, affected `objectIds`, and optional `baseSnapshotId`. A change proposal does not silently approve or implement its design. |
| `POST /evidence` | Record `title`, `scope`, actual `result`, relevant `objectIds`, `paths`, and optional `snapshotId`. |

The independent JSON project graph, its editor, structural coverage, `get_model` / `update_model`, and `/api/projects/:projectId/model` routes have been removed. The separate `/api/projects/:projectId/workspace/model?path=...` interface still parses the current SysML file for its structure and requirement views. Model validation, query, verification, and export remain available.

On startup, former `models` rows move to `legacyProjectGraphs` in the persistent state. Graph-imported ledger objects, relations, and relation history move to that ledger's `legacyProjectGraph` archive. Neither archive is exposed as current engineering objects or injected as the current model in the AI context. Explicit engineering objects, immutable snapshots, approvals, changes, and evidence remain. Old evidence bound to archived objects becomes inapplicable until reviewed; its original result is preserved. Explicitly recording a new object with an archived ID continues its revision sequence so it cannot silently reactivate old evidence. Restarting does not duplicate the archive. This is preservation of history, not an active graph service.

Agent reads and object-write responses include current objects and history counts, without replaying historical revisions. This also applies when explicitly reusing an archived ID. The service retains the full revision history for human inspection.

## Durable engineering plan

The coordinator reads `get_engineering_plan` and saves the complete work plan with `update_engineering_plan`. Use `expectedRevision: 0` for the initial plan, then the latest plan revision for updates. A rejected update leaves the previous plan unchanged: correct validation errors and retry; for a revision conflict, read and merge the current plan first. Confirm the returned revision before reporting a successful save.

Work items can link project-relative `modelPaths`, deliverables and verification acceptance criteria without registering every SysML requirement. `recordIds` and `verification.requirementIds` refer to explicitly registered engineering object IDs, not SysML element names. Leave these lists empty unless those records exist. To register a sourced object, omit `expectedRevision` or use `0` for creation; when updating it, supply its current object revision, which is separate from the plan and overall engineering state revisions.

`artifactIds` holds project artifact IDs returned by `create_artifact`; IDs returned by model validation or import belong to the model backend and do not qualify. Use `modelPaths` for source-file links. Evidence links likewise require existing engineering evidence, completed tool receipt or project artifact IDs, rather than file paths or model/run IDs.

Omit `review` or use `null` until a review exists. An empty placeholder (`{"findings":"","evidenceIds":[]}`) on an item whose status is not `reviewed` is treated as no review. Items marked `reviewed` still require nonempty findings and existing evidence references. Unknown IDs, fabricated evidence and stale revisions remain errors; plan metadata does not grant engineering acceptance.

## Verification and limits

Run the focused HTTP suite with an existing Node runtime:

```text
node --test tests/engineering-state-http.test.mjs
```

The suite uses independent temporary application data and project folders. Computer control, model backends, evaluators, numerical engineering, NOS3, external connectors, and VM services are disabled. No environment is installed and no spacecraft simulation is started. It checks explicit object registration, configuration observation, explicit approval, evidence applicability after related and unrelated edits, file changes, persistence, revision conflicts, and project boundary validation.

The STF fixture preserves the six public L0 objectives at NOS3 commit `5a3bdee6be9a2c67fdf994ae6db56d5c60395302`, their known definition gaps, and unfinished real engineering conditions. The original source is [STF ConOps at the pinned version](https://github.com/nasa/nos3/blob/5a3bdee6be9a2c67fdf994ae6db56d5c60395302/docs/wiki/STF_ConOps.md). Imported reference objectives are not a NASA-approved Manta baseline. Fixture checks are not a full STF verification matrix, professional tool acceptance, physical qualification, or mission completion.

This increment does not automatically resolve requirements, perform semantic impact analysis across arbitrary professional tools, establish independent assurance, restore solver checkpoints, implement configuration branching/merging, or complete hardware/HIL/environment/lifetime work. Those activities and their missing conditions remain visible in the project plan.
