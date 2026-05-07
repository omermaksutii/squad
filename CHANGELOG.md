# Changelog

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
