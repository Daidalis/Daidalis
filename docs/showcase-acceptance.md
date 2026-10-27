# Product showcase acceptance — 2026-10-27

Scope: product documentation, standalone frontend website, and an interactive recorded STF low-power walkthrough. This change does not advance the engineering acceptance status of STF or deploy changes to the running Manta application.

## Delivered

- English and Chinese README with a self-contained SVG brand cover, a walkthrough screenshot, truthful integration matrix, quickstart and links to detailed docs.
- A dependency-free static website in `website/`, with a product introduction, Coordinator/thread walkthrough, artifact views, telemetry comparison, check outcomes, downloads, and local setup instructions.
- Deployment target: GitHub Pages. The owner enables Pages and runs the static workflow; use its successful deployment URL. This historical interaction/evidence review does not claim GitHub Pages is already live. See [deployment setup](github-pages.md).
- Site source commit: `1566790298221332c001e0851b6a2823ad172df7`. Saved version 1 deployed successfully. No model endpoint, API key, live Agent or solver is required by the static walkthrough.

## Verification performed

- `node --check website/dist/app.js` passed.
- `node website/scripts/check.mjs` passed: HTML asset references/anchors; both complete CSV files compared sample-for-sample with the JSON export; model and CSV SHA-256 checked; expected row counts and 3/5 versus 5/5 outcomes checked; credential/host-path export scan passed.
- README, Chinese README, demo guide and evidence markdown references resolved locally; no nested Git metadata in the website copy; `git diff --check` passed.
- Browser checks covered chapter navigation, opening a task thread, artifact/result views, baseline/corrected switching, keyboard-controlled sample inspection, and responsive layout at 390px. No horizontal overflow observed; the mobile artifact panel appeared below the chat.
- Retained browser telemetry observations: original final sample `95.85 s / 23.622 V / mode 3 / switch7 170`; corrected final sample `95.92 s / 23.633 V / mode 1 / switch7 0`. Two failures stayed visible in the baseline and zero in the corrected selected checks.
- Browser error log was empty during the interaction checks. Deployment returned `succeeded`; unauthenticated navigation showed the expected ChatGPT login gate.

## Presentation and engineering boundaries

The conversation narrative and relationship diagram are curated explanations. They are not an original historical chat transcript or a live SysML semantic model. The frozen `.stf.json` source is a native integration recipe. Downloaded CSV and model files retain the original bytes; `recording.json` is a curated export, not the full protected execution receipt.

The recorded data covers selected NOS3/cFS/NASA 42/EPS low-power software integration. Full STF mission behavior, science delivery, hardware/HIL, environment, lifetime and independent acceptance remain open. Existing real case and from-zero evaluation requirements are unchanged. No global dependencies, Agent credentials or live engineering state were modified for this showcase.
