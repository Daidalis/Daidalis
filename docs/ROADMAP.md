# Manta roadmap

Manta's goal is to make real systems engineering approachable through conversation. A user describes an engineering goal or an existing problem; Manta helps organize the requirements, design, implementation, integration, verification and subsequent changes, with inspectable models and evidence.

## Product principles

- **Conversation first.** The Coordinator and task threads are the main interface. Plans, tool activity, documents, models and results belong to their conversations; detailed work surfaces open when needed.
- **One layer of task threads.** The Coordinator delegates, waits for dependencies, reviews results and summarizes. Threads do not create further threads. Users can speak directly to any thread.
- **Native Agent runtimes.** Continue using Codex app-server and Claude Agent SDK for Agent sessions and tool execution, with user-configurable compatible models and endpoints.
- **Engineering tools with explicit scope.** An installed program, an MCP connection, a successful solver exit and a verified requirement are different facts. Connect the tools required by the engineering work and retain their inputs, versions, outputs and limitations.
- **Iteration throughout.** Support new projects and work resumed from existing requirements, models, code or failed tests. The V model relates design levels to verification and validation; it does not require a one-way stage wizard.
- **Evidence before completion claims.** Preserve failed checks, unresolved decisions, configuration changes and applicable work that has not been performed. A completed Agent task does not approve an engineering system.

## First engineering case: STF

The first case is the STF reference mission associated with NASA NOS3. The target is a requirements-driven workflow that can develop the case and accept changes to an existing engineering baseline.

Priority work includes:

1. Traceable mission intent, operating scenarios, requirements, interfaces and acceptance criteria.
2. Consistent native models and detailed design, with appropriate professional tool adapters and isolated execution environments.
3. Mission-level coverage, resource and science-data delivery analysis, including fault handling and the applicable operating duration.
4. Integration and verification across software, simulation and applicable physical systems.
5. Configuration-aware evidence, review, change impact and the ability to continue or revise previous work.

Selected model checks, numerical studies and software-integration recipes have been exercised. The recorded low-power demo demonstrates one such increment. Complete STF development and mission acceptance remain unfinished; a local numerical result or software regression does not establish the whole mission's performance.

Applicable hardware/HIL, environmental, lifetime and independent acceptance work remains visible when resources or evidence are missing. A demo limits the supported case, rather than reducing that case's real engineering requirements.

## Next engineering case: Apollo

After the STF case is completed, apply the workflow to an Apollo case whose mission version, system boundary and evidence sources are explicitly selected. Running one historical subsystem emulator would be an intermediate result, not completion of the spacecraft.

## How progress should be evaluated

Evaluate the application workflow, tool integration and engineering case separately. A useful increment should make the goal, relevant configuration, actual execution, review findings and remaining work inspectable. Public practitioner research can inform the design, while individual reports should not be presented as representative interviews or industry-wide validation.

This roadmap expresses product direction and open work. It is not a certification claim or a promise that every listed tool, platform or full engineering case is currently supported. See the README and tool-specific documentation for the implemented scope.
