# Project-local Apple Silicon Linux runner

This backend uses macOS Virtualization.framework directly. It does not install Homebrew, Docker, Lima, host services, launch agents, system extensions, or global SSH configuration.

## Lifecycle contract

- `host/vm-prepare.sh`: Download the fixed official Ubuntu 22.04 ARM64 build, verify SHA-256 checksums, compile and ad-hoc sign the project-local Swift helper, prepare sparse disk and cloud-init seed. Requires existing Apple command line tools and network access.
- `host/vm-start.sh`: Start only this VM, wait for guest SSH and cloud-init readiness, return JSON.
- `host/vm-start.sh --foreground`: Keep the VM helper as the process itself for app-managed lifecycle or managed command sessions. Read readiness from SSH/worker health; the helper's initial `running` event means Linux is booting.
- `host/vm-exec.sh 'guest command'`: Execute through SSH over a project-only Unix socket and virtio-vsock relay. Standard input is forwarded, so `vm-exec.sh 'bash -s' < script.sh` is supported.
- `host/vm-tunnel.sh [hostPort]`: Forward a loopback-only host port (default 8093) to guest loopback 8093. Keep the process alive for the worker connection.
- `host/vm-status.sh`: Inspect process and disk metadata without starting a VM.
- `host/vm-stop.sh`: Request guest shutdown, allow up to 20 seconds, then stop the Virtualization machine. It refuses to signal an unrelated reused PID.

The source-built VM helper requires the `com.apple.security.virtualization` entitlement. Apple Virtualization and local socket operations are unavailable in some command sandboxes; starting the helper from a normal local app or an approved unsandboxed process is required. No administrator helper is used.

## Resources and containment

- Guest: 4 vCPUs, 4096 MiB RAM, 10 GiB sparse logical root disk.
- Host: a 5 GiB free-space guard requests shutdown before exhaustion; preparation requires 8 GiB available.
- Writable shared directory: only `linux-vm/handoff`, mounted at `/mnt/manta-transfer`.
- Guest networking: outbound NAT; SSH binds guest loopback and is reached through virtio-vsock, without LAN SSH exposure.
- `state/` is mode 0700. The SSH key, known_hosts and host key trust are specific to this VM; all SSH calls use `-F /dev/null` and never read/write the user's global SSH config.
- All apt packages, system services and engineering toolchain installation happen **inside the guest disk**.
- Root disk uses explicit cached/full-synchronization disk attachment to avoid the observed corruption with automatic uncached I/O on this host. The first disposable unprovisioned disk was discarded and rebuilt from the checksum-verified archive.

## State files

- `state/config.json`: fixed helper configuration paths and resource caps.
- `state/runtime.json`: PID, VM state, socket path and guest readiness; no secret contents.
- `state/image-manifest.json`: fixed image URL and verified SHA-256 hashes.
- `state/console.log`, `state/host.log`: guest serial and helper logs.
- `state/vm.pid`: current VM helper process ID.

Stop the VM before deleting the project directory. Preserving the directory preserves the reproducible image, guest installation, keys and logs. No removal command touches host-global files.

## Automatic native preparation

`server/local-linux-vm.mjs` owns the application lifecycle. It calls only fixed helpers, stages the reviewed worker bundle, runs `worker/prepare-native.sh` inside the guest, provisions the private Node worker, and opens an authenticated loopback SSH tunnel. Models cannot supply a host command, executable path, endpoint, or credential environment variable.

`worker/prepare-native.sh` locks both `/srv/manta/prepare.lock` and `/srv/manta/verification.lock`. A new guest installs the build toolchain and official NASA ARM64 packages, expands the pinned local archives, and builds the native mission. A prepared guest reuses `/srv/manta/receipts/native-ready.json` only after checking the fixed input hashes, all 23 native program/library hashes, and all 220 private 42 assets against source integrity. Runtime library changes after a receipt are preserved and require validation plus a new receipt; they are never silently replaced.

The 42 headless MEAN ephemeris asset profile is private to the guest. No runtime asset link resolves back into the host shared source tree. Ownership normalization uses explicit guest work directories with `chown -R -P --no-dereference`; it never follows a shared source symlink.

The readiness receipt describes a working build environment. It deliberately does not claim that a simulation campaign or a system requirement has passed. Actual campaign telemetry, independent checks, and model-bound result manifests provide that separate evidence.
