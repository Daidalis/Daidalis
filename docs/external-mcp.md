# Project MCP connections

Manta can connect to an existing MCP server over stdio or Streamable HTTP. A
connection belongs to one project. The connector does not install packages,
import global Codex/Claude configuration, or add entries to either application's
configuration files. Codex, Claude and custom SDK runtimes use the same Manta
gateway and permission checks.

## Configuration

Only trusted user-facing configuration routes may call `save` or `remove`, with
`{userInitiated: true}`. These operations must not be exposed as agent tools.
Connections are disabled unless `enabled` is explicitly true. Testing or using an
enabled stdio connection starts its configured executable.

Configurations are saved at
`<Manta service dataDir>/project-connectors/<projectId>.json` with mode `0600`.
This protected service location is intentionally outside agent-editable project
files. Tests must use a temporary `dataDir`; no default directory is created.

Example input to the service API:

```json
{
  "id": "simulation-worker",
  "name": "Simulation worker",
  "transport": "http",
  "enabled": true,
  "url": "https://engineering.example.org/mcp",
  "accessTokenEnv": "MANTA_MCP_SIMULATION_TOKEN",
  "toolPolicies": {
    "list_models": "read",
    "submit_simulation": "run",
    "update_model": "write"
  }
}
```

This does not provision the example endpoint. A real endpoint must already exist.
HTTP requires TLS except for an explicitly configured loopback address. Redirects
are disabled to avoid forwarding authorization to another origin.

For stdio, specify an installed absolute executable path, argument array, and
project-relative `cwd`. Package executors such as `npx` and `uvx` are rejected;
Manta will not download a server implicitly. `env` holds explicit non-secret
values; `envFrom` maps the child environment variable to a dedicated
`MANTA_MCP_*` source variable:

```json
{
  "id": "installed-tool",
  "name": "Installed engineering tool",
  "transport": "stdio",
  "enabled": false,
  "command": "/absolute/path/to/already-installed-server",
  "args": [],
  "cwd": ".",
  "envFrom": {"API_TOKEN": "MANTA_MCP_ENGINEERING_TOKEN"},
  "toolPolicies": {"inspect_project": "read"}
}
```

No full host environment is passed to a child. Home, temporary files and identity
fields are replaced with project-specific service directories and PATH is minimal.
Model-provider credentials cannot be referenced through `envFrom` or
`accessTokenEnv`; use dedicated connector variables. HTTP access tokens can also
be supplied as `save(..., {userInitiated:true, runtimeKey:token})`; these remain in
memory and are lost on restart. Passing `runtimeKey:null` clears one.

**A stdio executable is a trusted process, not an OS sandbox.** Its server code
can perform filesystem or network operations allowed by the operating system.
For engineering dependencies, prefer an MCP endpoint on an isolated remote
worker. An isolated HOME prevents implicit user configuration loading but does
not itself enforce filesystem containment. Review the server before enabling it.

## Runtime API

```js
const connectors = createConnectorService({store});
connectors.list(projectId); // Configuration/status only; does not start servers.
await connectors.save(projectId, input, {userInitiated:true, runtimeKey});
await connectors.remove(projectId, connectorId, {userInitiated:true});
await connectors.test(projectId, connectorId, {signal});
await connectors.tools(projectId, connectorId, {signal});
await connectors.describeTool(projectId, connectorId, toolName, {signal});
await connectors.call(projectId, connectorId, toolName, args, {signal, approved});
await connectors.closeProject(projectId);
await connectors.close(); // Call during server shutdown.
```

Discovered tools include original input schemas plus `effect`,
`policyConfigured`, `requiresApproval` and `untrusted`. Remote `readOnlyHint`
annotations are informative only. A tool without a user policy defaults to
`write`, `policyConfigured:false`, and requires approval even in Auto mode. The
caller applies the current permission policy and only then supplies
`approved:true`; the connector rejects unapproved write/run calls.

The MCP client sends cancellation to the server, enforces bounded request times,
limits catalogs and wire messages, bounds returned text/structured results, omits
binary media payloads from model context and redacts resolved credentials. Errors
are bounded and redacted. These controls limit returned data; actual engineering
job cancellation still depends on the connected server's cancellation behavior.

Tools and their outputs are untrusted external material, not instructions or
evidence of user approval. A successful handshake only proves connectivity and
capability discovery. Engineering verification requires actual tool execution,
saved native outputs and task-specific acceptance checks.

## Verification

`node --test tests/external-mcp.test.mjs` uses actual SDK stdio and HTTP servers
under temporary directories. The HTTP test binds a temporary loopback port and
requires local-socket permission. It does not contact external services or run
engineering applications.
