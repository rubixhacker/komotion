# Triage Labels

The factory and the triage pass speak in terms of five canonical triage
roles. This file maps those roles to the actual label strings used in this
repo's issue tracker.

| Label | Meaning |
| --- | --- |
| `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | Waiting on the reporter for more information |
| `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | A concrete human-in-the-loop action or acceptance gate is next |
| `wontfix` | Will not be actioned |

When an agent or a skill mentions a role (for example, "apply the AFK-ready
triage label"), use the corresponding label string from this table.

`ready-for-agent` means the issue is fully specified: a concrete change with
acceptance criteria an agent can verify, no open questions, and no work that
needs a human decision. When in doubt, leave the issue for the maintainer.

`ready-for-human` is broader than human-authored implementation. Use it when
the next concrete gate requires human action, product judgment, or acceptance
evidence that cannot be delegated to an agent-operated harness. Do not use it
for an issue that is merely blocked or is only a program umbrella with no
concrete human action ready to perform.

## Blocking dependencies

GitHub's native "blocked by" edges are the source of truth for one issue
waiting on another. The factory reads the edge to decide eligibility, GitHub
renders it in the issue UI, and closing the blocker releases its dependents
without a label or body edit. A `Blocked by:` line in prose is not an edge:
the factory ignores it, so a prose-only dependency leaves the ticket eligible
and creates no UI relationship. Do not write one when authoring tickets.

The `blocked` label is a human-facing signal, not the dependency record. Keep
it when a person needs to see at a glance that the next action cannot start,
including for external dependencies GitHub cannot edge to (a release, a
dependency upstream). For an issue-to-issue wait, set the native edge; add
the label too when readers benefit from the hint. The label never creates a
dependency and never decides factory eligibility: the edge does.

## Repository-specific workflow labels

| Label | Meaning |
| ----- | ------- |
| `factory-inflight` | Derived, informational state set while a Sandcastle factory worker is working on the ticket. It makes in-flight work visible on GitHub and holds a stale claim out of the queue until the sweep clears it. |
| `ready-for-interactive-agent` | The factory routed the ticket here after its strikes (stalls, review or gate failures). The owner runs it in an interactive agent session. The factory holds it back; put `ready-for-agent` back and remove this label to requeue it. |
| `deferred` | Owner deferred; closed as not planned. Reopen when the owner resumes it. |

## Closing evidence-heavy issues

An issue closes when its shipped behavior is verified. All three must hold:

1. The code is merged to `main`.
2. Its automated tests pass in CI.
3. At least one recorded run exists for each platform the issue covers.

Automated tests count as proof for app-owned behavior. A platform-specific
run is needed only where the behavior depends on hardware, the operating
system, or a store.
