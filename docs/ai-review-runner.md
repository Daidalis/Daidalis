# Self-hosted AI review runner

[Review automation](../.github/workflows/review-automation.yml) runs the official
Claude Code Action on a dedicated Linux x64 GitHub Actions runner. The runner
calls the configured model API; it does not host the model itself.

## Host requirements

Register a repository runner with the default `self-hosted`, `Linux` and `X64`
labels and the additional `daidalis-ai-review` label. All four labels must match
the workflow's `runs-on` selection.

Provide Git and GitHub CLI (`gh`) on the service account's `PATH`, plus these
preinstalled executables:

| Executable | Requirement |
| --- | --- |
| `/usr/local/bin/claude` | Claude Code compatible with the pinned action and configured model API |
| `/usr/local/bin/bun` | Bun 1.4.4, matching the pinned action's runtime |

Install any Node.js runtime required by the chosen Claude Code distribution.
Runner registration tokens are separate from the model API key. Keep the latter
in the repository Actions secret `AI_REVIEW_API_KEY`; configure the endpoint in
the Actions variable `AI_REVIEW_BASE_URL` and the model in `AI_REVIEW_MODEL`
(default: `glm-5.3`).

Run the service under a dedicated ordinary account without sudo or access to
host container sockets, cluster credentials or unrelated user directories.
Public PRs can change workflow definitions; the workflow's fork/Dependabot skip
does not provide operating-system isolation for untrusted jobs. Use an isolated
host or disposable runner environment for those jobs.

## Service operation

Use the repository's **Settings → Actions → Runners → New self-hosted runner**
instructions for Linux x64. Verify the package checksum before extraction,
register as the dedicated account, and add the `daidalis-ai-review` label.

From the configured runner directory, install and start its service as an
administrator, replacing `github-runner` with the actual service account:

```sh
sudo ./svc.sh install github-runner
sudo ./svc.sh start
sudo ./svc.sh status
```

The service should be enabled at boot and report `Connected to GitHub` followed
by `Listening for Jobs`. Check its current status and logs with:

```sh
sudo systemctl --no-pager status 'actions.runner.*'
sudo journalctl -u 'actions.runner.*' -n 100 --no-pager
```

## Verify a review

After the workflow change reaches the default branch, open **Actions → Review
automation → Run workflow**, choose that branch, and enter an existing open PR
number. Maintainers can use this manual path for fork and Dependabot PRs, whose
automatic events are skipped because their secret/token access is restricted.

Check that the job runs on the intended runner and that a review summary is
published on the PR. Its hidden `reviewed-head` marker must match the current PR
head. The workflow updates the most recent summary starting with
`<!-- ai-pr-review -->` and verifies publication before reporting success.

A connected runner or successful CLI version check does not verify model API
access. Complete a real review and confirm the published summary before retiring
the previous runner. Stop and disable that runner's service only after confirming
it is no longer needed by other workflows or repositories.
