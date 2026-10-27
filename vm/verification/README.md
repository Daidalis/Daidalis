# NOS3 production star-tracker verification

These tools run only against an isolated NOS3 source copy. They do not modify the
user's original NOS3 checkout or any global host configuration.

The fixed worker entrypoint is:

```
/usr/bin/python3 /mnt/manta-transfer/verification/verify_all.py --out JOBDIR
```

It executes five real integration cases: original defect reproduction, corrected
noncommuting mounting, negative quaternion sign, invalid measurement, and a
two-degree sensor-only bias. The bias counterfactual requires AD/GNC to follow the
changed measurement while independent 42 body truth remains unchanged. This
provides evidence against substituting body truth for measured sensor attitude.
Compiler-derived layouts decode actual cFS UDP telemetry independently of probes.
Every case restores pinned original algorithm sources before applying an explicit
patch and incremental rebuild. Full raw streams remain in the guest; compact
hash-linked evidence is selected for Manta transfer.

`instrument_startracker.py --source COPY --mode baseline|fixed` adds observation
probes to the actual UART simulator and ADCS cFS application's SB ingest and ADAC
update paths. Before applying, create the explicit marker
`COPY/.manta-isolated-nos3`. The fixed mode preserves raw sensor attitude at
ingest and applies sensor-to-body mounting exactly once, in the correct order,
inside production attitude determination. Originals and a patch manifest remain
inside COPY. A baseline run is necessary: identity mounting alone hides both the
double-application and noncommutative-order defects.

`verify_startracker.py --sim-log SIM --fsw-log FSW --output REPORT` consumes the
`MANTA_TRACE` JSON lines. It uses independent direction cosine matrix composition,
not production quaternion multiplication. Expected body attitude is
`C_BN = C_BS @ C_SN`, with vector-first, scalar-last passive quaternions.
Sensor `SC[0].ST[0].qn` is the input. Body truth is never substituted for it.

The report separates transport/quantization, actual SB ingest, valid/invalid
gating, AD and GNC frame transforms, sign invariance, and scenario coverage.
Missing required observations fail closed. A passing process exit is not a
passing engineering assertion. Staleness detection is explicitly outside current
production support and is reported as unverified rather than passed.

Probe-only instrumentation changes timing and logging, and is an integration
test configuration, not a flight qualification build. Results establish only the
tested software paths/configurations, not physical sensor or mission assurance.
