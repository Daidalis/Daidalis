# Public web search

The API Agent has `web_search` for keyword discovery and `web_fetch` for reading
the resulting pages. For example, ask “查找 Model 3 的公开规格资料，优先官方来源，
标明年份、车型和地区，并给出原始网页链接”. Search snippets are leads; the Agent
should read the original pages before claiming a specification is verified.

`web_search` runs the upstream [Agent Reach](https://github.com/Panniantong/agent-reach)
CLI's `web search` channel, backed by Exa's public search service. It returns
titles, public URLs, bounded snippets, publication dates when supplied, and a
retrieval time. Keywords are sent to that service. Basic public search requires
no additional API key, but the service may be unavailable or rate limited.

## Source startup

From this checkout, run:

```bash
python3 scripts/install-agent-reach.py
npm start
```

The installer creates `.local/agent-reach/`, a separate Python environment. It
downloads source from the upstream GitHub commit, verifies SHA-256, and installs
version 1.6.1. It never installs the unrelated PyPI package named `agent-reach`.
It uses an existing `uv` when available, otherwise Python's `venv` and `pip`;
on Debian the latter requires `python3-venv`. No account login, personal browser
profile, other platform channel or global agent skill is configured.

Docker application builds include the same pinned version automatically. Rebuild
the image to include it in an existing deployment. An existing launcher can be
selected with `MANTA_AGENT_REACH_BIN`; an invalid explicit path does not silently
fall back to another executable. `MANTA_SEARCH_TIMEOUT_MS` is 45000 by default
and accepts 1000–120000 milliseconds. The entire search, including version
checking and body parsing, is bounded by that deadline and cancelled with its Run.

## Execution and status

Arguments are `{query, limit?}`: a nonempty query up to 1000 characters, and
1–10 results (default 5). Shell commands and arbitrary Agent Reach actions are
not exposed. The adapter bounds subprocess output and result text, omits private
or credential-bearing result URLs, and preserves existing `web_fetch` network
checks when the Agent opens a result. Retrieved text is untrusted source material.

The search subprocess uses application-owned state under the data directory and
receives configured network/proxy/certificate settings, without inheriting model
API keys or personal Agent Reach sessions. Search is read-only, so Manual mode
does not ask for project-write approval. Recorded tool events include the query
and bounded results. Existing public-source task ownership also applies to
`web_search`; a Coordinator cannot repeat an active research task's work.

Settings → 工具连接 and the Tools catalog distinguish missing dependencies, installed dependencies,
and the result of the most recent actual search. Opening the catalog never
installs software or sends a search. Errors, rate limits and cancellation are
reported explicitly; the adapter does not retry a search in a loop or turn
failures into an empty successful result.
Empty replies or replies whose URLs are all unusable are reported as “no usable
public links”; they do not mark search as ready.

After installing the project environment, its real CLI/Exa protocol regression
can be run without public search traffic:

```bash
MANTA_TEST_AGENT_REACH_BIN="$PWD/.local/agent-reach/bin/agent-reach" node --test tests/web-search-http.test.mjs
```

This check uses the installed CLI and a local HTTP transport fixture to exercise
result parsing and cooldown. A separate live query is needed to check public
service availability.

Pinned source: `c70ae6da5d39bc90e09ad2ae0575ccc89f31e284` (MIT).
Archive SHA-256: `291d7de701e7596055cad979064986000101613d4de4ea128cc653ad14164e81`.
