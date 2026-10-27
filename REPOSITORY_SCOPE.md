# Repository scope

This repository contains Manta application source, tests, documentation, the pinned SysML runtime, isolated Linux VM/worker setup source, and a standalone product website. Public product direction is summarized in [the roadmap](docs/ROADMAP.md).

Runtime conversations, credentials, local configuration, personal reference screenshots, internal project notes, full engineering/evaluation workspaces, VM disk images and state, downloaded source archives, and third-party NOS3 checkouts are excluded. The maintainer retains authoritative project records separately. Their exclusion does not close any associated STF requirement or evidence gap.

The website includes an explicitly bounded recorded low-power example: two original EPS CSV files, a frozen native test recipe, and a curated export of check outcomes and hashes. These sample files contain no runtime chats, keys, machine paths or VM state. Curated narrative and the explanatory design map are presentation content, not a verbatim historical conversation, a live Agent run or a complete STF engineering baseline. See [demo provenance](website/dist/assets/evidence/README.md).

The application is a local workspace, not an authenticated multi-user network service. Agent connections and professional runners require their documented configuration; an application installation does not automatically provision the engineering stack. See [README.md](README.md), [SECURITY.md](SECURITY.md) and [environment setup](docs/local-linux-vm.md).

The product website can be served independently as static files. A hosted website and the source repository have separate access controls. Hosting manifests with a live owner's Site identity belong in local configuration; the public website directory supplies a template for a new deployment.

Upstream components retain their own licenses and notices. The pinned SysML package is included with its upstream license and notices; the repository does not relicense third-party work. No complete STF, flight qualification or certification package is included.
