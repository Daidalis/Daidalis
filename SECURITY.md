# Security

## Intended deployment

Manta is intended to run as a local engineering workspace. The application binds to loopback and validates Host and Origin headers, with cross-site requests blocked. Engineering execution and native Agent permissions have additional project and runtime boundaries.

Loopback and browser-origin checks do not provide user authentication for a network deployment. The application does not claim to be an authenticated multi-user hosted service. Exposing its API through a public listener, tunnel or reverse proxy requires a separately reviewed authentication and deployment design.

The static product website and recorded demo do not connect to the local application or run an Agent or solver. Access settings for a hosted website are separate from application security.

## Credentials and local state

Configure model and tool credentials through the documented application or service environment. Keys entered in the model settings UI remain in service-process memory and must be re-entered after restart; configured environment variables are resolved by the local service. Do not place credentials in frontend assets, project prompts, command arguments, committed environment files or example data.

Runtime state, conversations, VM/runner credentials and engineering project files belong outside the public source distribution. Review files and Git history before publishing or sharing a repository. If a real credential is exposed, revoke or rotate it with its issuer; deleting a file or rewriting a commit does not revoke the credential.

## Report a vulnerability privately

Use the repository's **Security → Report a vulnerability** flow through [GitHub private vulnerability reporting](https://github.com/MingxiYe/Manta/security/advisories/new). Include the affected version, expected boundary, reproduction steps and impact, with credentials and private engineering data removed.

If private reporting is unavailable, request a private reporting channel without publishing exploit details or sensitive data in a public issue. Please do not include real keys, private models, runtime chats or unredacted logs in a public report.

Security fixes and supported scope will be documented in the repository. A successful test of one adapter or configured runner does not establish the security of every external tool or deployment.
