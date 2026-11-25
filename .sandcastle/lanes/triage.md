# GitHub issue triage lane

The triage agent classifies open issues and proposes the repository's triage
labels; the host applies them, so the sandbox never holds a GitHub credential.
Triage never closes issues and never touches the factory's workflow labels.

## Wake

This lane has no polling timer. It watches
`.sandcastle/logs/triage-events`; `sandcastle-triage.yml` drops a marker when an
issue is opened or a human requests triage with `workflow_dispatch`. A host
restart does not start it unprompted (`RunAtLoad` is false).

## Scripts

- `npm --prefix .sandcastle run triage` — one pass
- `npm --prefix .sandcastle run triage:check` — non-mutating environment check
