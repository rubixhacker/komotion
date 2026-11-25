# Dependabot lane

The watchdog reconciles Dependabot pull requests: it checks CI and mergeability,
re-runs a failed check before spending a repair, and gates any change before it
is delivered.

## Wake

The lane has a 30 minute timer and also watches
`.sandcastle/logs/dependabot-events`. `sandcastle-dependabot.yml` drops a marker
there when a Dependabot PR changes, when CI finishes on a `dependabot/**`
branch, or when main moves. The event path removes the wait; the timer remains
the independent fallback.
