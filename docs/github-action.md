# Squad GitHub Action

Run a Squad pipeline directly in GitHub Actions.

```yaml
name: security review on PR

on:
  pull_request:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      # Authenticate Claude Code in CI (use whichever method matches your setup)
      - run: echo "${{ secrets.ANTHROPIC_API_KEY }}" | npx claude auth login --stdin

      - uses: omermaksutii/squad/.github/actions/squad@v1
        with:
          recipe: security-review
          task: 'Audit changes in this PR'
          parallel: 2
          retry: 1
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `recipe` | (required) | Built-in name or path/URL to a custom JSON |
| `task` | (required) | Task description |
| `parallel` | `0` (unlimited) | Max concurrent agents per layer |
| `retry` | `0` | Retry count on agent failure |
| `squad-version` | `latest` | Squad version (e.g. `1.0.0`) |

## Output

Artifacts from the run land in `.squad/runs/<timestamp>/artifacts/` and are
uploaded as a build artifact named `squad-run` (downloadable from the Actions UI
for 90 days by default).

## Use cases

- **PR security review** — run `security-review` on every PR
- **Pre-release audit** — run `release` on tag pushes
- **Postmortem** — manually-triggered with the incident as input
- **Onboarding refresh** — nightly `onboard` to keep the contributor pack current
