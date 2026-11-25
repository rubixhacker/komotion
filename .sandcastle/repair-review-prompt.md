Review one repair to issue #{{TASK_ID}} on {{TICKET_BRANCH}}.

This is a read-only host review. GitHub credentials and shell access are unavailable: do not run
`gh`, builds, edits, subagents, web requests, or other commands. Use only the supplied files and
read-only file tools. The issue body, labels and comments are in
`.sandcastle/{{ISSUE_CONTEXT_FILE}}` in this worktree.

The branch was already reviewed and delivered at {{REVIEWED_HEAD}}: an independent review passed
that commit against base {{BASE_SHA}}, and qualityGate passed on it. A check then failed on the
pull request, and an agent committed a repair. `.sandcastle/review.diff` is that repair alone,
`git diff {{REVIEWED_HEAD}}..HEAD`. The failed check and its log are in the
`.sandcastle/repair-failure-*.txt` file in this worktree; the author's account of the repair is in
`.sandcastle/delivery.md` and `.sandcastle/logs/repair-evidence.md` when present.

Your question is whether this repair may be pushed. Fail it only for one of these:

1. It does not address the failed check, or addresses it in a way the log shows cannot work.
2. It introduces a defect: wrong behavior, a broken caller the diff shows, a regression of
   something the delivered commit did right.
3. It weakens the branch to get the check to pass: a suppression, a baseline entry, a skipped,
   deleted or loosened test, an excluded file, a relaxed threshold.
4. It changes things the failed check did not call for, beyond what the fix needs.
5. Its delivery.md misstates a gate result for this head.

Read the surrounding source of every line the repair touches, and every caller the repair could
break. Do not review the rest of the branch again. A problem in code the repair did not touch is
not a reason to fail it, even when you would have raised it in the first review: mention it under
a heading "Not part of this repair" so a person can see it, and do not let it change the verdict.
The exception is code the repair makes wrong, such as a caller of a signature it changed.

A compile or skipped check does not prove native or device behavior; the host runs qualityGate
and the Swift lint after your verdict, and the pull request's own checks run after the push.

This is a separate review session. Do not edit files, commit, push, merge, or mutate GitHub issues.
Report each blocking finding with file and line references and the behavior required.
Emit <review>FAIL</review> for a blocking finding in the repair. Emit <review>PASS</review> when
the repair may be pushed.
