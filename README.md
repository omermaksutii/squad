# Squad

> Opinionated subagent pipelines for Claude Code. One command, multi-agent in your terminal.

[![npm](https://img.shields.io/npm/v/@omermaksutii/squad?color=cb3837)](https://www.npmjs.com/package/@omermaksutii/squad)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```
$ squad run feature "add OAuth2 login to /auth endpoint"

squad:feature → 5 agents

  agent          status      duration   artifact
  ─────          ──────      ────────   ────────
  researcher     ✓ done      8.2s       .squad/runs/.../researcher.md
  architect      ✓ done      12.4s      .squad/runs/.../architect.md
  coder          running…    14.1s
  tester         pending
  reviewer       pending
```

## Why

Subagents in Claude Code are powerful but wiring them is painful — you write the same `Task(...)` boilerplate every time, you forget what handoffs each role needs, you reinvent the prompt for each new feature. **Squad ships 6 production-grade pipelines** with named roles, real handoffs between agents, and a live TUI showing progress.

## Install

```bash
npm install -g @omermaksutii/squad
```

You also need [Claude Code](https://www.anthropic.com/claude-code) on your PATH (`claude` binary). Squad spawns headless `claude -p` instances under the hood — one per agent.

## Run a pipeline

```bash
# 5-agent feature pipeline
squad run feature "add OAuth2 login to /auth endpoint"

# 3-agent bug investigation
squad run bugfix "users sometimes see 500 on POST /signup with empty password"

# refactor with invariant checking
squad run refactor "extract auth middleware out of app.ts"

# security audit
squad run security-review "audit src/auth/"

# adaptive debugging
squad run debug "intermittent 504 on uploads larger than 5MB"

# postmortem from logs/PRs/chat
squad run postmortem "Tuesday's payment outage"
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

`squad list` to see them all, `squad show <recipe>` to inspect a recipe's DAG and prompts.

## How it works

```
squad run feature "..."
   │
   ▼
loads .json recipe → topologically sorts agents → runs each layer in parallel
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
- `name` and `description` (role)
- `prompt` (template; supports `{{task}}`, `{{cwd}}`, `{{<previous-agent>}}`)
- `dependsOn` (other agents whose artifacts must exist before this one runs)
- `model` (haiku/sonnet/opus)
- `maxBudgetUsd`, `timeoutSec`, `allowedTools`

## Custom recipes

```bash
squad init my-pipeline
# edits ~/.squad/recipes/my-pipeline.json
squad run my-pipeline "task description"
```

Or pass a literal path:

```bash
squad run ./team-recipe.json "task description"
```

## Cost & safety

- Each agent has a `--max-budget-usd` cap (default $0.50). The whole pipeline can be tightly bounded.
- Pipelines write everything to `.squad/runs/<timestamp>/`. Nothing is global, nothing leaks.
- `--echo` mode runs the orchestrator without spawning Claude — useful for debugging recipes.

## Stack

- TypeScript
- `commander` for the CLI
- `chalk` for the TUI
- `claude -p` (Claude Code's headless mode) for each agent
- File-based handoff between agents (`.squad/runs/<ts>/artifacts/`)

## Roadmap

- ✅ **v0.1** — 6 built-in recipes, CLI, live TUI, echo mode, `squad init` for custom recipes
- ⏳ **v0.2** — `/squad` skill so you can invoke from inside Claude Code
- ⏳ **v0.3** — recipe registry (browse + install community recipes)
- ⏳ **v0.4** — visible agent-to-agent messaging (not just file handoff)
- ⏳ **v1.0** — sandbox mode (E2B/Docker), parallel execution metrics, GitHub Action

## License

MIT — see [LICENSE](LICENSE).
