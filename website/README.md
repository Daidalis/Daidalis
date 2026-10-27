# Manta product website

A dependency-free static showcase with an illustrative Coordinator/thread workflow and recorded STF evidence. It does not send model requests, run a solver, or connect to the local Manta application.

## Publish with GitHub Pages

The repository includes [the Pages workflow](../.github/workflows/website-pages.yml). The maintainer enables Pages manually:

1. Open the repository’s **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open **Actions → Publish product website → Run workflow**, select `main`, and run it.
4. Use the URL shown by the successful `github-pages` deployment. For `MingxiYe/Manta`, the expected default address is `https://mingxiye.github.io/Manta/`.

After activation, changes under `website/` on `main` publish automatically. The workflow never installs application packages or starts Manta/Agents. It checks the evidence and export, reads Pages metadata, uploads only an isolated static export, and deploys with GitHub’s short-lived workflow token. No PAT or model key is required. The `github-pages` environment can be restricted to `main`.

GitHub Free supports Pages for public repositories; private-repository Pages requires an eligible paid plan. Enabling a website does not require making the application repository public if the account supports private-repository Pages. A website-only public repository can instead contain `website/` and this workflow while the application remains private. Keep the same folder layout. See [GitHub’s publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

The expected address is not proof of a successful deployment. Check the actual workflow result and deployed page after enabling Pages. Existing engineering requirements and tool-provisioning limits are unaffected.

## Preview and validate locally

```sh
cd website
npm test
npm start
```

No `npm install` is needed for this website. Node.js 22+ is sufficient for its built-in-module scripts; the Manta application has its own Node requirement.

To reproduce a project subpath before deploying, choose a new, empty output location outside the checkout:

```sh
node scripts/prepare-pages.mjs --output /absolute/path/to/manta-pages --base-url https://mingxiye.github.io/Manta/
node scripts/check.mjs --root /absolute/path/to/manta-pages
SITE_ROOT=/absolute/path/to/manta-pages SITE_BASE_PATH=/Manta/ npm start
```

Open the printed URL, normally `http://127.0.0.1:4320/Manta/`. `PORT` changes the preview port. Browser QA covers inline thread references, the right overview, artifact return navigation, baseline/corrected data, and downloads.

`dist/` contains publishable assets. The exporter rejects links, hidden configuration and unsupported files, preserves original evidence bytes, and limits the static export to 1,000 files / 8 MiB. It generates canonical/Open Graph URLs from the configured Pages base URL and adds an empty `.nojekyll` marker. Only the generated HTML metadata differs from the source export.

## Recorded demo scope

Raw telemetry and the model snapshot are byte-preserved from native runs; see [evidence provenance](dist/assets/evidence/README.md). Dialogue and thread statuses are illustrative, not a historical Agent execution transcript. The explanatory design map is not a live SysML semantic model. The demo does not establish complete STF development or mission acceptance.
