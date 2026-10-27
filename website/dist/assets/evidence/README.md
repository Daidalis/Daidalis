# Recorded low-power evidence

Source: Manta's retained STF low-power native integration project, recorded 2026-10-23. This directory is an intentionally bounded export without runtime chats, credentials, machine paths or VM state.

| File | Origin |
| --- | --- |
| `baseline.csv` | Byte-identical original EPS telemetry; job `professional_ea08dae5cf174078b4e604ce41bf3c64`, 479 samples, 3/5 selected checks |
| `corrected.csv` | Byte-identical corrected EPS telemetry; job `professional_c54a93d336684791af5b46b3ef2fa77b`, 473 samples, 5/5 selected checks |
| `STFLowPower.stf.json` | Byte-identical corrected-job model snapshot; SHA-256 `382a2ccb03905a3fb67441a2c533ed8af6fdc1ef29befcc0c966ccea5053c4be` |
| `recording.json` | Curated export of original job checks, model/input/result/CSV hashes and all numeric CSV samples; not the entire original execution receipt |

The recorded job's recipe uses the selected NASA NOS3/cFS/42/EPS chain. Curated webpage narrative and explanatory design diagram are presentation content, not historical transcript or an evaluated SysML model. Outcomes apply only to the selected software regression. Full STF mission development, science delivery, hardware/HIL, environment/lifetime qualification and acceptance remain open.

Checksums can be recomputed with the website's `scripts/check.mjs`.
