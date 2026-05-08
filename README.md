# Squad

> Opinionated subagent pipelines for Claude Code. One command, multi-agent in your terminal.

[![npm](https://img.shields.io/npm/v/@omermaksutii/squad?color=cb3837)](https://www.npmjs.com/package/@omermaksutii/squad)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```
$ squad run feature "add OAuth2 login to /auth endpoint"

🟢 squad
  agent          status      duration   artifact
  ─────          ──────      ────────   ────────
  researcher     ✓ done      8.2s       .squad/runs/.../researcher.md
  architect      ✓ done      12.4s      .squad/runs/.../architect.md
  coder          running…    14.1s
  tester         pending
  reviewer       pending
```

## Why

Subagents in Claude Code are powerful but wiring them is painful — same boilerplate every time, you forget what handoffs each role needs, you reinvent prompts for each new feature. **Squad ships 8 production-grade pipelines** with named roles, file-based handoffs, and a live TUI.

## Install

```bash
npm install -g @omermaksutii/squad
squad install     # adds /squad skill to your Claude Code
squad doctor      # verify
```

You also need [Claude Code](https://www.anthropic.com/claude-code) on your PATH. Squad spawns headless `claude -p` instances under the hood — one per agent.

## Try it without spending tokens

```bash
squad demo
```

Spins up a fake project in a temp dir, runs the `feature` recipe in echo mode, prints all 5 agent artifacts. No `claude` calls, no tokens.

## Run a real pipeline

```bash
# 5-agent feature implementation
squad run feature "add OAuth2 login to /auth endpoint"

# 3-agent bug investigation
squad run bugfix "users sometimes see 500 on POST /signup with empty password"

# refactor with invariant enforcement
squad run refactor "extract auth middleware out of app.ts"

# security audit
squad run security-review "audit src/auth/"

# adaptive debugging
squad run debug "intermittent 504 on uploads larger than 5MB"

# postmortem from logs/PRs/chat
squad run postmortem "Tuesday's payment outage"

# cut a new release
squad run release "1.4.0"

# generate an onboarding pack for a new contributor
squad run onboard "for a new backend contributor"
```

## Built-in recipes

| Recipe | Agents | Description |
|---|---|---|
| `feature` | researcher → architect → coder → tester → reviewer | End-to-end feature implementation |
| `bugfix` | investigator → fixer → tester | Reproduce, minimally fix, verify |
| `refactor` | architect → refactorer → verifier | Behavior-preserving refactor |
| `security-review` | auditor → reporter | Find and triage security issues |
| `debug` | hypothesizer → instrumenter → analyst | Narrow down hard-to-reproduce bugs |
| `postmortem` | researcher → writer | Build incident timelines + action items |
| `release` | auditor → scribe → verifier → announcer | Cut a version end-to-end |
| `onboard` | cartographer → quickstart → glossary → scout | Onboarding pack for new contributors |

`squad list` to see them all, `squad show <recipe>` to inspect any recipe's DAG and prompts.

## How it works

```
squad run feature "..."
   │
   ▼
loads JSON recipe → topologically sorts agents → runs each layer in parallel
   │
   ▼
spawns `claude -p --model X --append-system-prompt "you are <role>"`
   │
   ▼
each agent writes its artifact to .squad/runs/<ts>/artifacts/<name>.md
   │
   ▼
later agents see earlier agents' artifacts inlined into their prompts
```

Recipes are plain JSON. Each agent declares:
- `name`, `description` (role)
- `prompt` (template; supports `{{task}}`, `{{cwd}}`, `{{<previous-agent>}}`)
- `dependsOn` (other agents whose artifacts must exist before this one runs)
- `model` (haiku/sonnet/opus)
- `maxBudgetUsd`, `timeoutSec`, `allowedTools` (safety knobs)

## Custom recipes

```bash
squad new my-pipeline      # scaffolds ~/.squad/recipes/my-pipeline.json
$EDITOR ~/.squad/recipes/my-pipeline.json
squad validate ~/.squad/recipes/my-pipeline.json
squad run my-pipeline "task description"
```

Or pass a literal path:

```bash
squad run ./team-recipe.json "task description"
```

## CLI reference

| Command | Description |
|---|---|
| `squad list` | List built-in recipes |
| `squad show <recipe>` | Show the DAG and per-agent details |
| `squad run <recipe> "<task>"` | Execute a pipeline |
| `squad run … --sandbox` | Run each agent inside a Docker container (`--sandbox-network=bridge\|none`) |
| `squad search [query]` | Search the community recipe registry |
| `squad add <name>` | Download a recipe from the registry into `~/.squad/recipes/` |
| `squad runs` | List recent runs in the current project |
| `squad logs <run \| last>` | Print artifacts from a past run |
| `squad demo` | Self-contained echo-mode walkthrough |
| `squad install` | Drop the `/squad` skill into Claude Code |
| `squad uninstall` | Remove the `/squad` skill |
| `squad doctor` | Diagnose your installation |
| `squad new [name]` | Scaffold a custom recipe |
| `squad validate <file>` | Lint a recipe JSON |
| `squad --json <subcommand>` | Machine-readable output (every command supports it) |

## Community recipes

The registry lives at [omermaksutii/squad-recipes](https://github.com/omermaksutii/squad-recipes) — a curated index of community-contributed recipes.

```bash
squad search auth          # find recipes
squad add auth-flow        # save to ~/.squad/recipes/
squad run auth-flow "..."  # use it
```

The index is cached locally for 24h with ETag revalidation. To use a private registry, set `$SQUAD_REGISTRY_INDEX` to your own index URL.

## Sandbox mode

Run each agent inside a Docker container — useful when you don't fully trust a recipe, or want to enforce CPU/memory caps:

```bash
squad run feature "add OAuth2" --sandbox
squad run feature "add OAuth2" --sandbox --sandbox-network=none   # air-gapped
```

The runner image is `ghcr.io/omermaksutii/squad-runner:2`. First use pulls ~250MB; subsequent runs reuse the cached image. The sandbox needs either `$ANTHROPIC_API_KEY` or an existing `~/.claude/credentials.json` (mounted read-only).

## Cost & safety

- Each agent has a `--max-budget-usd` cap (default $0.50). The whole pipeline is bounded.
- All output goes under `.squad/runs/<timestamp>/`. Nothing global, nothing leaks.
- `--echo` mode runs the orchestrator without spawning Claude — useful for debugging recipes.
- `squad validate` lints custom recipes before you run them.

## Roadmap

- ✅ **v1.0** — 8 built-in recipes, CLI, live TUI, echo mode, `/squad` skill, doctor, install, demo, validate, --json
- ✅ **v2.0** — handoff visualization in the TUI · recipe registry (`squad search` / `squad add`) · Docker sandbox · real per-call cost · parallel execution metrics
- ⏳ **v2.1** — published GitHub Action on the Marketplace (`uses: omermaksutii/squad-action@v2`)
- ⏳ **v2.2** — E2B sandbox backend (alternative to Docker)

## Development

```bash
npm install
npm test                       # all echo mode (no claude needed)
RUN_DOCKER_TESTS=1 npm test    # also run the live Docker sandbox tests
npm run build
npm run lint
```

CI runs the same on Node 20 + 22 via `.github/workflows/ci.yml`. Tags push the runner image to GHCR via `.github/workflows/runner-image.yml`.

## License

MIT — see [LICENSE](LICENSE).
