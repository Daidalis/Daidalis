# Manta website

Dependency-free static product website with an interactive, recorded STF low-power walkthrough. It does not send model requests or connect to the local Manta service. No credentials are embedded.

```sh
cd website
npm start
```

Open the printed local URL. The default port is 4320; set `PORT` to change it. `npm test` checks static references and verifies the bundled data against original CSV/model hashes. Browser QA should additionally cover thread navigation, chapter keyboard controls, artifacts, data variants, sample inspection, downloads and a narrow viewport.

`dist/` is the deployable static directory; `scripts/` uses only built-in Node modules. The product site is public; GitHub repository access is a separate permission and stays private until the maintainer changes it. The tracked `.openai/hosting.example.json` is a template, not access to the existing hosted Site. For a separate deployment, configure your own hosting target; Sites publication uses a site-specific `.openai/hosting.json` outside the public source. There is no CI auto-deploy to GitHub Pages.

Raw telemetry and the model snapshot are byte-preserved from recorded native runs; see [evidence provenance](dist/assets/evidence/README.md). The webpage uses illustrative Coordinator/thread dialogue and step-based thread statuses; it does not claim that the retained runs were produced by these exact conversations. The design map is explanatory. Coordinator stays in the main chat, while the right pane opens the flat thread overview, individual conversations, and artifacts. Direct intervention and routing use clearly labeled scripted examples. It is not a live Agent demo or complete STF acceptance.
