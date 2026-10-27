# Deploy the product website on GitHub Pages

The website is a static export of `website/dist`, independent of the Manta application, model APIs and professional runners. Its publishing workflow is `.github/workflows/website-pages.yml`.

The repository owner chooses **Settings → Pages → Source → GitHub Actions**, then starts **Actions → Publish product website → Run workflow** on `main`. Subsequent website commits on `main` deploy automatically. Read the workflow’s returned deployment URL; the expected default for this repository is https://mingxiye.github.io/Manta/ . This document does not claim that Pages has already been enabled.

The workflow uses GitHub-owned actions pinned to verified commits. Packaging has repository/Pages read access; deployment has Pages write, OIDC and artifact read access. The deployment job does not check out or execute application source. There are no model keys, external deployment credentials, app dependency installation or Agent runs. Pages enablement remains an explicit owner setting rather than adding a privileged token to the repository.

A private repository needs an eligible GitHub plan for Pages. The Pages website is generally public independently of the source repository’s visibility. On GitHub Free, a separate public website-only repository is an alternative to publishing application source; include `website/` and the Pages workflow with the same layout. [Official availability and configuration](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

The source’s relative asset/fetch/download links support the `/Manta/` project prefix. `prepare-pages.mjs` stamps metadata from the configured base URL and copies only bounded regular static files. Original CSV/model byte hashes remain unchanged. See [the website guide](../website/README.md) for local preview and checks.

After GitHub reports deployment success, verify the homepage, thread/artifact navigation, evidence JSON and CSV downloads before treating migration as complete. Update promoted links to that actual URL, then retire any previous hosting separately. No new ChatGPT/Sites deployment is part of this workflow.
