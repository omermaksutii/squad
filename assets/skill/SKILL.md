---
name: squad
description: Run multi-agent pipelines for common dev workflows. Use when the user asks for a feature implementation, bug fix, refactor, security review, debugging session, postmortem, release, or onboarding pack — and the task is non-trivial enough to benefit from named specialist subagents.
---

# Squad — multi-agent pipelines

You have access to the `squad` CLI. Squad ships 8 opinionated subagent pipelines:

| Recipe | Agents | Use when |
|---|---|---|
| `feature` | researcher → architect → coder → tester → reviewer | Adding a non-trivial feature |
| `bugfix` | investigator → fixer → tester | Diagnosing + fixing a bug |
| `refactor` | architect → refactorer → verifier | Behavior-preserving refactor |
| `security-review` | auditor → reporter | Audit before shipping or merging |
| `debug` | hypothesizer → instrumenter → analyst | Hard-to-reproduce bug |
| `postmortem` | researcher → writer | Incident retrospective |
| `release` | auditor → scribe → verifier → announcer | Cutting a new version |
| `onboard` | cartographer → quickstart → glossary → scout | Generate onboarding for new contributors |

## When to use Squad vs. doing it yourself

Use Squad when:
- The task spans multiple files / multiple concerns (>30 minutes of work for a single agent)
- The user explicitly asks for a "review" / "audit" / "postmortem" / "onboarding"
- A pipeline of distinct roles will produce a better result than one pass

Skip Squad when:
- The task is small and tightly scoped (a one-line fix, a typo)
- The user is in the middle of a conversation and just wants you to keep going
- You've already done the work (don't re-spawn agents to redo)

## How to invoke

```bash
squad run <recipe> "<task description>"
```

Examples:

```bash
squad run feature "add OAuth2 login to /auth/sign-in"
squad run bugfix "users get 500 on POST /signup with empty email"
squad run refactor "split authService.ts into auth/{login,session,token}.ts"
squad run security-review "audit src/api/uploads/"
squad run release "cut 1.4.0"
squad run onboard "for a new backend contributor"
```

## Reading the output

Each agent writes a markdown artifact to `.squad/runs/<timestamp>/artifacts/<agent>.md`. Read these in order — earlier agents inform later ones. The final agent's artifact is usually what the user wants.

## Discipline

- Don't run Squad just because you can. Use it when a pipeline of specialists is genuinely better than one pass.
- Don't ignore agents you spawn. If the reviewer found issues, address them — don't paper over them.
- After a Squad run, summarize what each agent produced to the user. Don't just say "done."
- If the user has a custom recipe at `~/.squad/recipes/<name>.json`, prefer that over a built-in for project-specific workflows.
