# Native NOS3 integration profile

This profile builds the pinned NASA NOS3 checkout, cFE, NOS OSAL/PSP, hardware
library, CI_LAB, TO_LAB, scheduler, production star-tracker flight application,
production ADCS application, NOS Engine, 42, and the actual sensor simulator.
There is no Docker prerequisite or instruction to install host-global packages.

The chain under test is:

`42 sensor attitude → TCP data provider → UART wire encoding → NOS Engine UART →
star-tracker cFS flight app → Software Bus → production ADCS → DI/AD/GNC telemetry
→ UDP ground capture → independent frame and transport assertions`.

This is a complete **selected star-tracker/ADCS integration profile**, not a claim
that every optional camera, radio, encryption, ground UI or default mission
scenario has been exercised. 42 runs headlessly with MEAN ephemeris. The asset
manifest explicitly identifies omitted graphics and unused DE430/DE440 files.
The upstream checked-in generated 42 C files are compiled without regenerating
their unchanged type schemas, avoiding an unnecessary Julia installation.

## Preparation

The host Virtualization.framework helper and cloud-init are managed separately
under `../host`. Only the project `handoff` directory is shared. Guest paths are
private `/srv/manta` paths; the original NOS3 project is never built or patched.

`fetch_sources.py` retrieves allowlisted source archives at the NOS3 gitlink
revisions and records archive SHA-256 values in `source/manifest.json`.

`provision_guest.sh SOURCE_ROOT WORK_ROOT RECEIPT_ROOT` runs only inside the
Ubuntu 22.04 ARM64 guest. It installs build dependencies and two official NASA
ARM64 packages inside that disk. The small source and headless-asset archives
avoid per-file shared-filesystem read-lock failures observed on this host.

`build_native.sh /srv/manta/nos3` compiles the actual code natively and records
ELF architecture and binary SHA-256 values in `/srv/manta/receipts`.

## Execution

`run_native.py --work /srv/manta/nos3 --output /srv/manta/runs/UNIQUE_CASE
--duration 20` starts all production processes. The original NOS3 time driver
uses a private pseudoterminal because it uses ncurses; no GUI window or synthetic
clock is substituted. NOS Engine stdin stays open. Measurement starts only after
actual cFE OPERATIONAL state and simulator UART readiness, with a 45 second
startup bound.

The ground client sends enable, data-request, ADAC-update and publish commands
through the real CI UDP interface. It never sends attitude or dynamics truth as
flight Software Bus input. The actual UART frames, SB traces, raw UDP packets,
timestamps, source configuration, and independently derived packet layouts are
retained. Execution success is recorded separately from engineering assertions.

The independent campaign entrypoint is maintained under `../verification`:

`python3 -B /mnt/manta-transfer/verification/verify_all.py --out JOB_DIRECTORY`.

It runs original-defect, fixed, quaternion-sign, invalid-observation and sensor
bias cases. The original-defect case must reveal the actual mounting-transform
defect; it is not labeled an engineering pass. The fixed model is checked using
independent passive direction cosine matrices. A deliberate sensor-only bias
must propagate into ADCS while separate 42 body truth remains unchanged.

This establishes software integration for the recorded configuration. It does
not replace physical sensor validation, real-time hardware tests, or mission
qualification. Other sensor inputs and control actuators are omitted from this
focused interface verification profile.
