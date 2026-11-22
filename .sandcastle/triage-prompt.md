# TASK

Triage the open issues listed below. For each issue, decide which of the
repository's triage labels it should carry.

# ISSUES

<issues-json>
{{ISSUES}}
</issues-json>

# LABELS

| Label | Meaning |
| --- | --- |
| `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | Waiting on the reporter for more information |
| `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | A concrete human-in-the-loop action or acceptance gate is next |
| `wontfix` | Will not be actioned |
| `blocked` | The next action needs an external dependency a person should see at a glance |

# RULES

- Decide from the issue's body, labels and comments. Do not guess at missing
  information; when the reporter must supply something, use `needs-info` and
  remove `needs-triage`.
- Apply `ready-for-agent` only when the issue is fully specified: a concrete
  change with acceptance criteria an agent can verify, no open questions, and
  no work that needs a human decision. When in doubt, leave the issue for the
  maintainer.
- Do not remove `ready-for-agent` unless the issue is no longer ready.
- `wontfix` means the maintainer decided; do not apply it on your own
  judgment, and never close an issue.
- Leave `blocked`, `deferred`, `factory-inflight`,
  `ready-for-interactive-agent` and other workflow labels alone unless the
  issue's state clearly contradicts them.
- A new issue with no labels gets `needs-triage` unless your review finds it
  already fully specified, in which case you may go straight to
  `ready-for-agent` or `ready-for-human`.

# OUTPUT

Output your decisions as a JSON object wrapped in `<triage>` tags. `add` and
`remove` list label names; `note` is an optional comment to post on the issue
(only when your decision needs explaining):

<triage>
{"decisions": [{"issue": 42, "add": ["needs-triage"], "remove": [], "note": ""}]}
</triage>

Always emit the `<triage>` tags. If no issue needs a label change, output
`<triage>{"decisions": []}</triage>`.
