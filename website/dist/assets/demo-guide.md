# Manta: explore a recorded STF engineering iteration

This browser walkthrough is a static, interactive replay. It needs no API key and launches no Agent, VM or solver. Narrative messages are curated explanations, not a verbatim historical chat. Numerical telemetry, job identifiers, model/input hashes and check outcomes were exported from retained native runs on 2026-10-23.

## Walk through it

1. Open the website and choose **Explore the demo**. This is a public static showcase, not a hosted Manta service.
2. The demo opens at **Work & waiting**. Coordinator stays on the left; the right **Threads** overview groups two illustrative, parallel workstreams by status. The coordination narrative is curated, not a historical execution transcript.
3. Open **Power & flight software** from either its inline reference or the right overview. Only the right pane changes. Try the labelled illustrative follow-up inside the thread, or route the preset follow-up from Coordinator. In either case the detailed exchange stays in the thread and a concise handoff appears in Coordinator.
4. Open **Frozen test recipe** to inspect and download the source snapshot used by the corrected native run.
5. Choose **Review the handoff**, then inspect the returned check evidence. In **The evidence**, open **View simulation** and switch between **Original · 3/5** and **Corrected · 5/5**. Hover over the curve or use the sample slider to inspect actual sample values. **Back to thread** returns an artifact to its source conversation; **Threads** returns to the status index.
6. Open **The evidence** and inspect the five checks, their provenance, and the remaining engineering work. Download CSV or curated JSON for your own review.

## What the data supports

The selected NOS3/cFS/NASA 42/EPS software-integration regression exercises low-power protection and re-entry. Both executions completed; the original passed 3/5 selected checks and the corrected run passed 5/5. The corrected CSV contains 473 samples, the original contains 479. Battery voltage is one observed signal; verification also checks MGR mode and EPS switch states.

The source snapshot is `STFLowPower.stf.json`, a native integration recipe, not a SysML model. The diagram in the website is an explanatory relationship view. Full Manta has separate SysML semantic and source views.

The raw CSV files and frozen recipe are copied byte-for-byte. `recording.json` is a curated export, with original result hashes retained as provenance. A hash records identity; it is not independent proof that a result is scientifically valid. The website does not rerun or independently revalidate the original engine.

## What remains open

Complete STF mission scheduling and all-device configuration; end-to-end science products and ground delivery; hardware/HIL; actual EPS calibration; environmental and lifetime qualification; and mission-authority acceptance. Five selected software checks do not close those requirements. The requirements-first STF project remains an unfinished engineering effort.

## Run the actual application

With access to the private repository and Node.js 22.13+:

```sh
git clone https://github.com/MingxiYe/Manta.git
cd Manta
npm ci
npm start
```

Open http://127.0.0.1:4317, configure an Agent in Settings, and select an engineering project folder. Professional jobs also require configured isolated tools/runners; npm installation alone does not install the engineering stack. See the repository's environment and runtime documentation.

For a requirements-first task, describe the desired mission, restrictions and verification needs in ordinary language. Manta's system instructions and tools handle one-level Coordinator/thread delegation; users should not have to write orchestration or tool-call scripts.
