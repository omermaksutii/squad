# Changelog

## 2.0.0 — 2026-05-08

Three new features, zero breaking changes. Existing recipes, runs, CI configs, and JSON output schemas continue to work as-is.

### v1.1 — Visible agent-to-agent handoffs in the TUI

The TUI now shows a "handoffs" pane on the right (terminals ≥100 cols) listing each producer→dependent edge as it fires:
`planner → coder: planner.md (1.2KB)`. Narrow terminals get the same data inline.

The `--json` payload includes a top-level `handoffs[]` array with `{ from, to, files: [{ path, bytes }] }` for each edge. No protocol change — purely observability over the existing DAG.

### v1.2 — Recipe registry (`squad search` + `squad add`)

Curated index lives at [omermaksutii/squad-recipes](https://github.com/omermaksutii/squad-recipes).

- `squad search [query]` — fuzzy-search the index. Empty query lists everything.
- `squad add <name>` — fetch the recipe and save to `~/.squad/recipes/<name>.json`. Validates the recipe before writing.
- Index is cached at `~/.squad/.registry-cache.json` for 24h with ETag revalidation.
- Stale-cache fallback when the network is down.
- Override the registry via `$SQUAD_REGISTRY_INDEX` (any URL serving a v1 index).
- Refuses to shadow built-in recipes without `--force`.

### v1.3 — Docker sandbox (`squad run --sandbox`)

Each agent's `claude` invocation runs inside `ghcr.io/omermaksutii/squad-runner:2`:

- Workspace bind-mounted at `/work` (writes go to host as expected).
- 2G memory cap, 2 CPU cap, `--rm` on cleanup.
- `--sandbox-network=bridge` (default — claude API reachable) or `none` for air-gapped use with a local proxy.
- Auth: passes `$ANTHROPIC_API_KEY` through, or mounts `~/.claude` read-only when only subscription auth is available.
- Adapter interface (`SandboxAdapter`) designed so a future E2B backend slots in without refactoring.
- `squad doctor` gains `docker` + `docker daemon` checks (informational without `--sandbox`, hard fails with it).

To run docker-backed tests locally: `RUN_DOCKER_TESTS=1 npm test`.

### Internal

- New modules: `src/handoff.ts`, `src/registry.ts`, `src/sandbox/`.
- New tests: `tests/handoff.test.ts` (9), `tests/registry.test.ts` (15), `tests/sandbox-docker.test.ts` (9 + 1 gated).
- New build artifacts: `Dockerfile.runner`, `.github/workflows/runner-image.yml` (builds + pushes on tag).

## 1.0.0 — 2026-05-07

First public release.

### Recipes (8 built-in pipelines)
- `feature` — researcher → architect → coder → tester → reviewer
- `bugfix` — investigator → fixer → tester
- `refactor` — architect → refactorer → verifier
- `security-review` — auditor → reporter
- `debug` — hypothesizer → instrumenter → analyst
- `postmortem` — researcher → writer
- `release` — auditor → scribe → verifier → announcer
- `onboard` — cartographer → quickstart → glossary-writer → scout

### CLI surface
- `squad list` / `squad show <recipe>` — discover + inspect
- `squad run <recipe> "<task>"` — execute pipeline (live TUI)
- `squad demo` — self-contained echo-mode walkthrough (no claude needed)
- `squad install` — drop the `/squad` skill into `~/.claude/skills/squad/`
- `squad doctor` — checks `claude` on PATH, recipe loadability, skill install
- `squad new [name]` — scaffold a custom recipe at `~/.squad/recipes/<name>.json`
- `squad validate <file>` — lint a custom recipe JSON
- `--json` global flag for machine-readable output

### Architecture
- Each agent is a headless `claude -p` subprocess
- Agents handoff via files in `.squad/runs/<ts>/artifacts/<agent>.md`
- Topological sort runs independent agents in parallel within a layer
- Per-agent `--max-budget-usd` cap, `timeoutSec`, `allowedTools` restrictions
- File-based recipes (JSON), 3 lookup paths: built-ins → `~/.squad/recipes/` → literal path

### Tests
- 22 tests across 5 suites
- Echo mode for CI: full pipeline runs without spawning claude
